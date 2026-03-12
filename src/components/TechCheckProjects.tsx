import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Trash2,
  FolderOpen,
  FileText,
  FileUp,
  X,
  Pencil,
  Check,
  FileType2,
  File,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  AlertTriangle,
  XCircle,
  ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";

interface TechCheckProject {
  id: string;
  project_name: string;
  created_at: string;
  updated_at: string;
}

interface TechCheckFile {
  id: string;
  project_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string | null;
  category: string;
  created_at: string;
}

interface FileUploadStatus {
  fileName: string;
  fileSize: number;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
}

interface CheckItem {
  id: string;
  category: string;
  title: string;
  description: string;
  status: "unchecked" | "pass" | "fail" | "warning";
  notes: string;
  severity: "critical" | "major" | "minor";
}

interface CheckList {
  id: string;
  name: string;
  projectName: string;
  items: CheckItem[];
  createdAt: string;
  updatedAt: string;
}

interface QCResult {
  itemIndex: number;
  status: "pass" | "fail" | "warning";
  score: number;
  finding: string;
  suggestion?: string;
}

interface QCReport {
  results: QCResult[];
  overallScore: number;
  summary: string;
  checkItems: CheckItem[];
  projectName: string;
  timestamp: string;
}

const ACCEPTED_BID = ".pdf,.docx,.doc";
const ACCEPTED_PROPOSAL = ".docx,.doc";
const STORAGE_KEY = "tech-bid-checklists";

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const TechCheckProjects = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<TechCheckProject[]>([]);
  const [files, setFiles] = useState<TechCheckFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);

  // Per-file upload tracking
  const [fileStatuses, setFileStatuses] = useState<FileUploadStatus[]>([]);
  // Error dialog
  const [errorLogs, setErrorLogs] = useState<{ name: string; reason: string }[]>([]);
  const [showErrorDialog, setShowErrorDialog] = useState(false);

  // Quality check state
  const [showChecklistPicker, setShowChecklistPicker] = useState(false);
  const [pickerProjectId, setPickerProjectId] = useState<string | null>(null);
  const [qcRunning, setQcRunning] = useState<string | null>(null); // projectId currently running
  const [qcProgress, setQcProgress] = useState(0);
  const [qcReport, setQcReport] = useState<QCReport | null>(null);
  const [showQcResult, setShowQcResult] = useState(false);

  const bidInputRef = useRef<HTMLInputElement>(null);
  const proposalInputRef = useRef<HTMLInputElement>(null);
  const uploadProjectRef = useRef<string | null>(null);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    const [projRes, fileRes] = await Promise.all([
      supabase
        .from("techcheck_projects")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("techcheck_files")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);
    if (projRes.data) setProjects(projRes.data as TechCheckProject[]);
    if (fileRes.data) setFiles(fileRes.data as TechCheckFile[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  // Load checklists from localStorage
  const getChecklists = (): CheckList[] => {
    if (!user?.id) return [];
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}-${user.id}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  const createProject = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("techcheck_projects")
      .insert({ user_id: user.id, project_name: `质检项目 ${projects.length + 1}` } as any)
      .select("*")
      .single();
    if (error) return toast.error("创建失败: " + error.message);
    setProjects((prev) => [data as TechCheckProject, ...prev]);
    setExpandedProjectId((data as TechCheckProject).id);
    toast.success("项目已创建");
  };

  const deleteProject = async (id: string) => {
    const projFiles = files.filter((f) => f.project_id === id);
    if (projFiles.length > 0) {
      await supabase.storage
        .from("company-materials")
        .remove(projFiles.map((f) => f.file_path));
    }
    const { error } = await supabase.from("techcheck_projects").delete().eq("id", id);
    if (error) return toast.error("删除失败: " + error.message);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setFiles((prev) => prev.filter((f) => f.project_id !== id));
    if (expandedProjectId === id) setExpandedProjectId(null);
    toast.success("项目已删除");
  };

  const renameProject = async (id: string) => {
    if (!editName.trim()) return;
    const { error } = await supabase
      .from("techcheck_projects")
      .update({ project_name: editName.trim() } as any)
      .eq("id", id);
    if (error) return toast.error("重命名失败");
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, project_name: editName.trim() } : p))
    );
    setEditingId(null);
    toast.success("已重命名");
  };

  const updateFileStatus = (index: number, update: Partial<FileUploadStatus>) => {
    setFileStatuses((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...update } : s))
    );
  };

  const addErrorLog = (name: string, reason: string) => {
    setErrorLogs((prev) => [...prev, { name, reason }]);
    setShowErrorDialog(true);
  };

  const handleUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    projectId: string,
    category: "bid_document" | "technical_proposal"
  ) => {
    const uploadFiles = Array.from(e.target.files || []);
    if (uploadFiles.length === 0 || !user) return;
    e.target.value = "";

    setUploading(projectId);
    setErrorLogs([]);
    setShowErrorDialog(false);
    const categoryLabel = category === "bid_document" ? "招标文件" : "技术方案";

    const initialStatuses: FileUploadStatus[] = uploadFiles.map((f) => ({
      fileName: f.name,
      fileSize: f.size,
      status: "pending",
      progress: 0,
    }));
    setFileStatuses(initialStatuses);

    let successCount = 0;

    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i];
      updateFileStatus(i, { status: "uploading", progress: 10 });

      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (category === "bid_document" && !["pdf", "docx", "doc"].includes(ext)) {
        updateFileStatus(i, { status: "error", progress: 100, error: `格式不支持（.${ext}），仅支持 PDF/Word` });
        addErrorLog(file.name, `格式不支持（.${ext}），仅支持 PDF/Word`);
        continue;
      }
      if (category === "technical_proposal" && !["docx", "doc"].includes(ext)) {
        updateFileStatus(i, { status: "error", progress: 100, error: `格式不支持（.${ext}），仅支持 Word` });
        addErrorLog(file.name, `格式不支持（.${ext}），仅支持 Word`);
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        updateFileStatus(i, { status: "error", progress: 100, error: `文件大小 ${formatSize(file.size)} 超过 50MB 限制` });
        addErrorLog(file.name, `文件大小 ${formatSize(file.size)} 超过 50MB 限制`);
        continue;
      }

      updateFileStatus(i, { progress: 30 });

      const storagePath = `${user.id}/techcheck/${projectId}/${Date.now()}_${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("company-materials")
        .upload(storagePath, file, { contentType: file.type });

      if (uploadErr) {
        updateFileStatus(i, { status: "error", progress: 100, error: `存储上传失败：${uploadErr.message}` });
        addErrorLog(file.name, `存储上传失败：${uploadErr.message}`);
        continue;
      }

      updateFileStatus(i, { progress: 70 });

      const { data: fileRow, error: insertErr } = await supabase
        .from("techcheck_files")
        .insert({
          project_id: projectId,
          user_id: user.id,
          file_name: file.name,
          file_path: storagePath,
          file_size: file.size,
          file_type: file.type,
          category,
        } as any)
        .select("*")
        .single();

      if (insertErr) {
        updateFileStatus(i, { status: "error", progress: 100, error: `记录保存失败：${insertErr.message}` });
        addErrorLog(file.name, `记录保存失败：${insertErr.message}`);
        continue;
      }

      setFiles((prev) => [fileRow as TechCheckFile, ...prev]);
      successCount++;
      updateFileStatus(i, { status: "success", progress: 100 });
    }

    setUploading(null);

    const hasErrors = uploadFiles.length !== successCount;
    setTimeout(() => setFileStatuses([]), hasErrors ? 15000 : 4000);

    const totalFiles = uploadFiles.length;
    if (successCount === totalFiles) {
      toast.success(`🎉 全部上传成功！共上传 ${successCount} 个${categoryLabel}`);
    } else if (successCount > 0) {
      toast.warning(`⚠️ ${successCount} 个上传成功，${totalFiles - successCount} 个失败`);
    } else {
      toast.error(`❌ 全部上传失败！${totalFiles} 个文件未能上传`);
    }
  };

  const deleteFile = async (file: TechCheckFile) => {
    await supabase.storage.from("company-materials").remove([file.file_path]);
    const { error } = await supabase.from("techcheck_files").delete().eq("id", file.id);
    if (error) return toast.error("删除失败");
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
    toast.success("文件已删除");
  };

  const triggerBidUpload = (projectId: string) => {
    uploadProjectRef.current = projectId;
    bidInputRef.current?.click();
  };

  const triggerProposalUpload = (projectId: string) => {
    uploadProjectRef.current = projectId;
    proposalInputRef.current?.click();
  };

  const getProjectFiles = (projectId: string, category: string) =>
    files.filter((f) => f.project_id === projectId && f.category === category);

  // Quality check: open checklist picker
  const handleStartQC = (projectId: string) => {
    const bidFiles = getProjectFiles(projectId, "bid_document");
    const proposalFiles = getProjectFiles(projectId, "technical_proposal");
    if (bidFiles.length === 0) return toast.error("请先上传招标文件");
    if (proposalFiles.length === 0) return toast.error("请先上传技术方案");
    const checklists = getChecklists();
    if (checklists.length === 0) return toast.error("请先创建检查清单（在下方检查清单区域）");
    setPickerProjectId(projectId);
    setShowChecklistPicker(true);
  };

  // Extract text from a file stored in Supabase
  const extractFileText = async (filePath: string, fileName: string): Promise<{ name: string; text: string }> => {
    const { data, error } = await supabase.storage.from("company-materials").download(filePath);
    if (error || !data) throw new Error(`文件下载失败: ${fileName}`);

    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "docx" || ext === "doc") {
      // Use JSZip to extract text from DOCX on client side
      const JSZip = (await import("jszip")).default;
      try {
        const zip = await JSZip.loadAsync(await data.arrayBuffer());
        const docXml = await zip.file("word/document.xml")?.async("string");
        if (!docXml) return { name: fileName, text: "(无法解析文档内容)" };
        // Strip XML tags to get plain text
        const text = docXml
          .replace(/<w:br[^>]*\/>/gi, "\n")
          .replace(/<\/w:p>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return { name: fileName, text };
      } catch {
        // Fallback: try as plain text
        const text = await data.text();
        return { name: fileName, text };
      }
    }
    // PDF or other: extract as text (limited but avoids 413)
    const text = await data.text();
    return { name: fileName, text: text.slice(0, 50000) };
  };

  // Run quality check
  const runQualityCheck = async (projectId: string, checklist: CheckList) => {
    setShowChecklistPicker(false);
    setQcRunning(projectId);
    setQcProgress(10);

    const bidFiles = getProjectFiles(projectId, "bid_document");
    const proposalFiles = getProjectFiles(projectId, "technical_proposal");
    const project = projects.find(p => p.id === projectId);

    try {
      // Extract text from files on client side to avoid 413
      setQcProgress(15);
      toast.info("正在提取文件内容...");
      
      const [bidTexts, proposalTextsArr] = await Promise.all([
        Promise.all(bidFiles.map(f => extractFileText(f.file_path, f.file_name))),
        Promise.all(proposalFiles.map(f => extractFileText(f.file_path, f.file_name))),
      ]);

      setQcProgress(30);
      toast.info("正在进行AI质检分析...");

      const { data, error } = await supabase.functions.invoke("techcheck-quality", {
        body: {
          checkItems: checklist.items.map(item => ({
            category: item.category,
            title: item.title,
            description: item.description,
            severity: item.severity,
          })),
          bidTexts,
          proposalTexts: proposalTextsArr,
        },
      });

      setQcProgress(90);

      if (error) throw new Error(error.message || "质检请求失败");

      // Handle string response
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      if (parsed.error) throw new Error(parsed.error);

      const report: QCReport = {
        results: parsed.results || [],
        overallScore: parsed.overallScore || 0,
        summary: parsed.summary || "",
        checkItems: checklist.items,
        projectName: project?.project_name || "未知项目",
        timestamp: new Date().toISOString(),
      };

      setQcReport(report);
      setQcProgress(100);
      setShowQcResult(true);

      // Also update the checklist items with AI results
      const stored = localStorage.getItem(`${STORAGE_KEY}-${user?.id}`);
      if (stored) {
        try {
          const allLists: CheckList[] = JSON.parse(stored);
          const updated = allLists.map(cl => {
            if (cl.id !== checklist.id) return cl;
            return {
              ...cl,
              updatedAt: new Date().toISOString(),
              items: cl.items.map((item, idx) => {
                const r = report.results.find(r => r.itemIndex === idx);
                if (!r) return item;
                return {
                  ...item,
                  status: r.status as CheckItem["status"],
                  notes: `[AI质检 ${r.score}分] ${r.finding}${r.suggestion ? `\n💡 建议：${r.suggestion}` : ""}`,
                };
              }),
            };
          });
          localStorage.setItem(`${STORAGE_KEY}-${user?.id}`, JSON.stringify(updated));
        } catch { /* ignore */ }
      }

      toast.success(`质检完成！综合评分：${report.overallScore}分`);
    } catch (err: any) {
      console.error("QC error:", err);
      toast.error("质检失败：" + (err.message || "未知错误"));
    } finally {
      setQcRunning(null);
      setQcProgress(0);
    }
  };

  const fileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <FileType2 className="w-4 h-4 text-destructive" />;
    if (ext === "docx" || ext === "doc") return <FileText className="w-4 h-4 text-primary" />;
    return <File className="w-4 h-4 text-muted-foreground" />;
  };

  const statusIcon = (status: FileUploadStatus["status"]) => {
    switch (status) {
      case "pending": return <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />;
      case "uploading": return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
      case "success": return <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />;
      case "error": return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />;
    }
  };

  const qcStatusIcon = (status: string) => {
    switch (status) {
      case "pass": return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
      case "fail": return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />;
      default: return null;
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 90) return "text-green-500";
    if (score >= 70) return "text-primary";
    if (score >= 50) return "text-yellow-500";
    return "text-destructive";
  };

  if (loading) {
    return (
      <Card className="p-8">
        <div className="flex items-center justify-center text-muted-foreground text-sm">加载中...</div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error Log Dialog */}
      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              上传错误日志
            </DialogTitle>
            <DialogDescription>
              以下文件在上传过程中出现错误，请检查后重试
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-2">
              {errorLogs.map((log, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                >
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{log.name}</p>
                    <p className="text-xs text-destructive/80 mt-0.5">{log.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowErrorDialog(false)}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Checklist Picker Dialog */}
      <Dialog open={showChecklistPicker} onOpenChange={setShowChecklistPicker}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-primary" />
              选择检查清单
            </DialogTitle>
            <DialogDescription>选择一个检查清单，AI将根据清单中的检查项逐项检查技术方案</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-2">
              {getChecklists().map((cl) => {
                const total = cl.items.length;
                return (
                  <div
                    key={cl.id}
                    className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                    onClick={() => pickerProjectId && runQualityCheck(pickerProjectId, cl)}
                  >
                    <ClipboardCheck className="w-5 h-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{cl.name}</p>
                      {cl.projectName && <p className="text-[10px] text-muted-foreground">{cl.projectName}</p>}
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{total} 项</Badge>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* QC Result Dialog */}
      <Dialog open={showQcResult} onOpenChange={setShowQcResult}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-primary" />
              质检报告 - {qcReport?.projectName}
            </DialogTitle>
            <DialogDescription>
              {qcReport?.timestamp && new Date(qcReport.timestamp).toLocaleString("zh-CN")}
            </DialogDescription>
          </DialogHeader>

          {qcReport && (
            <div className="flex-1 overflow-auto space-y-4">
              {/* Score summary */}
              <div className="grid grid-cols-4 gap-3">
                <Card className="p-3 text-center col-span-1">
                  <p className="text-xs text-muted-foreground">综合评分</p>
                  <p className={`text-3xl font-bold ${scoreColor(qcReport.overallScore)}`}>
                    {qcReport.overallScore}
                  </p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">通过</p>
                  <p className="text-xl font-bold text-green-500">
                    {qcReport.results.filter(r => r.status === "pass").length}
                  </p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">需注意</p>
                  <p className="text-xl font-bold text-yellow-500">
                    {qcReport.results.filter(r => r.status === "warning").length}
                  </p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">不通过</p>
                  <p className="text-xl font-bold text-destructive">
                    {qcReport.results.filter(r => r.status === "fail").length}
                  </p>
                </Card>
              </div>

              {/* Summary */}
              <Card className="p-4">
                <p className="text-xs font-medium text-muted-foreground mb-1">AI 质检总结</p>
                <p className="text-sm text-foreground">{qcReport.summary}</p>
              </Card>

              {/* Per-item results */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">逐项检查结果</p>
                {qcReport.results.map((r, idx) => {
                  const item = qcReport.checkItems[r.itemIndex];
                  if (!item) return null;
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3 ${
                        r.status === "fail" ? "border-destructive/30 bg-destructive/5" :
                        r.status === "pass" ? "border-green-500/20 bg-green-500/5" :
                        "border-yellow-500/20 bg-yellow-500/5"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {qcStatusIcon(r.status)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">{item.title}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{item.category}</Badge>
                            <span className={`text-sm font-bold ml-auto ${scoreColor(r.score)}`}>{r.score}分</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{r.finding}</p>
                          {r.suggestion && (
                            <p className="text-xs text-primary mt-1">💡 {r.suggestion}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setShowQcResult(false)}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">质检项目</h3>
          <p className="text-xs text-muted-foreground">管理招标文件和技术方案，支持关联检查清单</p>
        </div>
        <Button onClick={createProject} size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" />
          新建项目
        </Button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={bidInputRef}
        type="file"
        accept={ACCEPTED_BID}
        multiple
        className="hidden"
        onChange={(e) => uploadProjectRef.current && handleUpload(e, uploadProjectRef.current, "bid_document")}
      />
      <input
        ref={proposalInputRef}
        type="file"
        accept={ACCEPTED_PROPOSAL}
        multiple
        className="hidden"
        onChange={(e) => uploadProjectRef.current && handleUpload(e, uploadProjectRef.current, "technical_proposal")}
      />

      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-4">暂无质检项目，创建后可上传招标文件和技术方案</p>
            <Button onClick={createProject} size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              创建第一个项目
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {projects.map((proj) => {
            const isExpanded = expandedProjectId === proj.id;
            const bidFiles = getProjectFiles(proj.id, "bid_document");
            const proposalFiles = getProjectFiles(proj.id, "technical_proposal");
            const totalFiles = bidFiles.length + proposalFiles.length;
            const isUploading = uploading === proj.id;
            const isQcRunning = qcRunning === proj.id;

            return (
              <Card key={proj.id} className="overflow-hidden">
                {/* Project header */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-secondary/30 transition-colors"
                  onClick={() => setExpandedProjectId(isExpanded ? null : proj.id)}
                >
                  <FolderOpen className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    {editingId === proj.id ? (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-7 text-sm"
                          autoFocus
                          onKeyDown={(e) => e.key === "Enter" && renameProject(proj.id)}
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => renameProject(proj.id)}>
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-foreground truncate">{proj.project_name}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {totalFiles} 个文件
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {/* 进行质检 button */}
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={isQcRunning || isUploading || bidFiles.length === 0 || proposalFiles.length === 0}
                      onClick={() => handleStartQC(proj.id)}
                    >
                      {isQcRunning ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      {isQcRunning ? "质检中..." : "进行质检"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => {
                        setEditingId(proj.id);
                        setEditName(proj.project_name);
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteProject(proj.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* QC Progress bar */}
                {isQcRunning && (
                  <div className="px-4 pb-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      AI正在逐项检查技术方案...
                    </div>
                    <Progress value={qcProgress} className="h-1.5" />
                  </div>
                )}

                {/* Expanded content */}
                {isExpanded && (
                  <CardContent className="pt-0 pb-4 space-y-4 border-t">
                    {/* Bid documents section */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          <FileType2 className="w-4 h-4 text-destructive" />
                          招标文件
                          <span className="text-[10px] text-muted-foreground font-normal">（PDF / Word）</span>
                        </h4>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => triggerBidUpload(proj.id)}
                          disabled={isUploading}
                        >
                          <FileUp className="w-3.5 h-3.5" />
                          上传
                        </Button>
                      </div>
                      {bidFiles.length === 0 && !isUploading ? (
                        <div
                          className="border border-dashed rounded-lg p-4 text-center text-xs text-muted-foreground cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          onClick={() => triggerBidUpload(proj.id)}
                        >
                          点击上传招标文件（支持 PDF、Word 格式）
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {bidFiles.map((f) => (
                            <div key={f.id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/40 text-sm">
                              {fileIcon(f.file_name)}
                              <span className="flex-1 truncate text-foreground">{f.file_name}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">{formatSize(f.file_size)}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteFile(f)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Technical proposal section */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-primary" />
                          技术方案
                          <span className="text-[10px] text-muted-foreground font-normal">（Word）</span>
                        </h4>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => triggerProposalUpload(proj.id)}
                          disabled={isUploading}
                        >
                          <FileUp className="w-3.5 h-3.5" />
                          上传
                        </Button>
                      </div>
                      {proposalFiles.length === 0 && !isUploading ? (
                        <div
                          className="border border-dashed rounded-lg p-4 text-center text-xs text-muted-foreground cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          onClick={() => triggerProposalUpload(proj.id)}
                        >
                          点击上传技术方案（仅支持 Word 格式）
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {proposalFiles.map((f) => (
                            <div key={f.id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary/40 text-sm">
                              {fileIcon(f.file_name)}
                              <span className="flex-1 truncate text-foreground">{f.file_name}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">{formatSize(f.file_size)}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteFile(f)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Per-file upload progress */}
                    {fileStatuses.length > 0 && (isUploading || fileStatuses.some(s => s.status !== "pending")) && (
                      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-foreground">上传进度</span>
                          <span className="text-[11px] text-muted-foreground">
                            {fileStatuses.filter(s => s.status === "success").length}/{fileStatuses.length} 完成
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          {fileStatuses.map((fs, idx) => (
                            <div key={idx} className="space-y-1">
                              <div className="flex items-center gap-2">
                                {statusIcon(fs.status)}
                                <span className="text-xs text-foreground flex-1 truncate">{fs.fileName}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">{formatSize(fs.fileSize)}</span>
                                <span className="text-[10px] font-medium text-muted-foreground shrink-0 w-8 text-right">
                                  {fs.progress}%
                                </span>
                              </div>
                              <Progress
                                value={fs.progress}
                                className={`h-1.5 ${fs.status === "error" ? "[&>div]:bg-destructive" : ""}`}
                              />
                              {fs.status === "error" && fs.error && (
                                <p className="text-[10px] text-destructive pl-6">{fs.error}</p>
                              )}
                            </div>
                          ))}
                        </div>
                        {fileStatuses.some(s => s.status === "error") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1 mt-2 text-destructive border-destructive/30 hover:bg-destructive/5"
                            onClick={() => setShowErrorDialog(true)}
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            查看错误详情
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TechCheckProjects;
