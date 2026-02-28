import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileText,
  Search,
  Loader2,
  Trash2,
  Filter,
  X,
  BookOpen,
  CheckCircle,
  Clock,
  AlertCircle,
  CheckSquare,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string | null;
  doc_category: string | null;
  industry: string | null;
  owner_name: string | null;
  doc_year: number | null;
  amount_range: string | null;
  tags: string[];
  ai_status: string;
  ai_summary: string | null;
  created_at: string;
}

const CATEGORIES = [
  "全部",
  "招标文件",
  "投标文件",
  "资质证书",
  "人员证书",
  "合同业绩",
  "友商报价",
  "技术方案",
  "其他",
];

const statusConfig: Record<string, { icon: typeof CheckCircle; label: string; color: string }> = {
  completed: { icon: CheckCircle, label: "已分析", color: "bg-green-100 text-green-800" },
  processing: { icon: Loader2, label: "分析中", color: "bg-blue-100 text-blue-800" },
  pending: { icon: Clock, label: "待分析", color: "bg-yellow-100 text-yellow-800" },
  failed: { icon: AlertCircle, label: "分析失败", color: "bg-red-100 text-red-800" },
};

export default function KnowledgeBase() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, fileName: "" });
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("全部");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const fetchDocuments = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("fetch docs error:", error);
    } else {
      setDocuments((data as Document[])?.map(d => ({ ...d, tags: Array.isArray(d.tags) ? d.tags.filter(t => t != null && t !== "") : [] })) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user) return;

    const fileList = Array.from(files);
    setUploading(true);
    setUploadProgress({ current: 0, total: fileList.length, fileName: "" });

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setUploadProgress({ current: i + 1, total: fileList.length, fileName: file.name });
      try {
        const fileExt = file.name.split('.').pop() || 'bin';
        const filePath = `${user.id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("knowledge-base")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: docData, error: insertError } = await supabase
          .from("documents")
          .insert({
            user_id: user.id,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            file_type: file.type || null,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        supabase.functions.invoke("classify-document", {
          body: {
            documentId: docData.id,
            fileName: file.name,
            fileType: file.type || "unknown",
          },
        }).then(() => {
          setTimeout(fetchDocuments, 1000);
        }).catch(console.error);

        toast({ title: `${file.name} 上传成功`, description: "AI正在自动分析分类..." });
      } catch (err: any) {
        toast({ title: "上传失败", description: err.message, variant: "destructive" });
      }
    }
    setUploading(false);
    setUploadProgress({ current: 0, total: 0, fileName: "" });
    fetchDocuments();
    e.target.value = "";
  };

  const handleDelete = async (doc: Document) => {
    const { error: storageError } = await supabase.storage
      .from("knowledge-base")
      .remove([doc.file_path]);
    if (storageError) console.error("storage delete error:", storageError);

    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      toast({ title: "删除失败", description: error.message, variant: "destructive" });
    } else {
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(doc.id); return next; });
      toast({ title: "已删除" });
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    const toDelete = documents.filter((d) => selectedIds.has(d.id));
    const filePaths = toDelete.map((d) => d.file_path);

    await supabase.storage.from("knowledge-base").remove(filePaths);

    const { error } = await supabase
      .from("documents")
      .delete()
      .in("id", Array.from(selectedIds));

    if (error) {
      toast({ title: "批量删除失败", description: error.message, variant: "destructive" });
    } else {
      setDocuments((prev) => prev.filter((d) => !selectedIds.has(d.id)));
      toast({ title: `已删除 ${selectedIds.size} 个文档` });
      setSelectedIds(new Set());
    }
    setBatchDeleting(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((d) => d.id)));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filtered = documents.filter((d) => {
    const matchCategory = activeCategory === "全部" || d.doc_category === activeCategory;
    const matchSearch =
      !search ||
      d.file_name.toLowerCase().includes(search.toLowerCase()) ||
      d.ai_summary?.toLowerCase().includes(search.toLowerCase()) ||
      d.industry?.toLowerCase().includes(search.toLowerCase()) ||
      d.owner_name?.toLowerCase().includes(search.toLowerCase());
    return matchCategory && matchSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-accent" />
            知识库中枢
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            上传文档后AI自动识别分类，构建企业记忆体
          </p>
        </div>
        <div>
          <input
            type="file"
            id="file-upload"
            className="hidden"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.txt"
            onChange={handleUpload}
          />
          <Button
            onClick={() => document.getElementById("file-upload")?.click()}
            disabled={uploading}
            className="gap-2"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            上传文档
          </Button>
        </div>
      </div>

      {/* Upload Progress */}
      {uploading && uploadProgress.total > 0 && (
        <div className="space-y-2 p-4 rounded-lg bg-secondary/50 border border-border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground font-medium truncate max-w-[60%]">
              正在上传: {uploadProgress.fileName}
            </span>
            <span className="text-muted-foreground">
              {uploadProgress.current} / {uploadProgress.total}
            </span>
          </div>
          <Progress value={(uploadProgress.current / uploadProgress.total) * 100} className="h-2" />
        </div>
      )}

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索文件名、行业、业主..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Documents */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">暂无文档</p>
            <p className="text-sm">点击上方「上传文档」按钮添加文件</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Select all bar */}
          <div className="flex items-center justify-between px-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground">
              <Checkbox
                checked={filtered.length > 0 && selectedIds.size === filtered.length}
                onCheckedChange={toggleSelectAll}
              />
              全选（{selectedIds.size}/{filtered.length}）
            </label>
            {selectedIds.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                disabled={batchDeleting}
                onClick={handleBatchDelete}
              >
                {batchDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                删除选中（{selectedIds.size}）
              </Button>
            )}
          </div>

          <div className="grid gap-3">
            {filtered.map((doc) => {
              const status = statusConfig[doc.ai_status] || statusConfig.pending;
              const StatusIcon = status.icon;
              return (
                <Card key={doc.id} className={`hover:shadow-card-hover transition-shadow ${selectedIds.has(doc.id) ? "ring-2 ring-accent" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="flex items-center gap-2 shrink-0 pt-0.5">
                          <Checkbox
                            checked={selectedIds.has(doc.id)}
                            onCheckedChange={() => toggleSelect(doc.id)}
                          />
                          <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                            <FileText className="w-5 h-5 text-muted-foreground" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{doc.file_name}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">{formatSize(doc.file_size)}</span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(doc.created_at).toLocaleDateString("zh-CN")}
                            </span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${status.color}`}>
                              <StatusIcon className={`w-3 h-3 ${doc.ai_status === "processing" ? "animate-spin" : ""}`} />
                              {status.label}
                            </span>
                          </div>
                          {doc.ai_status === "completed" && (
                            <div className="mt-2 space-y-1">
                              {doc.ai_summary && (
                                <p className="text-xs text-muted-foreground line-clamp-2">{doc.ai_summary}</p>
                              )}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {doc.doc_category && doc.doc_category !== "null" && (
                                  <Badge variant="secondary" className="text-xs">{doc.doc_category}</Badge>
                                )}
                                {doc.industry && doc.industry !== "null" && (
                                  <Badge variant="outline" className="text-xs">{doc.industry}</Badge>
                                )}
                                {doc.owner_name && doc.owner_name !== "null" && (
                                  <Badge variant="outline" className="text-xs">{doc.owner_name}</Badge>
                                )}
                                {doc.doc_year && (
                                  <Badge variant="outline" className="text-xs">{doc.doc_year}年</Badge>
                                )}
                                {doc.amount_range && doc.amount_range !== "null" && (
                                  <Badge variant="outline" className="text-xs">{doc.amount_range}</Badge>
                                )}
                                {(doc.tags || []).filter(tag => tag != null && tag !== "" && tag !== "null").map((tag) => (
                                  <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(doc)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
