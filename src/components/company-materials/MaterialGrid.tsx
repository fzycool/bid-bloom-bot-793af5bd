import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Image as ImageIcon,
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
  ArrowLeft,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";


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
}

function getExpiryStatus(expireAt: string | null) {
  if (!expireAt) return { label: "长期有效", color: "bg-green-100 text-green-800", icon: ShieldCheck };
  const now = new Date();
  const expiry = new Date(expireAt);
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: `已过期${Math.abs(diffDays)}天`, color: "bg-red-100 text-red-800", icon: AlertCircle };
  if (diffDays <= 30) return { label: `${diffDays}天后过期`, color: "bg-yellow-100 text-yellow-800", icon: AlertTriangle };
  if (diffDays <= 90) return { label: `${diffDays}天后过期`, color: "bg-orange-100 text-orange-800", icon: Clock };
  return { label: `有效期至${expireAt}`, color: "bg-green-100 text-green-800", icon: ShieldCheck };
}

interface MaterialGridProps {
  projectId: string | null; // null = 通用材料
  projectName: string;
  onBack: () => void;
}

export default function MaterialGrid({ projectId, projectName, onBack }: MaterialGridProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [materials, setMaterials] = useState<CompanyMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMaterials = useCallback(async () => {
    if (!user) return;
    let query = supabase
      .from("company_materials")
      .select("*")
      .order("created_at", { ascending: false });

    if (projectId) {
      query = query.eq("bid_analysis_id", projectId);
    } else {
      query = query.is("bid_analysis_id", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error("fetch materials error:", error);
    } else {
      setMaterials((data as CompanyMaterial[]) || []);
    }
    setLoading(false);
  }, [user, projectId]);

  useEffect(() => {
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
            bid_analysis_id: projectId,
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
      const paths = toDelete.map((m) => m.file_path);
      await supabase.storage.from("company-materials").remove(paths);
      const { error } = await supabase
        .from("company_materials")
        .delete()
        .in("id", toDelete.map((m) => m.id));
      if (error) throw error;
      setMaterials((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      toast({ title: `已删除 ${toDelete.length} 个材料` });
      setSelectedIds(new Set());
      setSelectMode(false);
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

  const aiStatusConfig: Record<string, { icon: typeof CheckCircle; label: string; color: string }> = {
    completed: { icon: CheckCircle, label: "已识别", color: "bg-green-100 text-green-800" },
    processing: { icon: Loader2, label: "识别中", color: "bg-blue-100 text-blue-800" },
    pending: { icon: Clock, label: "待识别", color: "bg-yellow-100 text-yellow-800" },
    failed: { icon: AlertCircle, label: "识别失败", color: "bg-red-100 text-red-800" },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold text-foreground">{projectName}</h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              {materials.length} 个材料
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {selectMode ? (
            <>
              <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                {selectedIds.size === materials.length ? "取消全选" : "全选"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }}>
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBatchDelete}
                disabled={deleting}
                className="gap-1"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                删除 ({selectedIds.size})
              </Button>
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.bmp,.gif"
                onChange={handleUpload}
              />
              {materials.length > 0 && (
                <Button variant="outline" onClick={() => setSelectMode(true)} className="gap-2">
                  <Trash2 className="w-4 h-4" />
                  批量删除
                </Button>
              )}
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                上传图片
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      ) : materials.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <ImageIcon className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">暂无材料</p>
            <p className="text-sm">点击上方「上传图片」按钮添加材料</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {materials.map((mat) => {
            const status = aiStatusConfig[mat.ai_status] || aiStatusConfig.pending;
            const StatusIcon = status.icon;
            const expiry = mat.ai_status === "completed" ? getExpiryStatus(mat.expire_at) : null;
            const ExpiryIcon = expiry?.icon;
            const imgUrl = getPublicUrl(mat.file_path);
            const isSelected = selectedIds.has(mat.id);

            return (
              <Card key={mat.id} className={`overflow-hidden hover:shadow-card-hover transition-shadow ${isSelected ? "ring-2 ring-primary" : ""}`}>
                <div
                  className="relative aspect-[4/3] bg-muted cursor-pointer group"
                  onClick={() => {
                    if (selectMode) { toggleSelect(mat.id); return; }
                    if (isImageFile(mat)) {
                      setPreviewUrl(imgUrl);
                      setPreviewName(mat.file_name);
                    } else {
                      handleDownload(mat);
                    }
                  }}
                >
                  {isImageFile(mat) ? (
                    <img src={imgUrl} alt={mat.file_name} className="w-full h-full object-contain" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                      <FileText className="w-12 h-12 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground font-medium">{mat.file_name.split('.').pop()?.toUpperCase()}</p>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    {isImageFile(mat) ? (
                      <Eye className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    ) : (
                      <Download className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                  {expiry && (
                    <div className="absolute top-2 right-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium shadow-sm ${expiry.color}`}>
                        {ExpiryIcon && <ExpiryIcon className="w-3 h-3" />}
                        {expiry.label}
                      </span>
                    </div>
                  )}
                  <div className="absolute top-2 left-2">
                    {selectMode ? (
                      <div className="bg-background rounded-sm shadow-sm p-0.5" onClick={(e) => { e.stopPropagation(); toggleSelect(mat.id); }}>
                        <Checkbox checked={isSelected} />
                      </div>
                    ) : (
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium shadow-sm ${status.color}`}>
                        <StatusIcon className={`w-3 h-3 ${mat.ai_status === "processing" ? "animate-spin" : ""}`} />
                        {status.label}
                      </span>
                    )}
                  </div>
                </div>

                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm text-foreground truncate flex-1">{mat.file_name}</p>
                    <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(mat)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(mat.file_size)} · {new Date(mat.created_at).toLocaleDateString("zh-CN")}
                  </p>
                  {mat.ai_status === "completed" && (
                    <div className="space-y-1.5">
                      {mat.content_description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{mat.content_description}</p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {mat.material_type && <Badge variant="secondary" className="text-xs">{mat.material_type}</Badge>}
                        {mat.issuing_authority && <Badge variant="outline" className="text-xs">{mat.issuing_authority}</Badge>}
                        {mat.certificate_number && <Badge variant="outline" className="text-xs">编号: {mat.certificate_number}</Badge>}
                        {mat.issued_at && <Badge variant="outline" className="text-xs">颁发: {mat.issued_at}</Badge>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
