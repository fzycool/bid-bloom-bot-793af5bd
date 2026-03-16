import React, { useState, useCallback, useRef, useEffect } from "react";
import { Upload, FileText, Plus, Wand2, Loader2, ScrollText, FolderOpen, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import OutlineTree from "@/components/bidding-plus/OutlineTree";
import DocumentViewer, { type DocContent } from "@/components/bidding-plus/DocumentViewer";
import AICommandInput from "@/components/bidding-plus/AICommandInput";
import AddNodeDialog from "@/components/bidding-plus/AddNodeDialog";
import { useOutlineTree } from "@/components/bidding-plus/useOutlineTree";
import type { InsertPosition } from "@/components/bidding-plus/types";
import TaskList from "@/components/bidding-plus/TaskList";
import StepNavigation from "@/components/bidding-plus/StepNavigation";
import Step2Editor from "@/components/bidding-plus/Step2Editor";

// ---- Document parsing helpers (unchanged) ----

async function detectFileType(blob: Blob): Promise<"pdf" | "docx" | "txt" | "unknown"> {
  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) return "pdf";
  if (header[0] === 0x50 && header[1] === 0x4B && header[2] === 0x03 && header[3] === 0x04) return "docx";
  return "unknown";
}

async function parseDocumentBlob(
  blob: Blob, name: string, onProgress?: (msg: string) => void
): Promise<{ content: DocContent; plainText: string }> {
  const lower = name.toLowerCase();
  const detectedType = await detectFileType(blob);

  const isDocx = detectedType === "docx" || (detectedType === "unknown" && lower.endsWith(".docx"));
  if (isDocx) {
    onProgress?.("正在转换 DOCX 文档...");
    const mammoth = await import("mammoth");
    const arrayBuffer = await blob.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer }, {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buf = await image.read("base64");
        return { src: `data:${image.contentType || "image/png"};base64,${buf}` };
      }),
    });
    const textResult = await mammoth.extractRawText({ arrayBuffer });
    return { content: { type: "html", html: result.value, plainText: textResult.value }, plainText: textResult.value };
  }

  const isPdf = detectedType === "pdf" || (detectedType === "unknown" && lower.endsWith(".pdf"));
  if (isPdf) {
    onProgress?.("正在加载 PDF...");
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const renderBuffer = await blob.arrayBuffer();
    const extractionBuffer = renderBuffer.slice(0);
    const pdf = await pdfjsLib.getDocument({ data: extractionBuffer }).promise;
    const textParts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`正在提取文本 ${i}/${pdf.numPages}...`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      textParts.push(textContent.items.map((item: any) => item.str).join(""));
    }
    const plainText = textParts.join("\n\n");
    return { content: { type: "pdf" as const, data: renderBuffer, plainText }, plainText };
  }

  if (lower.endsWith(".txt")) {
    const text = await blob.text();
    return {
      content: { type: "html", html: `<pre style="white-space:pre-wrap;font-family:inherit;">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`, plainText: text },
      plainText: text,
    };
  }

  return { content: { type: "html", html: "<p>不支持的文件格式</p>", plainText: "" }, plainText: "" };
}

function countNodes(tree: any[]): number {
  let count = 0;
  for (const node of tree) { count += 1; if (node.children) count += countNodes(node.children); }
  return count;
}

// ---- Types ----
interface BidAnalysisItem {
  id: string; project_name: string | null; file_path: string | null;
  created_at: string; ai_status: string; document_structure?: any;
}

// ---- Main Component ----
export default function BiddingAssistantPlus() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Task management
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskName, setTaskName] = useState("");
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1 state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const frameworkInputRef = useRef<HTMLInputElement>(null);
  const [autoParseLoading, setAutoParseLoading] = useState(false);
  const [frameworkLoading, setFrameworkLoading] = useState(false);
  const [docContent, setDocContent] = useState<DocContent>({ type: "empty" });
  const [plainText, setPlainText] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [commitmentLoading, setCommitmentLoading] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [bidAnalyses, setBidAnalyses] = useState<BidAnalysisItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [addDialog, setAddDialog] = useState<{ open: boolean; defaultTitle: string }>({ open: false, defaultTitle: "" });

  const outline = useOutlineTree();

  // Load task data when task selected
  useEffect(() => {
    if (!activeTaskId) return;
    (async () => {
      const { data, error } = await supabase
        .from("bidding_plus_tasks")
        .select("task_name, current_step, outline_data")
        .eq("id", activeTaskId)
        .single();
      if (error || !data) return;
      setTaskName((data as any).task_name);
      setCurrentStep((data as any).current_step || 1);
      if ((data as any).outline_data && Array.isArray((data as any).outline_data)) {
        outline.replaceTree((data as any).outline_data);
      }
    })();
  }, [activeTaskId]);

  // Save outline to DB when it changes
  const saveOutlineDebounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!activeTaskId || outline.tree.length === 0) return;
    if (saveOutlineDebounceRef.current) clearTimeout(saveOutlineDebounceRef.current);
    saveOutlineDebounceRef.current = setTimeout(async () => {
      await supabase
        .from("bidding_plus_tasks")
        .update({ outline_data: outline.tree as any })
        .eq("id", activeTaskId);
    }, 2000);
  }, [activeTaskId, outline.tree]);

  const handleStepChange = async (step: number) => {
    setCurrentStep(step);
    if (activeTaskId) {
      await supabase.from("bidding_plus_tasks").update({ current_step: step }).eq("id", activeTaskId);
    }
  };

  const handleBack = () => {
    setActiveTaskId(null);
    setDocContent({ type: "empty" });
    setPlainText("");
    setFileName("");
    outline.replaceTree([]);
  };

  // ---- All Step 1 handlers (same as before) ----
  const fetchBidAnalyses = useCallback(async () => {
    if (!user) return;
    setLoadingList(true);
    try {
      const { data, error } = await supabase.from("bid_analyses")
        .select("id, project_name, file_path, created_at, ai_status, document_structure")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setBidAnalyses(data || []);
    } catch (err: any) {
      toast({ title: "获取招标文件列表失败", description: err.message, variant: "destructive" });
    } finally { setLoadingList(false); }
  }, [user, toast]);

  const loadBlob = useCallback(async (blob: Blob, name: string, displayName: string) => {
    setDocContent({ type: "loading", progress: "正在解析文件..." });
    setFileName(displayName);
    try {
      const result = await parseDocumentBlob(blob, name, (msg) => setDocContent({ type: "loading", progress: msg }));
      setDocContent(result.content);
      setPlainText(result.plainText);
    } catch (err: any) { setDocContent({ type: "empty" }); throw err; }
  }, []);

  const handleLoadBidFile = useCallback(async (item: BidAnalysisItem) => {
    if (!item.file_path) { toast({ title: "该分析记录没有关联文件", variant: "destructive" }); return; }
    setLoadingFileId(item.id);
    try {
      const { data, error } = await supabase.storage.from("knowledge-base").download(item.file_path);
      if (error) throw error;
      const ext = item.file_path.split(".").pop()?.toLowerCase() || "";
      const displayName = item.project_name || item.file_path.split("/").pop() || "document";
      await loadBlob(data, `file.${ext}`, displayName);
      setLoadDialogOpen(false);
      toast({ title: "招标文件已加载", description: displayName });
    } catch (err: any) {
      toast({ title: "加载文件失败", description: err.message, variant: "destructive" });
    } finally { setLoadingFileId(null); }
  }, [toast, loadBlob]);

  const handleFrameworkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFrameworkLoading(true);
    try {
      const result = await parseDocumentBlob(file, file.name);
      if (!result.plainText || result.plainText.trim().length < 10) {
        toast({ title: "文件内容过少，无法提取框架", variant: "destructive" }); return;
      }
      setDocContent(result.content); setPlainText(result.plainText); setFileName(file.name);
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/parse-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ documentText: result.plainText.slice(0, 200000) }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "解析失败");
      const data = await response.json();
      if (data.tree && Array.isArray(data.tree)) {
        outline.replaceTree(data.tree);
        toast({ title: "文件框架已载入", description: `${file.name} · 共 ${countNodes(data.tree)} 个节点` });
      } else throw new Error("返回格式异常");
    } catch (err: any) {
      toast({ title: "载入框架失败", description: err.message, variant: "destructive" });
    } finally {
      setFrameworkLoading(false);
      if (frameworkInputRef.current) frameworkInputRef.current.value = "";
    }
  };

  const handleAddFromSelection = useCallback((selectedText: string) => {
    const title = selectedText.length > 60 ? selectedText.slice(0, 57) + "..." : selectedText;
    setAddDialog({ open: true, defaultTitle: title });
  }, []);

  const handleAddConfirm = useCallback((title: string, position: InsertPosition) => {
    outline.addNode(title, position, addDialog.defaultTitle);
    setAddDialog({ open: false, defaultTitle: "" });
    toast({ title: "已添加节点", description: title });
  }, [outline, addDialog, toast]);

  const handleAddChild = useCallback((parentId: string | null) => {
    if (parentId) outline.setSelectedId(parentId); else outline.setSelectedId(null);
    setAddDialog({ open: true, defaultTitle: "" });
  }, [outline]);

  const handleAddSibling = useCallback((id: string) => {
    outline.setSelectedId(id);
    outline.addNode("新节点", "sibling");
  }, [outline]);

  const handleGenerateCommitment = async () => {
    if (!plainText) { toast({ title: "请先上传招标文件", variant: "destructive" }); return; }
    setCommitmentLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/outline-ai-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ command: "__GENERATE_COMMITMENT__", currentTree: outline.tree, documentText: plainText.slice(0, 10000) }),
      });
      if (!response.ok) throw new Error("生成失败");
      const data = await response.json();
      if (data.commitmentNodes) {
        for (const node of data.commitmentNodes) {
          outline.addNode(node.title, "child");
          if (node.children) { for (const child of node.children) outline.addNode(child.title, "child"); }
        }
        toast({ title: "承诺大纲已生成" });
      }
    } catch (err: any) {
      toast({ title: "生成承诺大纲失败", description: err.message, variant: "destructive" });
    } finally { setCommitmentLoading(false); }
  };

  const handleAutoParse = useCallback(async (customPrompt?: string) => {
    if (!plainText) { toast({ title: "请先上传招标文件", variant: "destructive" }); return; }
    setAutoParseLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/parse-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ documentText: plainText.slice(0, 200000), customPrompt }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "解析失败");
      const data = await response.json();
      if (data.tree && Array.isArray(data.tree)) {
        outline.replaceTree(data.tree);
        toast({ title: "大纲解析完成", description: `共提取 ${countNodes(data.tree)} 个节点` });
      } else throw new Error("返回格式异常");
    } catch (err: any) {
      toast({ title: "自动解析失败", description: err.message, variant: "destructive" });
    } finally { setAutoParseLoading(false); }
  }, [plainText, outline, toast]);

  const handleImportOutline = useCallback(() => {
    toast({ title: "大纲导入", description: "功能开发中，敬请期待" });
  }, [toast]);

  const hasDocument = docContent.type !== "empty" && docContent.type !== "loading";
  const selectedNode = outline.selectedId ? outline.flatItems.find((f) => f.id === outline.selectedId) : null;
  const highlightText = selectedNode?.source_text || selectedNode?.title || null;

  // ---- If no task selected, show task list ----
  if (!activeTaskId) {
    return <TaskList onSelectTask={setActiveTaskId} />;
  }

  // ---- Task selected: show step navigation + content ----
  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-3">
      <StepNavigation
        currentStep={currentStep}
        taskName={taskName}
        onStepChange={handleStepChange}
        onBack={handleBack}
      />

      {currentStep === 1 ? (
        <>
          {/* Step 1 header */}
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <ScrollText className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-muted-foreground">步骤1：大纲生成</span>
            </div>
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setLoading(true);
                  loadBlob(file, file.name, file.name)
                    .then(() => toast({ title: "文件已加载", description: file.name }))
                    .catch((err: any) => toast({ title: "文件解析失败", description: err.message, variant: "destructive" }))
                    .finally(() => { setLoading(false); if (fileInputRef.current) fileInputRef.current.value = ""; });
                }} />
              <Button variant="outline" size="sm" onClick={() => { fetchBidAnalyses(); setLoadDialogOpen(true); }}>
                <FolderOpen className="w-4 h-4 mr-1" /> 载入招标文件
              </Button>
              <input ref={frameworkInputRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={handleFrameworkUpload} />
              <Button variant="outline" size="sm" onClick={() => frameworkInputRef.current?.click()} disabled={frameworkLoading}>
                {frameworkLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ListTree className="w-4 h-4 mr-1" />}
                载入文件框架
              </Button>
              <Button variant="outline" size="sm" onClick={handleGenerateCommitment} disabled={commitmentLoading || !hasDocument}>
                {commitmentLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />}
                生成承诺大纲
              </Button>
              <Button size="sm" onClick={() => handleStepChange(2)} disabled={outline.tree.length === 0}>
                下一步：在线编写 →
              </Button>
            </div>
          </div>

          {/* Step 1 split panel */}
          <div className="flex-1 flex gap-3 min-h-0">
            <Card className="w-[400px] shrink-0 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-border shrink-0">
                <AICommandInput tree={outline.tree} onApplyChanges={outline.replaceTree} documentText={plainText} disabled={!hasDocument} />
              </div>
              <div className="flex-1 overflow-auto p-2">
                <OutlineTree
                  flatItems={outline.flatItems} selectedId={outline.selectedId}
                  expandedIds={outline.expandedIds} onSelect={outline.setSelectedId}
                  onToggle={outline.toggleExpand} onRename={outline.renameNode}
                  onDelete={outline.deleteNode} onMove={outline.moveNode}
                  onAddChild={handleAddChild} onAddSibling={handleAddSibling}
                  onPromote={outline.promoteNode} onDemote={outline.demoteNode}
                  onAutoNumber={outline.doAutoNumber} onAutoParse={handleAutoParse}
                  onImportOutline={handleImportOutline}
                  autoParseLoading={autoParseLoading} hasDocument={hasDocument}
                />
              </div>
            </Card>
            <Card className="flex-1 overflow-hidden">
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{fileName || "招标文件原文"}</span>
                  {hasDocument && <span className="text-xs text-muted-foreground ml-auto">选择文字后点击"+"添加为目录项</span>}
                </div>
                <div className="flex-1 min-h-0">
                  <DocumentViewer content={docContent} onAddFromSelection={handleAddFromSelection} highlightText={highlightText} />
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : (
        /* Step 2: Online Editor */
        <div className="flex-1 min-h-0">
          <Step2Editor taskId={activeTaskId} outlineTree={outline.tree} flatItems={outline.flatItems} />
        </div>
      )}

      {/* Add Node Dialog */}
      <AddNodeDialog open={addDialog.open} onClose={() => setAddDialog({ open: false, defaultTitle: "" })}
        onConfirm={handleAddConfirm} defaultTitle={addDialog.defaultTitle} hasSelected={!!outline.selectedId} />

      {/* Load Bid File Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[70vh] flex flex-col">
          <DialogHeader><DialogTitle>载入招标文件</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">从「招标解析」中选择已上传的招标文件</p>
          <div className="flex-1 overflow-auto min-h-0 space-y-1 mt-2">
            {loadingList ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : bidAnalyses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">暂无招标解析记录</div>
            ) : bidAnalyses.map((item) => (
              <button key={item.id} onClick={() => handleLoadBidFile(item)}
                disabled={!item.file_path || loadingFileId === item.id}
                className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-muted/50 disabled:opacity-50", loadingFileId === item.id && "bg-accent/10")}>
                {loadingFileId === item.id ? <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0" /> : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.project_name || "未命名项目"}</p>
                  <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleDateString("zh-CN")}{!item.file_path && " · 无文件"}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
