import React, { useState, useEffect, useCallback } from "react";
import { Building2, FileText, FolderOpen, Loader2, ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface MaterialItem {
  id: string;
  file_name: string;
  file_path: string;
  material_type: string | null;
  content_description: string | null;
  folder_id: string | null;
}

interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
}

interface MaterialBrowserProps {
  onLoadMaterial: (material: MaterialItem, content: string) => void;
}

export default function MaterialBrowser({ onLoadMaterial }: MaterialBrowserProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: "全部" },
  ]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [foldersRes, materialsRes] = await Promise.all([
        supabase.from("material_folders").select("id, name, parent_id").order("sort_order"),
        supabase.from("company_materials").select("id, file_name, file_path, material_type, content_description, folder_id"),
      ]);
      if (foldersRes.error) throw foldersRes.error;
      if (materialsRes.error) throw materialsRes.error;
      setFolders((foldersRes.data as FolderItem[]) || []);
      setMaterials((materialsRes.data as MaterialItem[]) || []);
    } catch (err: any) {
      toast({ title: "加载公司材料失败", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const navigateToFolder = (folderId: string | null, folderName: string) => {
    setCurrentFolder(folderId);
    if (folderId === null) {
      setBreadcrumb([{ id: null, name: "全部" }]);
    } else {
      const idx = breadcrumb.findIndex((b) => b.id === folderId);
      if (idx >= 0) {
        setBreadcrumb(breadcrumb.slice(0, idx + 1));
      } else {
        setBreadcrumb([...breadcrumb, { id: folderId, name: folderName }]);
      }
    }
  };

  const handleLoadMaterial = async (material: MaterialItem) => {
    setLoadingId(material.id);
    try {
      const { data, error } = await supabase.storage
        .from("company-materials")
        .download(material.file_path);
      if (error) throw error;

      // Extract text content
      const lower = material.file_name.toLowerCase();
      let textContent = "";

      if (lower.endsWith(".txt")) {
        textContent = await data.text();
      } else if (lower.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const buf = await data.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        textContent = result.value; // HTML
      } else if (lower.endsWith(".pdf")) {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        const buf = await data.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const parts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          parts.push(tc.items.map((item: any) => item.str).join(""));
        }
        textContent = `<p>${parts.join("</p><p>")}</p>`;
      } else {
        textContent = `<p>不支持预览的文件格式: ${material.file_name}</p>`;
      }

      onLoadMaterial(material, textContent);
      toast({ title: "材料已加载", description: material.file_name });
    } catch (err: any) {
      toast({ title: "加载材料失败", description: err.message, variant: "destructive" });
    } finally {
      setLoadingId(null);
    }
  };

  const currentFolders = folders.filter((f) => f.parent_id === currentFolder);
  const currentMaterials = materials.filter((m) => {
    const matchFolder = m.folder_id === currentFolder;
    const matchSearch = !searchQuery || m.file_name.toLowerCase().includes(searchQuery.toLowerCase());
    return searchQuery ? matchSearch : matchFolder;
  });

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">公司材料</span>
        </div>
        <Input
          placeholder="搜索材料..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-7 text-xs"
        />
      </div>

      {/* Breadcrumb */}
      {!searchQuery && (
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto shrink-0">
          {breadcrumb.map((b, i) => (
            <React.Fragment key={b.id ?? "root"}>
              {i > 0 && <ChevronRight className="w-3 h-3 shrink-0" />}
              <button
                onClick={() => navigateToFolder(b.id, b.name)}
                className="hover:text-foreground whitespace-nowrap"
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Folders */}
              {!searchQuery && currentFolders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => navigateToFolder(folder.id, folder.name)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-left"
                >
                  <FolderOpen className="w-4 h-4 text-accent shrink-0" />
                  <span className="text-sm truncate">{folder.name}</span>
                </button>
              ))}

              {/* Materials */}
              {currentMaterials.map((material) => (
                <button
                  key={material.id}
                  onClick={() => handleLoadMaterial(material)}
                  disabled={loadingId === material.id}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-left group",
                    loadingId === material.id && "opacity-50"
                  )}
                >
                  {loadingId === material.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs truncate">{material.file_name}</p>
                    {material.material_type && (
                      <p className="text-[10px] text-muted-foreground truncate">{material.material_type}</p>
                    )}
                  </div>
                  <Plus className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                </button>
              ))}

              {currentFolders.length === 0 && currentMaterials.length === 0 && (
                <p className="text-center py-4 text-xs text-muted-foreground">
                  {searchQuery ? "无匹配结果" : "此目录为空"}
                </p>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
