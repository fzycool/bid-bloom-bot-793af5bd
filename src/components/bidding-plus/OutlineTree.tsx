import React, { useState, useRef, useCallback } from "react";
import {
  GripVertical, ChevronRight, ChevronDown, Pencil, Trash2,
  Check, X, Plus, ArrowUpRight, ArrowDownRight, ListOrdered,
  ScanSearch, ChevronDownIcon, FolderInput, Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuTrigger, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import type { FlatOutlineItem, DropPosition } from "./types";

interface OutlineTreeProps {
  flatItems: FlatOutlineItem[];
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onMove: (sourceId: string, targetId: string, position: DropPosition) => void;
  onAddChild: (parentId: string | null) => void;
  onAddSibling: (id: string) => void;
  onPromote: (id: string) => void;
  onDemote: (id: string) => void;
  onAutoNumber: () => void;
  onAutoParse: (customPrompt?: string) => void;
  onImportOutline: () => void;
  autoParseLoading?: boolean;
  hasDocument?: boolean;
}

export default function OutlineTree({
  flatItems, selectedId, expandedIds, onSelect, onToggle,
  onRename, onDelete, onMove, onAddChild, onAddSibling,
  onPromote, onDemote, onAutoNumber, onAutoParse, onImportOutline,
  autoParseLoading, hasDocument,
}: OutlineTreeProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<DropPosition | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  // Filter items based on expanded state
  const visibleItems: FlatOutlineItem[] = [];
  const collapsedParents = new Set<string>();
  for (const item of flatItems) {
    if (item.parent_id && collapsedParents.has(item.parent_id)) {
      collapsedParents.add(item.id); // propagate collapse
      continue;
    }
    visibleItems.push(item);
    if (item.has_children && !expandedIds.has(item.id)) {
      collapsedParents.add(item.id);
    }
  }

  const startEdit = (item: FlatOutlineItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const commitEdit = (item: FlatOutlineItem) => {
    if (editTitle.trim() && editTitle !== item.title) {
      onRename(item.id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = "0.5";
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = "1";
    setDragId(null);
    setDragOverId(null);
    setDropPos(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id === dragId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const pos: DropPosition = y < h * 0.25 ? "before" : y > h * 0.75 ? "after" : "inside";
    setDragOverId(id);
    setDropPos(pos);
  }, [dragId]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId || !dropPos) return;
    onMove(sourceId, targetId, dropPos);
    setDragId(null);
    setDragOverId(null);
    setDropPos(null);
  }, [dropPos, onMove]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, item: FlatOutlineItem) => {
    if (editingId) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onAddSibling(item.id);
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      onDemote(item.id);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      onPromote(item.id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (!editingId) {
        e.preventDefault();
        onDelete(item.id);
      }
    } else if (e.key === "F2") {
      e.preventDefault();
      startEdit(item);
    }
  }, [editingId, onAddSibling, onDemote, onPromote, onDelete]);

  // Count children for collapsed badge
  const childCount = (id: string) => flatItems.filter((f) => f.parent_id === id).length;

  const DEFAULT_PROMPT = "请根据招标文件内容，提取完整的投标文件大纲结构。要求：\n1. 严格按照招标文件中的章节结构和编号\n2. 包含所有必须响应的章节\n3. 保留原始章节编号格式";
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(() => {
    try {
      return localStorage.getItem("bidding_plus_custom_prompt") || DEFAULT_PROMPT;
    } catch { return DEFAULT_PROMPT; }
  });
  const [promptSaved, setPromptSaved] = useState(false);

  const savePrompt = (val: string) => {
    setCustomPrompt(val);
  };

  const persistPrompt = () => {
    try { localStorage.setItem("bidding_plus_custom_prompt", customPrompt); } catch {}
    setPromptSaved(true);
    setTimeout(() => setPromptSaved(false), 2000);
  };

  return (
    <div className="space-y-0.5">
      <div className="flex justify-end gap-1.5 mb-2">
        {/* 自动解析 button group */}
        <div className="flex items-center">
          <Button
            size="sm"
            variant="outline"
            className="rounded-r-none border-r-0"
            onClick={() => onAutoParse(customPrompt)}
            disabled={autoParseLoading || !hasDocument}
          >
            {autoParseLoading ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <ScanSearch className="w-3.5 h-3.5 mr-1" />
            )}
            自动解析
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="rounded-l-none px-1.5"
                disabled={autoParseLoading}
              >
                <ChevronDownIcon className="w-3.5 h-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium mb-1">自定义解析提示词</p>
                  <p className="text-xs text-muted-foreground mb-2">调整提示词以控制 AI 如何提取文档大纲</p>
                </div>
                <Textarea
                  value={customPrompt}
                  onChange={(e) => savePrompt(e.target.value)}
                  rows={6}
                  className="text-sm"
                  placeholder="请输入解析提示词..."
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { savePrompt(DEFAULT_PROMPT); setPromptSaved(false); }}
                  >
                    重置默认
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={persistPrompt}
                  >
                    {promptSaved ? <><Check className="w-3.5 h-3.5 mr-1" />已保存</> : "保存提示词"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => { persistPrompt(); onAutoParse(customPrompt); }}
                    disabled={autoParseLoading || !hasDocument}
                  >
                    开始解析
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* 大纲导入 */}
        <Button size="sm" variant="outline" onClick={onImportOutline}>
          <FolderInput className="w-3.5 h-3.5 mr-1" />大纲导入
        </Button>

        {/* 自动编号 */}
        <Button size="sm" variant="outline" onClick={onAutoNumber}>
          <ListOrdered className="w-3.5 h-3.5 mr-1" />自动编号
        </Button>
      </div>

      {visibleItems.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <p>暂无大纲节点</p>
          <p className="text-xs mt-1">在右侧原文中选择文字添加，或点击下方按钮</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => onAddChild(null)}>
            <Plus className="w-3.5 h-3.5 mr-1" />添加根节点
          </Button>
        </div>
      )}

      {visibleItems.map((item) => {
        const isOver = dragOverId === item.id;
        const isDragging = dragId === item.id;
        const isSelected = selectedId === item.id;

        return (
          <ContextMenu key={item.id}>
            <ContextMenuTrigger asChild>
              <div className="relative">
                {isOver && dropPos === "before" && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent z-10 rounded-full" />
                )}

                <div
                  draggable
                  tabIndex={0}
                  onDragStart={(e) => handleDragStart(e, item.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, item.id)}
                  onDragLeave={() => { if (dragOverId === item.id) { setDragOverId(null); setDropPos(null); } }}
                  onDrop={(e) => handleDrop(e, item.id)}
                  onClick={() => onSelect(item.id)}
                  onKeyDown={(e) => handleKeyDown(e, item)}
                  className={cn(
                    "flex items-center gap-1 py-1.5 px-1 rounded text-sm group transition-colors select-none outline-none",
                    isDragging && "opacity-40",
                    isOver && dropPos === "inside" && "bg-accent/10 ring-1 ring-accent/30",
                    isSelected && !isDragging && "bg-accent/15 ring-1 ring-accent/40",
                    !isDragging && !isOver && !isSelected && "hover:bg-muted/50",
                  )}
                  style={{ paddingLeft: item.depth * 20 + 4 }}
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />

                  {item.has_children ? (
                    <button onClick={(e) => { e.stopPropagation(); onToggle(item.id); }} className="shrink-0">
                      {expandedIds.has(item.id) ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}

                  {item.section_number && (
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {item.section_number}
                    </span>
                  )}

                  {editingId === item.id ? (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <Input
                        ref={editRef}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.stopPropagation(); commitEdit(item); }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-6 text-sm py-0 px-1.5"
                      />
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => commitEdit(item)}>
                        <Check className="w-3 h-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditingId(null)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <span
                      className="truncate flex-1 font-medium"
                      onDoubleClick={() => startEdit(item)}
                    >
                      {item.title}
                    </span>
                  )}

                  {item.source_text && (
                    <span className="text-xs text-accent" title="来自原文高亮">●</span>
                  )}

                  {item.has_children && !expandedIds.has(item.id) && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">
                      {childCount(item.id)}
                    </Badge>
                  )}

                  {editingId !== item.id && (
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); startEdit(item); }}>
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}>
                        <Trash2 className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </div>

                {isOver && dropPos === "after" && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent z-10 rounded-full" />
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onAddChild(item.id)}>
                <Plus className="w-4 h-4 mr-2" />添加子节点
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onAddSibling(item.id)}>
                <Plus className="w-4 h-4 mr-2" />添加同级节点
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={item.depth === 0} onClick={() => onPromote(item.id)}>
                <ArrowUpRight className="w-4 h-4 mr-2" />提升层级
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onDemote(item.id)}>
                <ArrowDownRight className="w-4 h-4 mr-2" />降低层级
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => startEdit(item)}>
                <Pencil className="w-4 h-4 mr-2" />重命名
              </ContextMenuItem>
              <ContextMenuItem className="text-destructive" onClick={() => onDelete(item.id)}>
                <Trash2 className="w-4 h-4 mr-2" />删除
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}
