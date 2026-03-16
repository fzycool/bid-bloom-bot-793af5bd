import React, { useState, useEffect, useCallback, useRef } from "react";
import { Save, Plus, X, Loader2, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import RichTextEditor from "./RichTextEditor";
import MaterialBrowser from "./MaterialBrowser";
import type { OutlineNode, FlatOutlineItem } from "./types";

interface Sheet {
  id: string;
  title: string;
  content: string;
  sort_order: number;
  source_material_id: string | null;
}

interface Step2EditorProps {
  taskId: string;
  outlineTree: OutlineNode[];
  flatItems: FlatOutlineItem[];
}

export default function Step2Editor({ taskId, outlineTree, flatItems }: Step2EditorProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState("");
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingContentRef = useRef<Map<string, string>>(new Map());

  // Fetch sheets
  const fetchSheets = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("bidding_plus_sheets")
        .select("id, title, content, sort_order, source_material_id")
        .eq("task_id", taskId)
        .order("sort_order");
      if (error) throw error;
      const sheetsData = (data as Sheet[]) || [];
      setSheets(sheetsData);
      if (sheetsData.length > 0 && !activeSheetId) {
        setActiveSheetId(sheetsData[0].id);
      }
    } catch (err: any) {
      toast({ title: "加载文档失败", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, taskId, toast]);

  useEffect(() => { fetchSheets(); }, [fetchSheets]);

  // Auto-save with debounce
  const debouncedSave = useCallback((sheetId: string, content: string) => {
    pendingContentRef.current.set(sheetId, content);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const entries = Array.from(pendingContentRef.current.entries());
      pendingContentRef.current.clear();
      for (const [id, html] of entries) {
        await supabase
          .from("bidding_plus_sheets")
          .update({ content: html })
          .eq("id", id);
      }
    }, 2000);
  }, []);

  const handleContentChange = useCallback((html: string) => {
    if (!activeSheetId) return;
    setSheets((prev) =>
      prev.map((s) => (s.id === activeSheetId ? { ...s, content: html } : s))
    );
    debouncedSave(activeSheetId, html);
  }, [activeSheetId, debouncedSave]);

  const handleManualSave = async () => {
    if (!activeSheetId) return;
    setSaving(true);
    try {
      const sheet = sheets.find((s) => s.id === activeSheetId);
      if (!sheet) return;
      const { error } = await supabase
        .from("bidding_plus_sheets")
        .update({ content: sheet.content })
        .eq("id", activeSheetId);
      if (error) throw error;
      toast({ title: "已保存" });
    } catch (err: any) {
      toast({ title: "保存失败", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddSheet = async () => {
    if (!user) return;
    try {
      const maxOrder = sheets.reduce((max, s) => Math.max(max, s.sort_order), -1);
      const { data, error } = await supabase
        .from("bidding_plus_sheets")
        .insert({
          task_id: taskId,
          user_id: user.id,
          title: `文档 ${sheets.length + 1}`,
          sort_order: maxOrder + 1,
        })
        .select("id, title, content, sort_order, source_material_id")
        .single();
      if (error) throw error;
      const newSheet = data as Sheet;
      setSheets((prev) => [...prev, newSheet]);
      setActiveSheetId(newSheet.id);
    } catch (err: any) {
      toast({ title: "添加失败", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteSheet = async (e: React.MouseEvent, sheetId: string) => {
    e.stopPropagation();
    if (sheets.length <= 1) {
      toast({ title: "至少保留一个文档标签", variant: "destructive" });
      return;
    }
    try {
      const { error } = await supabase.from("bidding_plus_sheets").delete().eq("id", sheetId);
      if (error) throw error;
      setSheets((prev) => {
        const next = prev.filter((s) => s.id !== sheetId);
        if (activeSheetId === sheetId && next.length > 0) {
          setActiveSheetId(next[0].id);
        }
        return next;
      });
    } catch (err: any) {
      toast({ title: "删除失败", description: err.message, variant: "destructive" });
    }
  };

  const handleRenameTab = async (sheetId: string) => {
    if (!editingTabName.trim()) {
      setEditingTabId(null);
      return;
    }
    try {
      await supabase
        .from("bidding_plus_sheets")
        .update({ title: editingTabName.trim() })
        .eq("id", sheetId);
      setSheets((prev) =>
        prev.map((s) => (s.id === sheetId ? { ...s, title: editingTabName.trim() } : s))
      );
    } catch {}
    setEditingTabId(null);
  };

  const handleLoadMaterial = async (material: { id: string; file_name: string }, content: string) => {
    if (!user) return;
    try {
      const maxOrder = sheets.reduce((max, s) => Math.max(max, s.sort_order), -1);
      const title = material.file_name.length > 20
        ? material.file_name.slice(0, 17) + "..."
        : material.file_name;
      const { data, error } = await supabase
        .from("bidding_plus_sheets")
        .insert({
          task_id: taskId,
          user_id: user.id,
          title,
          content,
          sort_order: maxOrder + 1,
          source_material_id: material.id,
        })
        .select("id, title, content, sort_order, source_material_id")
        .single();
      if (error) throw error;
      const newSheet = data as Sheet;
      setSheets((prev) => [...prev, newSheet]);
      setActiveSheetId(newSheet.id);
    } catch (err: any) {
      toast({ title: "加载材料失败", description: err.message, variant: "destructive" });
    }
  };

  const activeSheet = sheets.find((s) => s.id === activeSheetId);

  // Export to DOCX
  const handleExportDocx = async () => {
    if (!activeSheet) return;
    try {
      const { Document, Packer, Paragraph, TextRun } = await import("docx");
      // Simple HTML to DOCX: strip tags and split by paragraphs
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = activeSheet.content || "";
      const paragraphs = Array.from(tempDiv.querySelectorAll("p, h1, h2, h3, h4, li"));
      const docParagraphs = paragraphs.length > 0
        ? paragraphs.map((el) => new Paragraph({ children: [new TextRun(el.textContent || "")] }))
        : [new Paragraph({ children: [new TextRun(tempDiv.textContent || "")] })];

      const doc = new Document({
        sections: [{ children: docParagraphs }],
      });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeSheet.title}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "导出成功" });
    } catch (err: any) {
      toast({ title: "导出失败", description: err.message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* Left: Outline sidebar */}
      <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
        <Card className="h-full overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-border shrink-0">
            <span className="text-sm font-medium">大纲结构</span>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {flatItems.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                请先在步骤1生成大纲
              </p>
            ) : (
              flatItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-1 px-1 py-1 text-xs rounded hover:bg-muted/50 cursor-pointer"
                  style={{ paddingLeft: `${item.depth * 16 + 4}px` }}
                  onClick={() => {
                    // Insert heading into active sheet editor
                    if (activeSheet) {
                      const heading = `<h${Math.min(item.depth + 1, 4)}>${item.section_number ? item.section_number + " " : ""}${item.title}</h${Math.min(item.depth + 1, 4)}>`;
                      handleContentChange(activeSheet.content + heading);
                    }
                  }}
                  title="点击插入为标题"
                >
                  <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="truncate">
                    {item.section_number && <span className="text-muted-foreground mr-1">{item.section_number}</span>}
                    {item.title}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Center: Editor with tabs */}
      <ResizablePanel defaultSize={55} minSize={35}>
        <Card className="h-full overflow-hidden flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center border-b border-border bg-muted/20 shrink-0">
            <div className="flex-1 flex items-center overflow-x-auto">
              {sheets.map((sheet) => (
                <div
                  key={sheet.id}
                  onClick={() => setActiveSheetId(sheet.id)}
                  onDoubleClick={() => {
                    setEditingTabId(sheet.id);
                    setEditingTabName(sheet.title);
                  }}
                  className={cn(
                    "flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-border whitespace-nowrap",
                    activeSheetId === sheet.id
                      ? "bg-background text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {editingTabId === sheet.id ? (
                    <Input
                      value={editingTabName}
                      onChange={(e) => setEditingTabName(e.target.value)}
                      onBlur={() => handleRenameTab(sheet.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameTab(sheet.id);
                        if (e.key === "Escape") setEditingTabId(null);
                      }}
                      className="h-5 w-24 text-xs px-1"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="max-w-[120px] truncate">{sheet.title}</span>
                  )}
                  {sheet.source_material_id && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="来自公司材料" />
                  )}
                  {sheets.length > 1 && (
                    <button
                      onClick={(e) => handleDeleteSheet(e, sheet.id)}
                      className="opacity-0 group-hover:opacity-100 hover:text-destructive ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={handleAddSheet}
                className="px-2 py-1.5 text-muted-foreground hover:text-foreground"
                title="新建标签页"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1 px-2 shrink-0">
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleManualSave} disabled={saving}>
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                保存
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleExportDocx}>
                <Download className="w-3 h-3" /> 导出
              </Button>
            </div>
          </div>
          {/* Editor area */}
          <div className="flex-1 min-h-0">
            {activeSheet ? (
              <RichTextEditor
                key={activeSheet.id}
                content={activeSheet.content || ""}
                onChange={handleContentChange}
                className="h-full border-0 rounded-none"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                暂无文档
              </div>
            )}
          </div>
        </Card>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right: Company materials browser */}
      <ResizablePanel defaultSize={25} minSize={15} maxSize={35}>
        <Card className="h-full overflow-hidden">
          <MaterialBrowser onLoadMaterial={handleLoadMaterial} />
        </Card>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
