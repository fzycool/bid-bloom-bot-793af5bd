import React, { useState, useRef, useCallback } from "react";
import { GripVertical, ChevronRight, ChevronDown, Pencil, Trash2, Check, X, ListOrdered } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TocEntry {
  id: string;
  parent_section_id: string | null;
  title: string;
  content: string | null;
  section_number: string | null;
  sort_order: number;
}

interface SectionNode {
  id: string;
  title: string;
  section_number: string | null;
  sort_order: number;
  parent_id: string | null;
  children?: SectionNode[];
}

// Flattened item for rendering
interface FlatItem {
  id: string;
  title: string;
  section_number: string | null;
  sort_order: number;
  depth: number;
  type: "section" | "toc";
  parentId: string | null;
  content?: string | null;
  hasChildren: boolean;
  sectionId?: string; // for toc entries, the parent section
}

type DropPosition = "before" | "after" | "inside";

interface ReorderItem {
  id: string;
  sort_order: number;
  parent_id: string | null;
  type: "section" | "toc";
}

interface TocDragEditorProps {
  sections: SectionNode[];
  tocEntries: TocEntry[];
  expandedSections: Set<string>;
  onToggle: (id: string) => void;
  onReorder: (items: ReorderItem[]) => void;
  onRenameEntry: (id: string, title: string, type: "section" | "toc") => void;
  onDeleteEntry: (id: string, type: "section" | "toc") => void;
}

export default function TocDragEditor({
  sections,
  tocEntries: externalTocEntries,
  expandedSections,
  onToggle,
  onReorder,
  onRenameEntry,
  onDeleteEntry,
}: TocDragEditorProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  // Local optimistic state
  const [localTocEntries, setLocalTocEntries] = useState<TocEntry[]>(externalTocEntries);
  const [localSections, setLocalSections] = useState<SectionNode[]>(sections);
  
  // Sync from props when external data changes (e.g. after refetch)
  React.useEffect(() => {
    setLocalTocEntries(externalTocEntries);
  }, [externalTocEntries]);
  
  React.useEffect(() => {
    setLocalSections(sections);
  }, [sections]);

  const tocEntries = localTocEntries;

  // Build TOC map by parent
  const tocByParent = new Map<string, TocEntry[]>();
  tocEntries.forEach((e) => {
    const pid = e.parent_section_id || "__root__";
    if (!tocByParent.has(pid)) tocByParent.set(pid, []);
    tocByParent.get(pid)!.push(e);
  });

  // Flatten tree for rendering (always sort by sort_order)
  const flatItems: FlatItem[] = [];
  const flattenSection = (section: SectionNode, depth: number) => {
    const tocChildren = (tocByParent.get(section.id) || []).sort((a, b) => a.sort_order - b.sort_order);
    const hasChildren = (section.children && section.children.length > 0) || tocChildren.length > 0;
    flatItems.push({
      id: section.id,
      title: section.title,
      section_number: section.section_number,
      sort_order: section.sort_order,
      depth,
      type: "section",
      parentId: section.parent_id,
      hasChildren,
    });
    if (expandedSections.has(section.id)) {
      const sortedChildren = [...(section.children || [])].sort((a, b) => a.sort_order - b.sort_order);
      sortedChildren.forEach((child) => flattenSection(child, depth + 1));
      tocChildren.forEach((toc) => {
        flatItems.push({
          id: toc.id,
          title: toc.title,
          section_number: toc.section_number,
          sort_order: toc.sort_order,
          depth: depth + 1,
          type: "toc",
          parentId: toc.parent_section_id,
          content: toc.content,
          hasChildren: false,
          sectionId: toc.parent_section_id || undefined,
        });
      });
    }
  };
  // Sort root sections by sort_order
  [...localSections].sort((a, b) => a.sort_order - b.sort_order).forEach((s) => flattenSection(s, 0));

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    setDragId(null);
    setDragOverId(null);
    setDropPosition(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id === dragId) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    let pos: DropPosition;
    if (y < height * 0.25) {
      pos = "before";
    } else if (y > height * 0.75) {
      pos = "after";
    } else {
      pos = "inside";
    }

    setDragOverId(id);
    setDropPosition(pos);
  }, [dragId]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId || !dropPosition) return;

    // Find source and target in flat items
    const sourceIdx = flatItems.findIndex((f) => f.id === sourceId);
    const targetIdx = flatItems.findIndex((f) => f.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const source = flatItems[sourceIdx];
    const target = flatItems[targetIdx];

    let newParentId: string | null;
    let insertIdx: number;

    if (dropPosition === "inside") {
      if (target.type === "section") {
        newParentId = target.id;
        insertIdx = 999; // append at end
      } else {
        return;
      }
    } else {
      newParentId = target.parentId;
      if (dropPosition === "before") {
        insertIdx = target.sort_order;
      } else {
        insertIdx = target.sort_order + 1;
      }
    }

    // Collect all siblings at the target parent (same type as source)
    const allSiblings = flatItems
      .filter((f) => f.parentId === newParentId && f.type === source.type && f.id !== sourceId)
      .sort((a, b) => a.sort_order - b.sort_order);

    const reordered: ReorderItem[] = [];
    let inserted = false;
    let order = 0;

    for (const sib of allSiblings) {
      if (!inserted && order >= insertIdx) {
        reordered.push({ id: sourceId, sort_order: order, parent_id: newParentId, type: source.type });
        order++;
        inserted = true;
      }
      reordered.push({ id: sib.id, sort_order: order, parent_id: sib.parentId, type: sib.type });
      order++;
    }
    if (!inserted) {
      reordered.push({ id: sourceId, sort_order: order, parent_id: newParentId, type: source.type });
    }

    // Optimistically update local sections - use a flat map of sort_order updates
    const reorderMap = new Map(reordered.map(r => [r.id, r]));
    
    setLocalSections((prev) => {
      const updateNodes = (nodes: SectionNode[]): SectionNode[] => {
        return nodes.map((node) => {
          const update = reorderMap.get(node.id);
          const newNode = update
            ? { ...node, sort_order: update.sort_order, parent_id: update.parent_id }
            : { ...node };
          if (node.children) {
            newNode.children = updateNodes(node.children);
          }
          return newNode;
        });
      };
      return updateNodes(prev);
    });

    // Optimistically update local toc entries
    setLocalTocEntries((prev) =>
      prev.map((entry) => {
        const update = reorderMap.get(entry.id);
        return update
          ? { ...entry, sort_order: update.sort_order, parent_section_id: update.parent_id }
          : entry;
      })
    );

    onReorder(reordered);
    setDragId(null);
    setDragOverId(null);
    setDropPosition(null);
  }, [flatItems, dropPosition, onReorder]);

  const startEditing = (item: FlatItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const commitEdit = (item: FlatItem) => {
    if (editTitle.trim() && editTitle !== item.title) {
      onRenameEntry(item.id, editTitle.trim(), item.type);
    }
    setEditingId(null);
  };

  return (
    <div className="space-y-0.5">
      {flatItems.map((item) => {
        const isOver = dragOverId === item.id;
        const isDragging = dragId === item.id;

        return (
          <div key={item.id} className="relative">
            {/* Drop indicator: before */}
            {isOver && dropPosition === "before" && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent z-10 rounded-full" />
            )}

            <div
              draggable
              onDragStart={(e) => handleDragStart(e, item.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, item.id)}
              onDragLeave={() => { if (dragOverId === item.id) { setDragOverId(null); setDropPosition(null); } }}
              onDrop={(e) => handleDrop(e, item.id)}
              className={cn(
                "flex items-center gap-1 py-1.5 px-1 rounded text-sm group transition-colors select-none",
                isDragging && "opacity-40",
                isOver && dropPosition === "inside" && "bg-accent/10 ring-1 ring-accent/30",
                !isDragging && !isOver && "hover:bg-muted/50",
              )}
              style={{ paddingLeft: item.depth * 16 + 4 }}
            >
              {/* Drag handle */}
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" />

              {/* Expand/collapse */}
              {item.hasChildren ? (
                <button onClick={() => onToggle(item.id)} className="shrink-0">
                  {expandedSections.has(item.id) ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
              ) : (
                <span className="w-3.5 shrink-0" />
              )}

              {/* Section number */}
              {item.section_number && (
                <span className={cn(
                  "text-xs font-mono shrink-0",
                  item.type === "toc" ? "text-accent" : "text-muted-foreground"
                )}>
                  {item.section_number}
                </span>
              )}

              {/* Title */}
              {editingId === item.id ? (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <Input
                    ref={editRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(item);
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
                  className={cn(
                    "truncate flex-1",
                    item.type === "section" ? "font-medium" : "text-foreground/80"
                  )}
                  onDoubleClick={() => startEditing(item)}
                >
                  {item.title}
                </span>
              )}

              {/* Content indicator */}
              {item.type === "toc" && item.content && !expandedSections.has(item.id) && (
                <span className="text-xs text-accent">●</span>
              )}

              {/* Badge for child count */}
              {item.hasChildren && !expandedSections.has(item.id) && item.type === "section" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">
                  {(tocByParent.get(item.id) || []).length}项
                </Badge>
              )}

              {/* Edit/Delete buttons */}
              {editingId !== item.id && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => startEditing(item)}>
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => onDeleteEntry(item.id, item.type)}>
                    <Trash2 className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </div>
              )}
            </div>

            {/* TOC content preview when expanded */}
            {item.type === "toc" && expandedSections.has(item.id) && item.content && (
              <div style={{ paddingLeft: (item.depth + 1) * 16 + 8 }} className="mb-2 pr-2">
                <div className="border rounded-md p-3 bg-muted/30 text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                  {item.content}
                </div>
              </div>
            )}

            {/* Drop indicator: after */}
            {isOver && dropPosition === "after" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent z-10 rounded-full" />
            )}
          </div>
        );
      })}
    </div>
  );
}
