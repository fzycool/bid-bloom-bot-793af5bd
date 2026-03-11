import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
import { Loader2, Upload, FileText, Check, Sparkles, Wrench, Users } from "lucide-react";
import JSZip from "jszip";

// ─── DOCX XML helpers ─────────────────────────────────────────────

interface DocxChunk {
  xml: string;  // raw XML slice (between consecutive </w:p> boundaries)
  text: string; // plain-text extracted from that slice
}

interface ParsedDocx {
  chunks: DocxChunk[];
  fullText: string;   // chunks texts joined – sent to edge function
  docPrefix: string;  // everything before <w:body> inner content
  sectPr: string;     // <w:sectPr …>…</w:sectPr>
  docSuffix: string;  // </w:body></w:document>
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

  // Split at every </w:p> boundary (paragraph-level chunks)
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

/** Extract referenced media/image IDs from XML content */
function extractReferencedMedia(bodyXml: string, relsXml: string | null): Set<string> {
  const targets = new Set<string>();
  if (!relsXml) return targets;

  // Find all r:id references in body XML
  const ridRe = /r:(?:id|embed|link)="([^"]+)"/g;
  const rids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = ridRe.exec(bodyXml)) !== null) rids.add(m[1]);

  // Parse rels to find file targets for referenced IDs
  const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  while ((m = relRe.exec(relsXml)) !== null) {
    if (rids.has(m[1])) {
      // Target is relative to word/ folder
      const target = m[2].replace(/^\//, "");
      targets.add(target.startsWith("word/") ? target : `word/${target}`);
    }
  }
  return targets;
}

/** Build a new .docx blob by replacing document.xml body with a slice of chunks */
async function buildChapterDocx(
  srcZip: JSZip,
  parsed: ParsedDocx,
  startChunk: number,
  endChunk: number
): Promise<Blob> {
  if (!parsed || !parsed.chunks) {
    throw new Error("文档解析数据为空，无法生成章节文件");
  }

  // Clamp range to valid bounds
  const safeStart = Math.max(0, Math.min(startChunk, parsed.chunks.length));
  const safeEnd = Math.max(safeStart, Math.min(endChunk, parsed.chunks.length));

  const slicedChunks = parsed.chunks.slice(safeStart, safeEnd);
  if (slicedChunks.length === 0) {
    // Generate a minimal document with a placeholder paragraph
    const emptyBody = '<w:p><w:r><w:t>（本章节内容为空）</w:t></w:r></w:p>';
    const newDocXml = parsed.docPrefix + emptyBody + parsed.sectPr + parsed.docSuffix;
    const out = new JSZip();
    // Copy only essential non-media files
    const jobs: Promise<void>[] = [];
    srcZip.forEach((path, entry) => {
      if (entry.dir) return;
      if (path === "word/document.xml") return;
      if (path.startsWith("word/media/")) return;
      jobs.push(entry.async("uint8array").then((d) => { out.file(path, d); }));
    });
    await Promise.all(jobs);
    out.file("word/document.xml", newDocXml);
    return out.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  const bodyXml = slicedChunks.map((c) => c.xml).join("");
  const newDocXml = parsed.docPrefix + bodyXml + parsed.sectPr + parsed.docSuffix;

  // Get rels to find referenced media
  let relsXml: string | null = null;
  try {
    const relsFile = srcZip.file("word/_rels/document.xml.rels");
    if (relsFile) relsXml = await relsFile.async("string");
  } catch { /* ignore */ }
  const referencedMedia = extractReferencedMedia(bodyXml, relsXml);

  // Clone zip files sequentially to avoid internal state corruption
  const out = new JSZip();
  const entries: { path: string; entry: JSZip.JSZipObject }[] = [];
  srcZip.forEach((path, entry) => {
    if (entry.dir) return;
    if (path === "word/document.xml") return;
    if (path.startsWith("word/media/") && !referencedMedia.has(path)) return;
    entries.push({ path, entry });
  });

  for (const { path, entry } of entries) {
    try {
      const d = await entry.async("uint8array");
      out.file(path, d);
    } catch (e) {
      console.warn(`Skip file ${path} due to read error:`, e);
    }
  }

  out.file("word/document.xml", newDocXml);

  return out.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
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

function mapChaptersToChunks(
  chapters: ChapterFromAPI[],
  parsed: ParsedDocx
): ChapterWithRange[] {
  const { chunks } = parsed;

  // Build cumulative text-position array for chunks
  const starts: number[] = [];
  let pos = 0;
  for (const c of chunks) {
    starts.push(pos);
    pos += c.text.length;
  }

  // Find the start chunk for each chapter (the chunk containing textStart)
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

  // Sequential gap-free assignment:
  // Each chapter's endChunk = next chapter's startChunk (or total chunks for last)
  return withStart.map((ch, i) => ({
    ...ch,
    endChunk: i + 1 < withStart.length
      ? withStart[i + 1].startChunk
      : chunks.length,
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
  const fileRef = useRef<HTMLInputElement>(null);
  const parsedRef = useRef<ParsedDocx | null>(null);
  const zipRef = useRef<JSZip | null>(null);

  const [step, setStep] = useState<"upload" | "analyzing" | "select" | "saving" | "importing_resumes" | "done">("upload");
  const [chapters, setChapters] = useState<ChapterWithRange[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [resumeImportResult, setResumeImportResult] = useState<{ created: string[]; merged: string[] } | null>(null);
  const [autoSelecting, setAutoSelecting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [projectPrefix, setProjectPrefix] = useState("");
  const [analyzePhase, setAnalyzePhase] = useState<"uploading" | "ai" | "parsing">("uploading");
  const [projectCategory, setProjectCategory] = useState<"技术交付类" | "人力资源类" | "">("");

  const reset = () => {
    setStep("upload");
    setChapters([]);
    setSelected(new Set());
    setProgress({ current: 0, total: 0 });
    setFileName("");
    setProjectPrefix("");
    setAnalyzePhase("uploading");
    setProjectCategory("");
    setResumeImportResult(null);
    parsedRef.current = null;
    zipRef.current = null;
  };

  const handleClose = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  // ── file select ──
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
      if (parsed.fullText.length < 50) throw new Error("文档内容过少，无法提取章节结构");

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

  // ── selection ──
  const toggleAll = (on: boolean) => setSelected(on ? new Set(chapters.map((_, i) => i)) : new Set());
  const toggleOne = (i: number) => { const s = new Set(selected); s.has(i) ? s.delete(i) : s.add(i); setSelected(s); };

  // ── auto-select certificate chapters via AI ──
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

  // ── save ──
  const handleSave = async () => {
    if (!user || !selected.size || !parsedRef.current || !zipRef.current) return;
    setStep("saving");

    const sel = chapters.filter((_, i) => selected.has(i));
    setProgress({ current: 0, total: sel.length });

    const prefix = projectPrefix.trim() ? `${projectPrefix.trim()}_` : "";
    const projectName = projectPrefix.trim() || fileName.replace(/\.docx$/i, "");

    // Create a bid_analysis record to group extracted materials
    // Store TOC structure (all chapters, not just selected) and category
    const tocStructure = chapters.map(ch => ({
      section_number: ch.section_number,
      title: ch.title,
      level: ch.level,
    }));

    const { data: analysis, error: analysisErr } = await supabase
      .from("bid_analyses")
      .insert({
        user_id: user.id,
        project_name: projectName,
        ai_status: "completed",
        project_category: projectCategory || null,
        document_structure: tocStructure,
        summary: `从「${fileName}」提取，共${chapters.length}个章节`,
      } as any)
      .select("id")
      .single();

    if (analysisErr || !analysis) {
      toast({ title: "创建项目失败", description: analysisErr?.message, variant: "destructive" });
      setStep("select");
      return;
    }

    const analysisId = (analysis as any).id;

    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      setProgress({ current: i + 1, total: sel.length });
      try {
        const blob = await buildChapterDocx(zipRef.current!, parsedRef.current!, ch.startChunk, ch.endChunk);
        // Supabase Storage only allows ASCII keys — use pure numeric path
        // Chinese title is preserved in database record (file_name column)
        const storagePath = `${user.id}/${Date.now()}_ch${i}.docx`;
        const { error: upErr } = await supabase.storage
          .from("company-materials")
          .upload(storagePath, blob, {
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
        if (upErr) throw upErr;

        await supabase.from("company_materials").insert({
          user_id: user.id,
          file_name: `${prefix}${ch.section_number} ${ch.title}.docx`,
          file_path: storagePath,
          file_size: blob.size,
          file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ai_status: "completed",
          content_description: `从「${fileName}」提取的章节内容`,
          material_type: "标书章节",
          bid_analysis_id: analysisId,
        });
      } catch (err: any) {
        console.error(`Save chapter ${ch.section_number} error:`, err);
        toast({ title: `保存失败: ${ch.section_number} ${ch.title}`, description: err.message, variant: "destructive" });
      }
    }

    // ── Auto-detect and import resume chapters ──
    const resumeTitleKeywords = [
      "简历", "人员", "履历", "项目经理", "技术负责人", "项目总监",
      "拟投入", "团队成员", "主要人员", "人员配置", "人员组织",
      "项目团队", "投标人员", "拟派人员", "管理人员", "技术人员",
      "项目组", "人员安排", "岗位人员", "人力资源", "组织机构",
      "项目部", "负责人", "总工", "总监理", "安全员", "质量员",
    ];
    const resumeContentPatterns = [
      /姓\s*名[\s:：]/,
      /性\s*别[\s:：].{0,4}[男女]/,
      /出生.{0,6}\d{4}/,
      /学\s*历[\s:：]/,
      /毕业院校|毕业学校/,
      /工作经[历验]/,
      /项目经[历验]/,
      /职\s*称[\s:：]/,
      /身份证/,
      /执业资格|资格证书|注册.*师/,
    ];
    const resumeChapters = sel.filter(ch => {
      // Check title keywords
      const titleText = `${ch.section_number} ${ch.title}`;
      if (resumeTitleKeywords.some(kw => titleText.includes(kw))) return true;
      // Check content for resume patterns (at least 2 matches = likely a resume)
      const contentSample = (ch.content || "").substring(0, 3000);
      if (!contentSample) return false;
      let patternHits = 0;
      for (const pat of resumeContentPatterns) {
        if (pat.test(contentSample)) patternHits++;
        if (patternHits >= 2) return true;
      }
      return false;
    });

    if (resumeChapters.length > 0) {
      setStep("importing_resumes");
      setProgress({ current: 0, total: resumeChapters.length });

      try {
        const chaptersForImport = resumeChapters.map(ch => ({
          section_number: ch.section_number,
          title: ch.title,
          content: ch.content || "",
        }));

        const { data: importResult, error: importErr } = await supabase.functions.invoke("resume-factory", {
          body: {
            action: "import-from-chapters",
            userId: user.id,
            chapters: chaptersForImport,
          },
        });

        if (!importErr && importResult?.results?.length) {
          const created = importResult.results.filter((r: any) => r.action === "created").map((r: any) => r.name);
          const merged = importResult.results.filter((r: any) => r.action === "merged").map((r: any) => r.name);
          setResumeImportResult({ created, merged });

          const parts: string[] = [];
          if (created.length) parts.push(`新增${created.length}人`);
          if (merged.length) parts.push(`更新${merged.length}人`);
          toast({ title: "简历已自动导入", description: `${parts.join("，")}至简历工厂` });
        }
      } catch (err: any) {
        console.error("Resume import error:", err);
        // Non-fatal: don't block the save flow
      }
    }

    setStep("done");
    toast({ title: "提取完成", description: `成功保存${sel.length}个章节到项目「${projectName}」` });
    onComplete();
  };

  const fmtSize = (s: string) => { const n = s.length; return n > 1000 ? `${(n / 1000).toFixed(1)}K字` : `${n}字`; };

  /** Extract a clean project name from raw filename */
  const extractProjectName = (raw: string): string => {
    let name = raw.replace(/\.docx$/i, "");

    // Extract date: 20230908 or 2023-09-08 or 2023.09.08
    let year = "", month = "";
    const dateMatch = name.match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
    if (dateMatch) {
      year = dateMatch[1];
      month = dateMatch[2];
    }

    // Remove date patterns
    name = name.replace(/[-_ ]*\d{4}[-.]?\d{2}[-.]?\d{2}[-_ ]*/g, "");

    // Remove common prefixes
    name = name.replace(/^(投标文件|招标文件|技术方案|商务标|技术标)[-_—–\s]*/g, "");

    // Remove common suffixes and noise
    name = name
      .replace(/[-_—–\s]*(修订版|最终版|终稿|定稿|正式版|final|v\d+).*$/gi, "")
      .replace(/\(\d+\)/g, "")        // (1), (2)
      .replace(/（\d+）/g, "")         // （1）
      .replace(/[-_\s]+$/g, "")        // trailing separators
      .replace(/^[-_\s]+/g, "")        // leading separators
      .trim();

    // Remove redundant "投标文件" within the name
    name = name.replace(/投标文件/g, "").trim();

    // Build final name with date prefix
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
                <Input
                  value={projectPrefix}
                  onChange={(e) => setProjectPrefix(e.target.value)}
                  placeholder="如：XX市政工程"
                  className="max-w-xs"
                />
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

        {(step === "saving" || step === "importing_resumes") && (
          <div className="space-y-4 py-8">
            <p className="text-center text-sm font-medium">
              {step === "saving" ? "正在保存章节文件..." : "正在识别并导入人员简历..."}
            </p>
            <Progress value={(progress.current / progress.total) * 100} />
            <p className="text-center text-xs text-muted-foreground">
              {step === "saving"
                ? `${progress.current} / ${progress.total} 个章节已保存`
                : "AI 正在提取简历信息并导入简历工厂"}
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Check className="w-12 h-12 text-primary" />
            <p className="font-medium">提取完成</p>
            {resumeImportResult && (resumeImportResult.created.length > 0 || resumeImportResult.merged.length > 0) && (
              <div className="bg-muted/50 rounded-lg p-3 w-full max-w-md space-y-2">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-accent" />
                  简历已自动导入简历工厂
                </p>
                {resumeImportResult.created.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    <span className="text-primary font-medium">新增：</span>
                    {resumeImportResult.created.join("、")}
                  </p>
                )}
                {resumeImportResult.merged.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    <span className="text-accent font-medium">更新：</span>
                    {resumeImportResult.merged.join("、")}
                  </p>
                )}
              </div>
            )}
            <Button onClick={() => handleClose(false)}>关闭</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
