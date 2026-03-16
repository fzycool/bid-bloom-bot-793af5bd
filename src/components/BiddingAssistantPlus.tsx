import React, { useState, useCallback, useRef } from "react";
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

/**
 * Parse a blob into rich content (HTML for DOCX, page images for PDF).
 * Also extracts plain text for AI operations.
 */
/**
 * Detect actual file type from magic bytes, not extension.
 */
async function detectFileType(blob: Blob): Promise<"pdf" | "docx" | "txt" | "unknown"> {
  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  // PDF: %PDF
  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
    return "pdf";
  }
  // ZIP (DOCX is a ZIP): PK\x03\x04
  if (header[0] === 0x50 && header[1] === 0x4B && header[2] === 0x03 && header[3] === 0x04) {
    return "docx";
  }
  return "unknown";
}

async function parseDocumentBlob(
  blob: Blob,
  name: string,
  onProgress?: (msg: string) => void
): Promise<{ content: DocContent; plainText: string }> {
  const lower = name.toLowerCase();

  // Detect actual file type by magic bytes (handles .doc files that are actually PDFs)
  const detectedType = await detectFileType(blob);

  // ---- DOCX → HTML via mammoth ----
  const isDocx = detectedType === "docx" || (detectedType === "unknown" && lower.endsWith(".docx"));
  if (isDocx) {
    onProgress?.("正在转换 DOCX 文档...");
    const mammoth = await import("mammoth");
    const arrayBuffer = await blob.arrayBuffer();

    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const buf = await image.read("base64");
          const contentType = image.contentType || "image/png";
          return { src: `data:${contentType};base64,${buf}` };
        }),
      }
    );

    const textResult = await mammoth.extractRawText({ arrayBuffer });

    return {
      content: { type: "html", html: result.value, plainText: textResult.value },
      plainText: textResult.value,
    };
  }

  // ---- PDF → pass raw data for canvas + text layer rendering ----
  const isPdf = detectedType === "pdf" || (detectedType === "unknown" && lower.endsWith(".pdf"));
  if (isPdf) {
    onProgress?.("正在加载 PDF...");
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const renderBuffer = await blob.arrayBuffer();
    // IMPORTANT: pdf.js 可能会转移(transfer)传入的 ArrayBuffer，
    // 所以提取文本时使用副本，避免把用于右侧渲染的 buffer 变成 detached。
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
    return {
      content: { type: "pdf" as const, data: renderBuffer, plainText },
      plainText,
    };
  }

  // ---- TXT fallback ----
  if (lower.endsWith(".txt")) {
    const text = await blob.text();
    return {
      content: { type: "html", html: `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(text)}</pre>`, plainText: text },
      plainText: text,
    };
  }

  return {
    content: { type: "html", html: "<p>不支持的文件格式</p>", plainText: "" },
    plainText: "",
  };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface BidAnalysisItem {
  id: string;
  project_name: string | null;
  file_path: string | null;
  created_at: string;
  ai_status: string;
  document_structure?: any;
}
let _fwId = 1;
const genId = () => `fw_${Date.now()}_${_fwId++}`;

function countNodes(tree: any[]): number {
  let count = 0;
  for (const node of tree) {
    count += 1;
    if (node.children) count += countNodes(node.children);
  }
  return count;
}

export default function BiddingAssistantPlus() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [autoParseLoading, setAutoParseLoading] = useState(false);

  const [docContent, setDocContent] = useState<DocContent>({ type: "empty" });
  const [plainText, setPlainText] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [commitmentLoading, setCommitmentLoading] = useState(false);

  // Load from bid analyses
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [frameworkDialogOpen, setFrameworkDialogOpen] = useState(false);
  const [bidAnalyses, setBidAnalyses] = useState<BidAnalysisItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);

  const [addDialog, setAddDialog] = useState<{ open: boolean; defaultTitle: string }>({
    open: false, defaultTitle: "",
  });

  const outline = useOutlineTree();

  // Fetch bid analyses list
  const fetchBidAnalyses = useCallback(async () => {
    if (!user) return;
    setLoadingList(true);
    try {
      const { data, error } = await supabase
        .from("bid_analyses")
        .select("id, project_name, file_path, created_at, ai_status, document_structure")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setBidAnalyses(data || []);
    } catch (err: any) {
      toast({ title: "获取招标文件列表失败", description: err.message, variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  }, [user, toast]);

  // Common parsing logic
  const loadBlob = useCallback(async (blob: Blob, name: string, displayName: string) => {
    setDocContent({ type: "loading", progress: "正在解析文件..." });
    setFileName(displayName);
    try {
      const result = await parseDocumentBlob(blob, name, (msg) => {
        setDocContent({ type: "loading", progress: msg });
      });
      setDocContent(result.content);
      setPlainText(result.plainText);
    } catch (err: any) {
      setDocContent({ type: "empty" });
      throw err;
    }
  }, []);

  // Load a specific bid file from storage
  const handleLoadBidFile = useCallback(async (item: BidAnalysisItem) => {
    if (!item.file_path) {
      toast({ title: "该分析记录没有关联文件", variant: "destructive" });
      return;
    }

    setLoadingFileId(item.id);
    try {
      const { data, error } = await supabase.storage
        .from("knowledge-base")
        .download(item.file_path);
      if (error) throw error;

      const ext = item.file_path.split(".").pop()?.toLowerCase() || "";
      const displayName = item.project_name || item.file_path.split("/").pop() || "document";

      await loadBlob(data, `file.${ext}`, displayName);
      setLoadDialogOpen(false);
      toast({ title: "招标文件已加载", description: displayName });
    } catch (err: any) {
      toast({ title: "加载文件失败", description: err.message, variant: "destructive" });
    } finally {
      setLoadingFileId(null);
    }
  }, [toast, loadBlob]);

  // Load document structure as outline framework
  const handleLoadFramework = useCallback((item: BidAnalysisItem) => {
    if (!item.document_structure) {
      toast({ title: "该项目尚无文档结构", variant: "destructive" });
      return;
    }

    try {
      const structure = typeof item.document_structure === "string"
        ? JSON.parse(item.document_structure)
        : item.document_structure;

      // Convert document_structure chapters to OutlineNode[]
      const convertToNodes = (chapters: any[], parentId: string | null = null): any[] => {
        if (!Array.isArray(chapters)) return [];
        return chapters.map((ch: any, i: number) => {
          const id = genId();
          const title = ch.title || ch.name || ch.chapter_title || `章节 ${i + 1}`;
          const sectionNumber = ch.section_number || ch.number || null;
          const children = ch.children || ch.sub_chapters || ch.sections || [];
          return {
            id,
            title: sectionNumber ? `${sectionNumber} ${title}` : title,
            section_number: sectionNumber,
            sort_order: i,
            parent_id: parentId,
            children: convertToNodes(children, id),
            source_text: ch.source_text || title,
          };
        });
      };

      // Handle different possible structure formats
      const chapters = Array.isArray(structure)
        ? structure
        : structure.chapters || structure.sections || structure.toc || [];

      const tree = convertToNodes(chapters);
      if (tree.length === 0) {
        toast({ title: "文档结构为空", variant: "destructive" });
        return;
      }

      outline.replaceTree(tree);
      setFrameworkDialogOpen(false);
      toast({ title: "文件框架已载入", description: `共 ${countNodes(tree)} 个节点` });
    } catch (err: any) {
      toast({ title: "载入框架失败", description: err.message, variant: "destructive" });
    }
  }, [outline, toast]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      await loadBlob(file, file.name, file.name);
      toast({ title: "文件已加载", description: file.name });
    } catch (err: any) {
      toast({ title: "文件解析失败", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
    if (parentId) outline.setSelectedId(parentId);
    else outline.setSelectedId(null);
    setAddDialog({ open: true, defaultTitle: "" });
  }, [outline]);

  const handleAddSibling = useCallback((id: string) => {
    outline.setSelectedId(id);
    outline.addNode("新节点", "sibling");
  }, [outline]);

  const handleGenerateCommitment = async () => {
    if (!plainText) {
      toast({ title: "请先上传招标文件", variant: "destructive" });
      return;
    }

    setCommitmentLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/outline-ai-command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          command: "__GENERATE_COMMITMENT__",
          currentTree: outline.tree,
          documentText: plainText.slice(0, 10000),
        }),
      });

      if (!response.ok) throw new Error("生成失败");
      const data = await response.json();
      if (data.commitmentNodes) {
        for (const node of data.commitmentNodes) {
          outline.addNode(node.title, "child");
          if (node.children) {
            for (const child of node.children) {
              outline.addNode(child.title, "child");
            }
          }
        }
        toast({ title: "承诺大纲已生成" });
      }
    } catch (err: any) {
      toast({ title: "生成承诺大纲失败", description: err.message, variant: "destructive" });
    } finally {
      setCommitmentLoading(false);
    }
  };

  // Auto-parse: AI extracts outline from document
  const handleAutoParse = useCallback(async (customPrompt?: string) => {
    if (!plainText) {
      toast({ title: "请先上传招标文件", variant: "destructive" });
      return;
    }
    setAutoParseLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/parse-outline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          documentText: plainText.slice(0, 30000),
          customPrompt,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "解析失败");
      }

      const data = await response.json();
      if (data.tree && Array.isArray(data.tree)) {
        outline.replaceTree(data.tree);
        toast({ title: "大纲解析完成", description: `共提取 ${countNodes(data.tree)} 个节点` });
      } else {
        throw new Error("返回格式异常");
      }
    } catch (err: any) {
      toast({ title: "自动解析失败", description: err.message, variant: "destructive" });
    } finally {
      setAutoParseLoading(false);
    }
  }, [plainText, outline, toast]);

  const handleImportOutline = useCallback(() => {
    toast({ title: "大纲导入", description: "功能开发中，敬请期待" });
  }, [toast]);

  const hasDocument = docContent.type !== "empty" && docContent.type !== "loading";

  // Compute highlight text from selected node
  const selectedNode = outline.selectedId
    ? outline.flatItems.find((f) => f.id === outline.selectedId)
    : null;
  const highlightText = selectedNode?.source_text || selectedNode?.title || null;

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-bold text-foreground">投标助手 Plus</h2>
          <span className="text-xs text-muted-foreground">人机协作大纲生成</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchBidAnalyses();
              setLoadDialogOpen(true);
            }}
          >
            <FolderOpen className="w-4 h-4 mr-1" />
            载入招标文件
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchBidAnalyses();
              setFrameworkDialogOpen(true);
            }}
          >
            <ListTree className="w-4 h-4 mr-1" />
            载入文件框架
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
            本地上传
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateCommitment}
            disabled={commitmentLoading || !hasDocument}
          >
            {commitmentLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />}
            生成承诺大纲
          </Button>
        </div>
      </div>

      {/* Split Panel */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Left: Outline Tree */}
        <Card className="w-[400px] shrink-0 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border shrink-0">
            <AICommandInput
              tree={outline.tree}
              onApplyChanges={outline.replaceTree}
              documentText={plainText}
              disabled={!hasDocument}
            />
          </div>
          <div className="flex-1 overflow-auto p-2">
            <OutlineTree
              flatItems={outline.flatItems}
              selectedId={outline.selectedId}
              expandedIds={outline.expandedIds}
              onSelect={outline.setSelectedId}
              onToggle={outline.toggleExpand}
              onRename={outline.renameNode}
              onDelete={outline.deleteNode}
              onMove={outline.moveNode}
              onAddChild={handleAddChild}
              onAddSibling={handleAddSibling}
              onPromote={outline.promoteNode}
              onDemote={outline.demoteNode}
              onAutoNumber={outline.doAutoNumber}
              onAutoParse={handleAutoParse}
              onImportOutline={handleImportOutline}
              autoParseLoading={autoParseLoading}
              hasDocument={hasDocument}
            />
          </div>
        </Card>

        {/* Right: Document Viewer */}
        <Card className="flex-1 overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {fileName || "招标文件原文"}
              </span>
              {hasDocument && (
                <span className="text-xs text-muted-foreground ml-auto">
                  选择文字后点击"+"添加为目录项
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0">
              <DocumentViewer
                content={docContent}
                onAddFromSelection={handleAddFromSelection}
                highlightText={highlightText}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Add Node Dialog */}
      <AddNodeDialog
        open={addDialog.open}
        onClose={() => setAddDialog({ open: false, defaultTitle: "" })}
        onConfirm={handleAddConfirm}
        defaultTitle={addDialog.defaultTitle}
        hasSelected={!!outline.selectedId}
      />

      {/* Load Bid File Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>载入招标文件</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">从「招标解析」中选择已上传的招标文件</p>
          <div className="flex-1 overflow-auto min-h-0 space-y-1 mt-2">
            {loadingList ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : bidAnalyses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                暂无招标解析记录，请先在「招标解析」模块上传文件
              </div>
            ) : (
              bidAnalyses.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleLoadBidFile(item)}
                  disabled={!item.file_path || loadingFileId === item.id}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                    "hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed",
                    loadingFileId === item.id && "bg-accent/10"
                  )}
                >
                  {loadingFileId === item.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {item.project_name || "未命名项目"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString("zh-CN")}
                      {!item.file_path && " · 无文件"}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Load Framework Dialog */}
      <Dialog open={frameworkDialogOpen} onOpenChange={setFrameworkDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>载入投标文件框架</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">从已解析的招标项目中导入文档结构作为大纲框架</p>
          <div className="flex-1 overflow-auto min-h-0 space-y-1 mt-2">
            {loadingList ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : bidAnalyses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                暂无招标解析记录，请先在「招标解析」模块上传并解析文件
              </div>
            ) : (
              bidAnalyses.map((item) => {
                const hasStructure = !!item.document_structure;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleLoadFramework(item)}
                    disabled={!hasStructure}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                      "hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed",
                    )}
                  >
                    <ListTree className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {item.project_name || "未命名项目"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.created_at).toLocaleDateString("zh-CN")}
                        {!hasStructure && " · 无文档结构"}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
