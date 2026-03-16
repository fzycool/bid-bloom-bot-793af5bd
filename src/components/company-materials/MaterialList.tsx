import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Loader2,
  Trash2,
  CheckCircle,
  Clock,
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
  Eye,
  FileText,
  Download,
  Image as ImageIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CompanyMaterial {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string | null;
  ai_status: string;
  content_description: string | null;
  material_type: string | null;
  issuing_authority: string | null;
  certificate_number: string | null;
  expire_at: string | null;
  issued_at: string | null;
  ai_extracted_info: any;
  created_at: string;
  bid_analysis_id: string | null;
  folder_id: string | null;
}

function getExpiryStatus(expireAt: string | null) {
  if (!expireAt) return { label: "长期有效", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: ShieldCheck };
  const now = new Date();
  const expiry = new Date(expireAt);
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: `已过期`, color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", icon: AlertCircle };
  if (diffDays <= 30) return { label: `${diffDays}天后过期`, color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: AlertTriangle };
  if (diffDays <= 90) return { label: `${diffDays}天后过期`, color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", icon: Clock };
  return { label: `${expireAt}`, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: ShieldCheck };
}

const aiStatusConfig: Record<string, { icon: typeof CheckCircle; label: string; color: string }> = {
  completed: { icon: CheckCircle, label: "已识别", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  processing: { icon: Loader2, label: "识别中", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  pending: { icon: Clock, label: "待识别", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  failed: { icon: AlertCircle, label: "识别失败", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

interface MaterialListProps {
  folderId: string | null; // null = show all
  onMaterialChange?: () => void;
}

export default function MaterialList({ folderId, onMaterialChange }: MaterialListProps) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [materials, setMaterials] = useState<CompanyMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMaterials = useCallback(async () => {
    if (!user) return;
    let query = supabase
      .from("company_materials")
      .select("*")
      .order("created_at", { ascending: false });

    if (folderId !== null) {
      query = query.eq("folder_id", folderId);
    }

    const { data, error } = await query;
    if (error) {
      console.error("fetch materials error:", error);
    } else {
      setMaterials((data as CompanyMaterial[]) || []);
    }
    setLoading(false);
  }, [user, folderId]);

  useEffect(() => {
    setLoading(true);
    setSelectedIds(new Set());
    fetchMaterials();
  }, [fetchMaterials]);

  const getPublicUrl = (filePath: string) => {
    const { data } = supabase.storage.from("company-materials").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const isImageFile = (mat: CompanyMaterial) => {
    if (mat.file_type?.startsWith("image/")) return true;
    return /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(mat.file_name);
  };

  const handleDownload = (mat: CompanyMaterial) => {
    const url = getPublicUrl(mat.file_path);
    const a = document.createElement("a");
    a.href = url;
    a.download = mat.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user) return;

    const imageFiles = Array.from(files).filter((f) =>
      /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(f.name)
    );
    if (imageFiles.length === 0) {
      toast({ title: "仅支持图片格式", description: "请上传JPG/PNG/WEBP格式的图片", variant: "destructive" });
      return;
    }

    setUploading(true);
    for (const file of imageFiles) {
      try {
        const fileExt = file.name.split(".").pop() || "jpg";
        const filePath = `${user.id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("company-materials")
          .upload(filePath, file);
        if (uploadError) throw uploadError;

        const { data: docData, error: insertError } = await supabase
          .from("company_materials")
          .insert({
            user_id: user.id,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            file_type: file.type || null,
            folder_id: folderId,
          })
          .select()
          .single();
        if (insertError) throw insertError;

        supabase.functions
          .invoke("extract-material-info", {
            body: { materialId: docData.id, filePath },
          })
          .then(() => setTimeout(fetchMaterials, 2000))
          .catch(console.error);

        toast({ title: `${file.name} 上传成功`, description: "AI正在识别图片信息..." });
      } catch (err: any) {
        toast({ title: "上传失败", description: err.message, variant: "destructive" });
      }
    }
    setUploading(false);
    fetchMaterials();
    onMaterialChange?.();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (mat: CompanyMaterial) => {
    await supabase.storage.from("company-materials").remove([mat.file_path]);
    const { error } = await supabase.from("company_materials").delete().eq("id", mat.id);
    if (error) {
      toast({ title: "删除失败", description: error.message, variant: "destructive" });
    } else {
      setMaterials((prev) => prev.filter((m) => m.id !== mat.id));
      toast({ title: "已删除" });
      onMaterialChange?.();
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === materials.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(materials.map((m) => m.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (!selectedIds.size) return;
    const toDelete = materials.filter((m) => selectedIds.has(m.id));
    setDeleting(true);
    try {
      await supabase.storage.from("company-materials").remove(toDelete.map((m) => m.file_path));
      const { error } = await supabase
        .from("company_materials")
        .delete()
        .in("id", toDelete.map((m) => m.id));
      if (error) throw error;
      setMaterials((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      toast({ title: `已删除 ${toDelete.length} 个材料` });
      setSelectedIds(new Set());
      onMaterialChange?.();
    } catch (err: any) {
      toast({ title: "批量删除失败", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {folderId === null ? "全部材料" : "当前目录"} · {materials.length} 个文件
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && isAdmin && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBatchDelete}
              disabled={deleting}
              className="gap-1"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              删除 ({selectedIds.size})
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".jpg,.jpeg,.png,.webp,.bmp,.gif"
            onChange={handleUpload}
          />
          <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-1">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            上传
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : materials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ImageIcon className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">暂无材料</p>
            <p className="text-xs mt-1">点击上传按钮添加材料</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {isAdmin && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === materials.length && materials.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                )}
                <TableHead className="w-auto">文件名</TableHead>
                <TableHead className="hidden md:table-cell w-20 whitespace-nowrap">类型</TableHead>
                <TableHead className="hidden md:table-cell w-24 whitespace-nowrap">有效期</TableHead>
                <TableHead className="w-16 whitespace-nowrap">大小</TableHead>
                <TableHead className="w-14">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((mat) => {
                const status = aiStatusConfig[mat.ai_status] || aiStatusConfig.pending;
                const StatusIcon = status.icon;
                const expiry = mat.ai_status === "completed" ? getExpiryStatus(mat.expire_at) : null;
                const ExpiryIcon = expiry?.icon;
                const isSelected = selectedIds.has(mat.id);

                return (
                  <TableRow key={mat.id} className={isSelected ? "bg-accent/30" : ""}>
                    {isAdmin && (
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(mat.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        {isImageFile(mat) ? (
                          <div className="w-8 h-8 rounded border overflow-hidden shrink-0 bg-muted">
                            <img
                              src={getPublicUrl(mat.file_path)}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{mat.file_name}</p>
                          {mat.content_description && (
                            <p className="text-xs text-muted-foreground truncate">{mat.content_description}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {mat.material_type && <Badge variant="secondary" className="text-xs">{mat.material_type}</Badge>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {expiry ? (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${expiry.color}`}>
                          {ExpiryIcon && <ExpiryIcon className="w-3 h-3" />}
                          {expiry.label}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatSize(mat.file_size)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            if (isImageFile(mat)) {
                              setPreviewUrl(getPublicUrl(mat.file_path));
                              setPreviewName(mat.file_name);
                            } else {
                              handleDownload(mat);
                            }
                          }}
                          title={isImageFile(mat) ? "预览" : "下载"}
                        >
                          {isImageFile(mat) ? <Eye className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(mat)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Preview dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewName}</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img src={previewUrl} alt={previewName} className="w-full h-auto max-h-[80vh] object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
