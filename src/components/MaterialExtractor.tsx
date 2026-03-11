import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useExtractionTask } from "@/contexts/ExtractionTaskContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Upload, FileText, Check, Sparkles, Wrench, Users, Pause, Play, X } from "lucide-react";
import JSZip from "jszip";

// ─── DOCX XML helpers ─────────────────────────────────────────────

interface DocxChunk {
  xml: string;
  text: string;
}

interface ParsedDocx {
  chunks: DocxChunk[];
  fullText: string;
  docPrefix: string;
  sectPr: string;
  docSuffix: string;
}

function extractText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function parseDocxXml(docXml: string): ParsedDocx | null {
  const bodyTag = docXml.match(/<w:body[^>]*>/);
  if (!bodyTag) return null;
  const bodyStart = bodyTag.index! + bodyTag[0].length;
  const bodyEnd = docXml.lastIndexOf("</w:body>");
  if (bodyEnd < 0) return null;

  const body = docXml.substring(bodyStart, bodyEnd);
  const sectMatch = body.match(/<w:sectPr\b[\s\S]*<\/w:sectPr>\s*$/);
  const sectPr = sectMatch ? sectMatch[0] : "";
  const content = sectMatch ? body.substring(0, sectMatch.index!) : body;

  const chunks: DocxChunk[] = [];
  const re = /<\/w:p>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const end = m.index + m[0].length;
    const xml = content.substring(last, end);
    chunks.push({ xml, text: extractText(xml) });
    last = end;
  }
  if (last < content.length) {
    const tail = content.substring(last).trim();
    if (tail) chunks.push({ xml: tail, text: extractText(tail) });
  }

  return {
    chunks,
    fullText: chunks.map((c) => c.text).join(""),
    docPrefix: docXml.substring(0, bodyStart),
    sectPr,
    docSuffix: docXml.substring(bodyEnd),
  };
}

function extractReferencedMedia(bodyXml: string, relsXml: string | null): Set<string> {
  const targets = new Set<string>();
  if (!relsXml) return targets;
  const ridRe = /r:(?:id|embed|link)="([^"]+)"/g;
  const rids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = ridRe.exec(bodyXml)) !== null) rids.add(m[1]);
  const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  while ((m = relRe.exec(relsXml)) !== null) {
    if (rids.has(m[1])) {
      const target = m[2].replace(/^\//, "");
      targets.add(target.startsWith("word/") ? target : `word/${target}`);
    }
  }
  return targets;
}

async function buildChapterDocx(
  srcZip: JSZip,
  parsed: ParsedDocx,
  startChunk: number,
  endChunk: number
): Promise<Blob> {
  if (!parsed || !parsed.chunks) throw new Error("文档解析数据为空");

  const safeStart = Math.max(0, Math.min(startChunk, parsed.chunks.length));
  const safeEnd = Math.max(safeStart, Math.min(endChunk, parsed.chunks.length));
  const slicedChunks = parsed.chunks.slice(safeStart, safeEnd);

  if (slicedChunks.length === 0) {
    const emptyBody = '<w:p><w:r><w:t>（本章节内容为空）</w:t></w:r></w:p>';
    const newDocXml = parsed.docPrefix + emptyBody + parsed.sectPr + parsed.docSuffix;
    const out = new JSZip();
    const jobs: Promise<void>[] = [];
    srcZip.forEach((path, entry) => {
      if (entry.dir || path === "word/document.xml" || path.startsWith("word/media/")) return;
      jobs.push(entry.async("uint8array").then((d) => { out.file(path, d); }));
    });
    await Promise.all(jobs);
    out.file("word/document.xml", newDocXml);
    return out.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  const bodyXml = slicedChunks.map((c) => c.xml).join("");
  const newDocXml = parsed.docPrefix + bodyXml + parsed.sectPr + parsed.docSuffix;

  let relsXml: string | null = null;
  try {
    const relsFile = srcZip.file("word/_rels/document.xml.rels");
    if (relsFile) relsXml = await relsFile.async("string");
  } catch { /* ignore */ }
  const referencedMedia = extractReferencedMedia(bodyXml, relsXml);

  const out = new JSZip();
  const entries: { path: string; entry: JSZip.JSZipObject }[] = [];
  srcZip.forEach((path, entry) => {
    if (entry.dir || path === "word/document.xml") return;
    if (path.startsWith("word/media/") && !referencedMedia.has(path)) return;
    entries.push({ path, entry });
  });

  for (const { path, entry } of entries) {
    try {
      const d = await entry.async("uint8array");
      out.file(path, d);
    } catch (e) {
      console.warn(`Skip file ${path}:`, e);
    }
  }
  out.file("word/document.xml", newDocXml);
  return out.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ─── Chapter mapping ───────────────────────────────────────────────

interface ChapterFromAPI {
  section_number: string;
  title: string;
  level: number;
  content: string;
  textStart: number;
  textEnd: number;
}

interface ChapterWithRange extends ChapterFromAPI {
  startChunk: number;
  endChunk: number;
}

function mapChaptersToChunks(chapters: ChapterFromAPI[], parsed: ParsedDocx): ChapterWithRange[] {
  const { chunks } = parsed;
  const starts: number[] = [];
  let pos = 0;
  for (const c of chunks) { starts.push(pos); pos += c.text.length; }

  const valid = chapters.filter((ch) => ch.textStart >= 0);
  const withStart = valid.map((ch) => {
    let sc = 0;
    for (let j = 0; j < starts.length; j++) {
      const chunkEnd = starts[j] + chunks[j].text.length;
      if (ch.textStart < chunkEnd) { sc = j; break; }
      if (j === starts.length - 1) sc = j;
    }
    return { ...ch, startChunk: Math.max(0, sc) };
  });

  return withStart.map((ch, i) => ({
    ...ch,
    endChunk: i + 1 < withStart.length ? withStart[i + 1].startChunk : chunks.length,
  }));
}

// ─── Component ─────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export default function MaterialExtractor({ open, onOpenChange, onComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { activeTask, startTask, pauseTask, resumeTask, cancelTask, clearTask } = useExtractionTask();
  const fileRef = useRef<HTMLInputElement>(null);
  const parsedRef = useRef<ParsedDocx | null>(null);
  const zipRef = useRef<JSZip | null>(null);

  const [step, setStep] = useState<"upload" | "analyzing" | "select">("upload");
  const [chapters, setChapters] = useState<ChapterWithRange[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [autoSelecting, setAutoSelecting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [projectPrefix, setProjectPrefix] = useState("");
  const [analyzePhase, setAnalyzePhase] = useState<"uploading" | "ai" | "parsing">("uploading");
  const [projectCategory, setProjectCategory] = useState<"技术交付类" | "人力资源类" | "">("");

  const reset = () => {
    setStep("upload");
    setChapters([]);
    setSelected(new Set());
    setFileName("");
    setProjectPrefix("");
    setAnalyzePhase("uploading");
    setProjectCategory("");
    parsedRef.current = null;
    zipRef.current = null;
  };

  // If there's an active task, show its progress in the dialog
  const showingTask = activeTask && (activeTask.status === "running" || activeTask.status === "paused");
  const taskDone = activeTask && (activeTask.status === "done" || activeTask.status === "cancelled" || activeTask.status === "error");

  const handleClose = (v: boolean) => {
    if (!v) {
      // If task is running, just close dialog (task continues in background)
      reset();
    }
    onOpenChange(v);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!/\.docx$/i.test(file.name)) {
      toast({ title: "格式不支持", description: "目前仅支持DOCX格式文件", variant: "destructive" });
      return;
    }

    setFileName(file.name);
    setStep("analyzing");
    setAnalyzePhase("uploading");

    try {
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const docXml = await zip.file("word/document.xml")?.async("string");
      if (!docXml) throw new Error("无法读取DOCX文件内容");

      const parsed = parseDocxXml(docXml);
      if (!parsed || !parsed.chunks.length) throw new Error("无法解析文档结构");
      if (parsed.fullText.length < 50) throw new Error("文档内容过少");

      parsedRef.current = parsed;
      zipRef.current = zip;
      setAnalyzePhase("ai");

      const { data, error } = await supabase.functions.invoke("extract-bid-chapters", {
        body: { fullText: parsed.fullText },
      });
      if (error) throw new Error(error.message || "分析失败");
      if (data?.error) throw new Error(data.error);

      setAnalyzePhase("parsing");
      const chs: ChapterFromAPI[] = data.chapters || [];
      if (!chs.length) throw new Error("未识别到章节结构");

      const mapped = mapChaptersToChunks(chs, parsed);
      if (!mapped.length) throw new Error("无法将章节映射到文档结构");

      setChapters(mapped);
      setSelected(new Set(mapped.map((_, i) => i)));
      setProjectPrefix(extractProjectName(file.name));
      setStep("select");
    } catch (err: any) {
      toast({ title: "分析失败", description: err.message, variant: "destructive" });
      setStep("upload");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const toggleAll = (on: boolean) => setSelected(on ? new Set(chapters.map((_, i) => i)) : new Set());
  const toggleOne = (i: number) => { const s = new Set(selected); s.has(i) ? s.delete(i) : s.add(i); setSelected(s); };

  const handleAutoSelect = async () => {
    if (!chapters.length) return;
    setAutoSelecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("classify-bid-chapters", {
        body: { chapters: chapters.map(ch => ({ section_number: ch.section_number, title: ch.title })) },
      });
      if (error) throw new Error(error.message || "AI分类失败");
      if (data?.error) throw new Error(data.error);
      const indices: number[] = data?.selected_indices || [];
      setSelected(new Set(indices));
      toast({ title: "智能选择完成", description: `已自动选中 ${indices.length} 个证明文件类章节` });
    } catch (err: any) {
      toast({ title: "智能选择失败", description: err.message, variant: "destructive" });
    } finally {
      setAutoSelecting(false);
    }
  };

  const handleSave = async () => {
    if (!user || !selected.size || !parsedRef.current || !zipRef.current) return;

    const projectName = projectPrefix.trim() || fileName.replace(/\.docx$/i, "");
    const allChaptersToc = chapters.map(ch => ({
      section_number: ch.section_number,
      title: ch.title,
      level: ch.level,
    }));

    // Capture refs for closure
    const capturedParsed = parsedRef.current;
    const capturedZip = zipRef.current;

    startTask({
      userId: user.id,
      fileName,
      projectName,
      projectCategory,
      chapters,
      selectedIndices: Array.from(selected),
      buildChapterDocx: (startChunk: number, endChunk: number) =>
        buildChapterDocx(capturedZip, capturedParsed, startChunk, endChunk),
      allChaptersToc,
      onComplete,
    });

    // Dialog stays open showing progress; user can close to run in background
  };

  const fmtSize = (s: string) => { const n = s.length; return n > 1000 ? `${(n / 1000).toFixed(1)}K字` : `${n}字`; };

  const extractProjectName = (raw: string): string => {
    let name = raw.replace(/\.docx$/i, "");
    let year = "", month = "";
    const dateMatch = name.match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
    if (dateMatch) { year = dateMatch[1]; month = dateMatch[2]; }
    name = name.replace(/[-_ ]*\d{4}[-.]?\d{2}[-.]?\d{2}[-_ ]*/g, "");
    name = name.replace(/^(投标文件|招标文件|技术方案|商务标|技术标)[-_—–\s]*/g, "");
    name = name
      .replace(/[-_—–\s]*(修订版|最终版|终稿|定稿|正式版|final|v\d+).*$/gi, "")
      .replace(/\(\d+\)/g, "").replace(/（\d+）/g, "")
      .replace(/[-_\s]+$/g, "").replace(/^[-_\s]+/g, "").trim();
    name = name.replace(/投标文件/g, "").trim();
    const datePart = year && month ? `${year}年${month}月` : "";
    return datePart ? `${datePart}${name}` : name || raw.replace(/\.docx$/i, "");
  };

  // ── render ──
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            标书材料提取
          </DialogTitle>
        </DialogHeader>

        {/* Show active task progress */}
        {showingTask && activeTask && (
          <div className="space-y-4 py-8">
            <p className="text-center text-sm font-medium">
              {activeTask.phase === "saving" ? "正在保存章节文件..." : "正在识别并导入人员简历..."}
              {activeTask.status === "paused" && (
                <span className="text-yellow-600 dark:text-yellow-400 ml-2">（已暂停）</span>
              )}
            </p>
            <Progress value={activeTask.total > 0 ? (activeTask.current / activeTask.total) * 100 : 0} />
            <p className="text-center text-xs text-muted-foreground">
              {activeTask.phase === "saving"
                ? `${activeTask.current} / ${activeTask.total} 个章节已保存`
                : "AI 正在提取简历信息并导入简历工厂"}
            </p>
            <div className="flex justify-center gap-3">
              {activeTask.status === "running" && (
                <Button variant="outline" size="sm" onClick={pauseTask} className="gap-1.5">
                  <Pause className="w-4 h-4" /> 暂停
                </Button>
              )}
              {activeTask.status === "paused" && (
                <Button variant="outline" size="sm" onClick={resumeTask} className="gap-1.5">
                  <Play className="w-4 h-4" /> 继续
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={cancelTask} className="gap-1.5">
                <X className="w-4 h-4" /> 取消提取
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
                转入后台
              </Button>
            </div>
          </div>
        )}

        {/* Task done/cancelled/error */}
        {taskDone && activeTask && (
          <div className="flex flex-col items-center gap-4 py-8">
            {activeTask.status === "done" && (
              <>
                <Check className="w-12 h-12 text-primary" />
                <p className="font-medium">提取完成</p>
                {activeTask.resumeImportResult && (activeTask.resumeImportResult.created.length > 0 || activeTask.resumeImportResult.merged.length > 0) && (
                  <div className="bg-muted/50 rounded-lg p-3 w-full max-w-md space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-accent" />
                      简历已自动导入简历工厂
                    </p>
                    {activeTask.resumeImportResult.created.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <span className="text-primary font-medium">新增：</span>
                        {activeTask.resumeImportResult.created.join("、")}
                      </p>
                    )}
                    {activeTask.resumeImportResult.merged.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <span className="text-accent font-medium">更新：</span>
                        {activeTask.resumeImportResult.merged.join("、")}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {activeTask.status === "cancelled" && (
              <>
                <X className="w-12 h-12 text-muted-foreground" />
                <p className="font-medium">提取已取消</p>
                <p className="text-sm text-muted-foreground">已保存的章节不受影响</p>
              </>
            )}
            {activeTask.status === "error" && (
              <>
                <X className="w-12 h-12 text-destructive" />
                <p className="font-medium">提取失败</p>
                <p className="text-sm text-muted-foreground">{activeTask.errorMessage}</p>
              </>
            )}
            <Button onClick={() => { clearTask(); handleClose(false); }}>关闭</Button>
          </div>
        )}

        {/* Upload / Analyze / Select steps - only when no active task */}
        {!showingTask && !taskDone && (
          <>
            {step === "upload" && (
              <div className="flex flex-col items-center gap-4 py-8">
                <p className="text-muted-foreground text-sm text-center">
                  上传现有标书文件（DOCX格式），系统将自动提取目录结构，
                  <br />您可以选择需要提取的章节，保存为独立的Word文件（保留原格式）
                </p>
                <input ref={fileRef} type="file" className="hidden" accept=".docx" onChange={handleFileSelect} />
                <Button onClick={() => fileRef.current?.click()} className="gap-2">
                  <Upload className="w-4 h-4" /> 选择DOCX文件
                </Button>
              </div>
            )}

            {step === "analyzing" && (
              <div className="flex flex-col items-center gap-5 py-10">
                <Loader2 className="w-10 h-10 animate-spin text-accent" />
                <div className="w-full max-w-xs space-y-3">
                  {([
                    { key: "uploading" as const, label: "解析文件结构" },
                    { key: "ai" as const, label: "AI 分析章节目录" },
                    { key: "parsing" as const, label: "映射章节内容" },
                  ] as const).map((phase, idx) => {
                    const order = ["uploading", "ai", "parsing"];
                    const cur = order.indexOf(analyzePhase);
                    const done = idx < cur;
                    const active = idx === cur;
                    return (
                      <div key={phase.key} className="flex items-center gap-3">
                        {done ? <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          : active ? <Loader2 className="w-4 h-4 animate-spin text-accent flex-shrink-0" />
                          : <div className="w-4 h-4 rounded-full border border-muted-foreground/30 flex-shrink-0" />}
                        <span className={`text-sm ${active ? "text-foreground font-medium" : done ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                          {phase.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">{fileName}</p>
              </div>
            )}

            {step === "select" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <label className="text-sm text-muted-foreground whitespace-nowrap">项目简称</label>
                    <Input value={projectPrefix} onChange={(e) => setProjectPrefix(e.target.value)} placeholder="如：XX市政工程" className="max-w-xs" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-muted-foreground whitespace-nowrap">项目类型</label>
                    <div className="flex gap-1.5">
                      <Badge
                        variant={projectCategory === "技术交付类" ? "default" : "outline"}
                        className={`cursor-pointer transition-colors ${projectCategory === "技术交付类" ? "bg-blue-600 hover:bg-blue-700 text-white" : "hover:bg-blue-50 dark:hover:bg-blue-950"}`}
                        onClick={() => setProjectCategory(projectCategory === "技术交付类" ? "" : "技术交付类")}
                      >
                        <Wrench className="w-3 h-3 mr-1" />技术交付类
                      </Badge>
                      <Badge
                        variant={projectCategory === "人力资源类" ? "default" : "outline"}
                        className={`cursor-pointer transition-colors ${projectCategory === "人力资源类" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "hover:bg-emerald-50 dark:hover:bg-emerald-950"}`}
                        onClick={() => setProjectCategory(projectCategory === "人力资源类" ? "" : "人力资源类")}
                      >
                        <Users className="w-3 h-3 mr-1" />人力资源类
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    共识别 <span className="font-bold text-foreground">{chapters.length}</span> 个章节，已选{" "}
                    <span className="font-bold text-foreground">{selected.size}</span> 个
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleAutoSelect} disabled={autoSelecting} className="gap-1">
                      {autoSelecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      智能选择
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => toggleAll(true)}>全选</Button>
                    <Button variant="outline" size="sm" onClick={() => toggleAll(false)}>全不选</Button>
                  </div>
                </div>

                <div className="border rounded-md max-h-[50vh] overflow-y-auto">
                  {chapters.map((ch, idx) => (
                    <label
                      key={idx}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                      style={{ paddingLeft: `${(ch.level - 1) * 20 + 12}px` }}
                    >
                      <Checkbox checked={selected.has(idx)} onCheckedChange={() => toggleOne(idx)} />
                      <span className="text-sm flex-1">
                        <span className="text-muted-foreground mr-1">{ch.section_number}</span>
                        <span className={ch.level === 1 ? "font-semibold" : ""}>{ch.title}</span>
                      </span>
                      {ch.content && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtSize(ch.content)}</span>
                      )}
                    </label>
                  ))}
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => handleClose(false)}>取消</Button>
                  <Button onClick={handleSave} disabled={!selected.size} className="gap-2">
                    <Check className="w-4 h-4" /> 提取并保存 ({selected.size})
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
