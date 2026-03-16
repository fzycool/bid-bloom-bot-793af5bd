import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  FolderPlus,
  Building2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface FolderNode {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  children: FolderNode[];
}

interface FolderTreeProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  refreshKey?: number;
}

function buildTree(folders: Omit<FolderNode, "children">[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  for (const f of folders) {
    map.set(f.id, { ...f, children: [] });
  }

  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export default function FolderTree({ selectedFolderId, onSelectFolder, refreshKey }: FolderTreeProps) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Creating state
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined); // undefined = not creating
  const [newFolderName, setNewFolderName] = useState("");

  const fetchFolders = useCallback(async () => {
    const { data, error } = await supabase
      .from("material_folders")
      .select("id, name, parent_id, sort_order")
      .order("sort_order");
    if (error) {
      console.error("fetch folders error:", error);
      return;
    }
    setTree(buildTree(data || []));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders, refreshKey]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreate = async (parentId: string | null) => {
    if (!newFolderName.trim()) {
      setCreatingParentId(undefined);
      return;
    }
    const { error } = await supabase.from("material_folders").insert({
      name: newFolderName.trim(),
      parent_id: parentId,
      created_by: (await supabase.auth.getUser()).data.user!.id,
    });
    if (error) {
      toast({ title: "创建失败", description: error.message, variant: "destructive" });
    } else {
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      toast({ title: "目录已创建" });
    }
    setCreatingParentId(undefined);
    setNewFolderName("");
    fetchFolders();
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) {
      setEditingId(null);
      return;
    }
    const { error } = await supabase.from("material_folders").update({ name: editingName.trim() }).eq("id", id);
    if (error) {
      toast({ title: "重命名失败", description: error.message, variant: "destructive" });
    }
    setEditingId(null);
    fetchFolders();
  };

  const handleDelete = async (id: string) => {
    // Also clear folder_id on materials in this folder
    await supabase.from("company_materials").update({ folder_id: null }).eq("folder_id", id);
    const { error } = await supabase.from("material_folders").delete().eq("id", id);
    if (error) {
      toast({ title: "删除失败", description: error.message, variant: "destructive" });
    } else {
      if (selectedFolderId === id) onSelectFolder(null);
      toast({ title: "目录已删除" });
    }
    fetchFolders();
  };

  const renderNode = (node: FolderNode, depth: number) => {
    const isExpanded = expanded.has(node.id);
    const isSelected = selectedFolderId === node.id;
    const isEditing = editingId === node.id;
    const hasChildren = node.children.length > 0;
    const isCreatingChild = creatingParentId === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer group text-sm transition-colors",
            isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            onSelectFolder(node.id);
            if (hasChildren) toggleExpand(node.id);
          }}
        >
          {hasChildren || isCreatingChild ? (
            <button
              className="shrink-0 p-0.5"
              onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-4.5 shrink-0" />
          )}

          {isExpanded ? (
            <FolderOpen className="w-4 h-4 shrink-0 text-amber-500" />
          ) : (
            <Folder className="w-4 h-4 shrink-0 text-amber-500" />
          )}

          {isEditing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <Input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="h-6 text-sm py-0 px-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(node.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleRename(node.id)}>
                <Check className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEditingId(null)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <>
              <span className="truncate flex-1">{node.name}</span>
              {isAdmin && (
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    title="添加子目录"
                    onClick={() => {
                      setCreatingParentId(node.id);
                      setNewFolderName("");
                      setExpanded((prev) => new Set(prev).add(node.id));
                    }}
                  >
                    <FolderPlus className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => { setEditingId(node.id); setEditingName(node.name); }}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认删除目录</AlertDialogTitle>
                        <AlertDialogDescription>
                          将删除「{node.name}」及其所有子目录，目录下的材料将移至未分类。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(node.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </>
          )}
        </div>

        {/* Children */}
        {isExpanded && node.children.map((child) => renderNode(child, depth + 1))}

        {/* Inline create child */}
        {isCreatingChild && isExpanded && (
          <div className="flex items-center gap-1 py-1 px-2" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            <Folder className="w-4 h-4 shrink-0 text-amber-500" />
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="目录名称"
              className="h-6 text-sm py-0 px-1 flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate(node.id);
                if (e.key === "Escape") setCreatingParentId(undefined);
              }}
            />
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCreate(node.id)}>
              <Check className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setCreatingParentId(undefined)}>
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold text-foreground">目录</span>
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="新建根目录"
            onClick={() => { setCreatingParentId(null); setNewFolderName(""); }}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {/* All materials */}
        <div
          className={cn(
            "flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer text-sm transition-colors mx-1",
            selectedFolderId === null ? "bg-accent text-accent-foreground" : "hover:bg-muted"
          )}
          onClick={() => onSelectFolder(null)}
        >
          <span className="w-4.5 shrink-0" />
          <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="truncate flex-1">全部材料</span>
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-4">加载中...</div>
        ) : (
          <>
            {tree.map((node) => renderNode(node, 0))}

            {/* Inline create root */}
            {creatingParentId === null && (
              <div className="flex items-center gap-1 py-1 px-2 mx-1">
                <span className="w-4.5 shrink-0" />
                <Folder className="w-4 h-4 shrink-0 text-amber-500" />
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="目录名称"
                  className="h-6 text-sm py-0 px-1 flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate(null);
                    if (e.key === "Escape") setCreatingParentId(undefined);
                  }}
                />
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCreate(null)}>
                  <Check className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setCreatingParentId(undefined)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
