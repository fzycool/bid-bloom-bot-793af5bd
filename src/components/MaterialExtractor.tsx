import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Upload, FileText, Check } from "lucide-react";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

interface Chapter {
  section_number: string;
  title: string;
  level: number;
  content: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export default function MaterialExtractor({
  open,
  onOpenChange,
  onComplete,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<
    "upload" | "analyzing" | "select" | "saving" | "done"
  >("upload");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [fileName, setFileName] = useState("");
  const [analyzePhase, setAnalyzePhase] = useState<"uploading" | "ai" | "parsing">("uploading");

  const reset = () => {
    setStep("upload");
    setChapters([]);
    setSelected(new Set());
    setProgress({ current: 0, total: 0 });
    setFileName("");
    setAnalyzePhase("uploading");
  };

  const handleClose = (val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  };

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!/\.docx$/i.test(file.name)) {
      toast({
        title: "格式不支持",
        description: "目前仅支持DOCX格式文件",
        variant: "destructive",
      });
      return;
    }

    setFileName(file.name);
    setStep("analyzing");
    setAnalyzePhase("uploading");

    try {
      // Upload to temp path
      const tempPath = `${user.id}/extract_${Date.now()}.docx`;
      const { error: upErr } = await supabase.storage
        .from("company-materials")
        .upload(tempPath, file);
      if (upErr) throw upErr;

      setAnalyzePhase("ai");

      // Call edge function
      const { data, error } = await supabase.functions.invoke(
        "extract-bid-chapters",
        { body: { filePath: tempPath } }
      );

      // Clean up temp file
      await supabase.storage
        .from("company-materials")
        .remove([tempPath]);

      if (error) throw new Error(error.message || "分析失败");
      if (data?.error) throw new Error(data.error);

      setAnalyzePhase("parsing");

      const chs: Chapter[] = data.chapters || [];
      if (!chs.length) throw new Error("未识别到章节结构");

      setChapters(chs);
      setSelected(new Set(chs.map((_, i) => i)));
      setStep("select");
    } catch (err: any) {
      toast({
        title: "分析失败",
        description: err.message,
        variant: "destructive",
      });
      setStep("upload");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(chapters.map((_, i) => i)) : new Set());
  };

  const toggleOne = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
  };

  const handleSave = async () => {
    if (!user || !selected.size) return;
    setStep("saving");

    const selectedChapters = chapters.filter((_, i) => selected.has(i));
    setProgress({ current: 0, total: selectedChapters.length });

    for (let i = 0; i < selectedChapters.length; i++) {
      const ch = selectedChapters[i];
      setProgress({ current: i + 1, total: selectedChapters.length });

      try {
        // Generate .docx
        const paragraphs = ch.content
          .split("\n")
          .filter((l) => l.trim())
          .map(
            (line) =>
              new Paragraph({
                children: [new TextRun({ text: line })],
              })
          );

        const doc = new Document({
          sections: [
            {
              children: [
                new Paragraph({
                  heading: HeadingLevel.HEADING_1,
                  children: [
                    new TextRun({
                      text: `${ch.section_number} ${ch.title}`,
                      bold: true,
                    }),
                  ],
                }),
                ...paragraphs,
              ],
            },
          ],
        });

        const blob = await Packer.toBlob(doc);

        // Storage path (ASCII only)
        const storagePath = `${user.id}/${Date.now()}_chapter_${i}.docx`;
        const { error: upErr } = await supabase.storage
          .from("company-materials")
          .upload(storagePath, blob, {
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
        if (upErr) throw upErr;

        // Insert record with display name as chapter title
        const displayName = `${ch.section_number} ${ch.title}.docx`;
        await supabase.from("company_materials").insert({
          user_id: user.id,
          file_name: displayName,
          file_path: storagePath,
          file_size: blob.size,
          file_type:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ai_status: "completed",
          content_description: `从「${fileName}」提取的章节内容`,
          material_type: "标书章节",
        });
      } catch (err: any) {
        console.error(`Save chapter ${ch.section_number} error:`, err);
        toast({
          title: `保存失败: ${ch.section_number} ${ch.title}`,
          description: err.message,
          variant: "destructive",
        });
      }
    }

    setStep("done");
    toast({
      title: "提取完成",
      description: `成功保存${selectedChapters.length}个章节`,
    });
    onComplete();
  };

  const formatContentSize = (content: string) => {
    const len = content.length;
    return len > 1000 ? `${(len / 1000).toFixed(1)}K字` : `${len}字`;
  };

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
              <br />
              您可以选择需要提取的章节，保存为独立的Word文件
            </p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".docx"
              onChange={handleFileSelect}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              选择DOCX文件
            </Button>
          </div>
        )}

        {step === "analyzing" && (
          <div className="flex flex-col items-center gap-5 py-10">
            <Loader2 className="w-10 h-10 animate-spin text-accent" />
            <div className="w-full max-w-xs space-y-3">
              {[
                { key: "uploading" as const, label: "上传文件" },
                { key: "ai" as const, label: "AI 分析文档结构" },
                { key: "parsing" as const, label: "解析章节内容" },
              ].map((phase, idx) => {
                const phases = ["uploading", "ai", "parsing"];
                const currentIdx = phases.indexOf(analyzePhase);
                const phaseIdx = idx;
                const isDone = phaseIdx < currentIdx;
                const isCurrent = phaseIdx === currentIdx;
                return (
                  <div key={phase.key} className="flex items-center gap-3">
                    {isDone ? (
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    ) : isCurrent ? (
                      <Loader2 className="w-4 h-4 animate-spin text-accent flex-shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                    )}
                    <span className={`text-sm ${isCurrent ? "text-foreground font-medium" : isDone ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
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
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                共识别{" "}
                <span className="font-bold text-foreground">
                  {chapters.length}
                </span>{" "}
                个章节，已选{" "}
                <span className="font-bold text-foreground">
                  {selected.size}
                </span>{" "}
                个
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleAll(true)}
                >
                  全选
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleAll(false)}
                >
                  全不选
                </Button>
              </div>
            </div>

            <div className="border rounded-md max-h-[50vh] overflow-y-auto">
              {chapters.map((ch, idx) => (
                <label
                  key={idx}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                  style={{
                    paddingLeft: `${(ch.level - 1) * 20 + 12}px`,
                  }}
                >
                  <Checkbox
                    checked={selected.has(idx)}
                    onCheckedChange={() => toggleOne(idx)}
                  />
                  <span className="text-sm flex-1">
                    <span className="text-muted-foreground mr-1">
                      {ch.section_number}
                    </span>
                    <span
                      className={ch.level === 1 ? "font-semibold" : ""}
                    >
                      {ch.title}
                    </span>
                  </span>
                  {ch.content && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatContentSize(ch.content)}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>
                取消
              </Button>
              <Button
                onClick={handleSave}
                disabled={!selected.size}
                className="gap-2"
              >
                <Check className="w-4 h-4" />
                提取并保存 ({selected.size})
              </Button>
            </div>
          </div>
        )}

        {step === "saving" && (
          <div className="space-y-4 py-8">
            <p className="text-center text-sm font-medium">
              正在保存章节文件...
            </p>
            <Progress
              value={(progress.current / progress.total) * 100}
            />
            <p className="text-center text-xs text-muted-foreground">
              {progress.current} / {progress.total} 个章节已保存
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Check className="w-12 h-12 text-green-500" />
            <p className="font-medium">提取完成</p>
            <Button onClick={() => handleClose(false)}>关闭</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
