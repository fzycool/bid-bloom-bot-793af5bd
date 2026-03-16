import React, { useState, useCallback, useRef } from "react";
import { Upload, FileText, Plus, Wand2, Loader2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import OutlineTree from "@/components/bidding-plus/OutlineTree";
import DocumentViewer from "@/components/bidding-plus/DocumentViewer";
import AICommandInput from "@/components/bidding-plus/AICommandInput";
import AddNodeDialog from "@/components/bidding-plus/AddNodeDialog";
import { useOutlineTree } from "@/components/bidding-plus/useOutlineTree";
import type { InsertPosition } from "@/components/bidding-plus/types";

// PDF text extraction (reuse existing)
async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === "text/plain") {
    return await file.text();
  }

  // For DOCX: use JSZip to extract text from document.xml
  if (file.name.endsWith(".docx") || file.type.includes("wordprocessingml")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(file);
    const docXml = await zip.file("word/document.xml")?.async("string");
    if (!docXml) return "无法解析 DOCX 文件内容";
    // Simple XML text extraction
    const text = docXml
      .replace(/<w:t[^>]*>/g, "")
      .replace(/<\/w:t>/g, "")
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text;
  }

  // For PDF
  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: any) => item.str).join(""));
    }
    return pages.join("\n\n");
  }

  return "不支持的文件格式，请上传 PDF、DOCX 或 TXT 文件";
}

export default function BiddingAssistantPlus() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documentText, setDocumentText] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [commitmentLoading, setCommitmentLoading] = useState(false);

  // Dialog state for adding nodes from text selection
  const [addDialog, setAddDialog] = useState<{ open: boolean; defaultTitle: string }>({
    open: false, defaultTitle: "",
  });

  const outline = useOutlineTree();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const text = await extractTextFromFile(file);
      setDocumentText(text);
      setFileName(file.name);
      toast({ title: "文件已加载", description: file.name });
    } catch (err: any) {
      toast({ title: "文件解析失败", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddFromSelection = useCallback((selectedText: string) => {
    // Truncate long selections to a reasonable title
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

  // Generate commitment outline
  const handleGenerateCommitment = async () => {
    if (!documentText) {
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
          documentText: documentText.slice(0, 10000),
        }),
      });

      if (!response.ok) throw new Error("生成失败");
      const data = await response.json();
      if (data.commitmentNodes) {
        // Insert commitment nodes at selected position or root
        for (const node of data.commitmentNodes) {
          outline.addNode(node.title, "child");
          // Add sub-nodes
          if (node.children) {
            for (const child of node.children) {
              outline.addNode(child.title, "child");
            }
            // Go back up to parent level (select the commitment root to add next sibling)
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
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
            {fileName || "上传招标文件"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateCommitment}
            disabled={commitmentLoading || !documentText}
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
              documentText={documentText}
              disabled={!documentText}
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
              {documentText && (
                <span className="text-xs text-muted-foreground ml-auto">
                  选择文字后点击"+"添加为目录项
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0">
              <DocumentViewer
                text={documentText}
                onAddFromSelection={handleAddFromSelection}
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
    </div>
  );
}
