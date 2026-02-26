import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { pdfToImages, type PageImage } from "@/lib/pdf-to-images";
import { imagesToPdf } from "@/lib/images-to-pdf";
import {
  Upload,
  FileText,
  Loader2,
  Download,
  Trash2,
  Clock,
  CheckCircle,
  AlertCircle,
  Send,
  Image,
} from "lucide-react";

interface Revision {
  id: string;
  original_file_name: string;
  revision_instructions: string;
  ai_status: string;
  revised_file_path: string | null;
  ai_result: any;
  created_at: string;
}

const ContractRevision = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [instructions, setInstructions] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");

  // PDF rendering state
  const [renderingPages, setRenderingPages] = useState(false);
  const [renderProgress, setRenderProgress] = useState("");
  const [pageImages, setPageImages] = useState<PageImage[]>([]);

  useEffect(() => {
    if (user) fetchRevisions();
  }, [user]);

  useEffect(() => {
    const processingItems = revisions.filter(
      (r) => r.ai_status === "pending" || r.ai_status === "processing"
    );
    if (processingItems.length === 0) return;
    const interval = setInterval(fetchRevisions, 3000);
    return () => clearInterval(interval);
  }, [revisions]);

  const fetchRevisions = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("contract_revisions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (!error && data) {
      setRevisions(data as Revision[]);
    }
    setLoading(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "仅支持PDF格式", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "文件不能超过20MB", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Render PDF pages to images
    setRenderingPages(true);
    setRenderProgress("正在解析PDF...");
    try {
      const images = await pdfToImages(file, 2, (current, total) => {
        setRenderProgress(`正在渲染页面 ${current}/${total}...`);
      });
      setPageImages(images);
      toast({ title: `PDF已解析，共${images.length}页` });
    } catch (err: any) {
      console.error("PDF rendering error:", err);
      toast({ title: "PDF解析失败: " + err.message, variant: "destructive" });
      setSelectedFile(null);
      setPageImages([]);
    } finally {
      setRenderingPages(false);
      setRenderProgress("");
    }
  };

  const handleSubmit = async () => {
    if (!user || !selectedFile || !instructions.trim() || pageImages.length === 0) {
      toast({ title: "请上传合同文件并输入修改指令", variant: "destructive" });
      return;
    }

    setProcessing(true);
    try {
      // 1. Upload original PDF
      const pdfPath = `${user.id}/contracts/${Date.now()}_contract.pdf`;
      const { error: upErr } = await supabase.storage
        .from("contract-files")
        .upload(pdfPath, selectedFile);
      if (upErr) throw upErr;

      // 2. Upload page images
      const pageImagePaths: string[] = [];
      for (let i = 0; i < pageImages.length; i++) {
        const pagePath = `${user.id}/contracts/${Date.now()}_page_${i + 1}.png`;
        const { error: pageUpErr } = await supabase.storage
          .from("contract-files")
          .upload(pagePath, pageImages[i].blob, { contentType: "image/png" });
        if (pageUpErr) throw pageUpErr;
        pageImagePaths.push(pagePath);
      }

      // 3. Create revision record
      const { data: rev, error: insertErr } = await supabase
        .from("contract_revisions")
        .insert({
          user_id: user.id,
          original_file_path: pdfPath,
          original_file_name: selectedFile.name,
          revision_instructions: instructions.trim(),
          ai_status: "pending",
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // 4. Call edge function with page image paths
      const { error: fnErr } = await supabase.functions.invoke(
        "contract-revision",
        { body: { revisionId: rev.id, pageImagePaths } }
      );
      if (fnErr) {
        console.error("Edge function error:", fnErr);
      }

      toast({ title: "合同修订任务已提交，AI正在进行图像级修改..." });
      setSelectedFile(null);
      setInstructions("");
      setPageImages([]);
      fetchRevisions();
    } catch (err: any) {
      console.error(err);
      toast({ title: "提交失败: " + err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };


  const handleDownload = async (revision: Revision) => {
    const aiResult = revision.ai_result as any;

    // Image-based result: download page images and create PDF
    if (aiResult?.final_page_paths) {
      setDownloading(true);
      try {
        const paths = aiResult.final_page_paths as string[];
        setDownloadProgress(`正在获取签名链接 (0/${paths.length})...`);
        
        const imageUrls: string[] = [];
        for (let i = 0; i < paths.length; i++) {
          setDownloadProgress(`正在获取签名链接 (${i + 1}/${paths.length})...`);
          const { data, error } = await supabase.storage
            .from("contract-files")
            .createSignedUrl(paths[i], 600);
          if (error) {
            console.error(`Signed URL error for page ${i + 1}:`, error);
            continue;
          }
          if (data?.signedUrl) {
            imageUrls.push(data.signedUrl);
          }
        }

        if (imageUrls.length === 0) {
          toast({ title: "无法获取修订页面", variant: "destructive" });
          setDownloading(false);
          setDownloadProgress("");
          return;
        }

        setDownloadProgress(`正在下载并生成PDF (${imageUrls.length}页)...`);
        const pdfBlob = await imagesToPdf(imageUrls);
        
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = revision.original_file_name.replace(/\.pdf$/i, "_修订版.pdf");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ title: "下载完成" });
      } catch (err: any) {
        console.error("PDF generation error:", err);
        toast({ title: "PDF生成失败: " + err.message, variant: "destructive" });
      } finally {
        setDownloading(false);
        setDownloadProgress("");
      }
      return;
    }

    // Legacy: direct file download
    if (!revision.revised_file_path || revision.revised_file_path === "image-based") return;
    const { data, error } = await supabase.storage
      .from("contract-files")
      .download(revision.revised_file_path);
    if (error || !data) {
      toast({ title: "下载失败", variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = revision.original_file_name.replace(/\.pdf$/i, "_修订版.pdf");
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("contract_revisions").delete().eq("id", id);
    fetchRevisions();
    toast({ title: "已删除" });
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />;
      case "processing":
      case "pending":
        return <Clock className="w-4 h-4 text-amber-500 dark:text-amber-400 animate-pulse" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-destructive" />;
      default:
        return null;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return "已完成";
      case "processing":
        return "图像修改中...";
      case "pending":
        return "排队中";
      case "error":
        return "处理失败";
      default:
        return status;
    }
  };

  const canDownload = (rev: Revision) => {
    if (rev.ai_status !== "completed") return false;
    const result = rev.ai_result as any;
    return result?.final_page_paths?.length > 0 || (rev.revised_file_path && rev.revised_file_path !== "image-based");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">合同修订（图像级P图）</h2>
        <p className="text-sm text-muted-foreground mt-1">
          上传PDF合同，输入修改指令，AI将在页面图像上直接进行视觉级修改，生成高仿真修订版
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">上传合同文件</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileSelect}
          />
          <div
            onClick={() => !renderingPages && fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent transition-colors"
          >
            {renderingPages ? (
              <div className="space-y-3">
                <Loader2 className="w-8 h-8 mx-auto text-accent animate-spin" />
                <p className="text-sm text-muted-foreground">{renderProgress}</p>
              </div>
            ) : selectedFile && pageImages.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <FileText className="w-5 h-5 text-accent" />
                  <span className="text-sm text-foreground">{selectedFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({pageImages.length}页已解析)
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setPageImages([]);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                {/* Page thumbnails */}
                <div className="flex gap-1 justify-center flex-wrap mt-2">
                  {pageImages.slice(0, 8).map((_, idx) => (
                    <div
                      key={idx}
                      className="w-8 h-10 bg-muted rounded border border-border flex items-center justify-center"
                    >
                      <span className="text-[8px] text-muted-foreground">{idx + 1}</span>
                    </div>
                  ))}
                  {pageImages.length > 8 && (
                    <div className="w-8 h-10 bg-muted rounded border border-border flex items-center justify-center">
                      <span className="text-[8px] text-muted-foreground">+{pageImages.length - 8}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  点击上传PDF合同文件（将自动解析为页面图像）
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">修改指令</label>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={`请描述需要修改的内容，例如：\n\n1. 将第三条第2款中的"甲方"改为"委托方"\n2. 将违约金比例从5%修改为3%\n3. 删除第五条第3款的内容`}
            rows={6}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!selectedFile || !instructions.trim() || processing || pageImages.length === 0}
          className="w-full"
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
              上传中...
            </>
          ) : (
            <>
              <Image className="w-4 h-4 mr-1" />
              提交图像级修改
            </>
          )}
        </Button>
      </Card>

      {/* Revision History */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">修订记录</h3>
        {downloading && downloadProgress && (
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{downloadProgress}</span>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">暂无修订记录</p>
        ) : (
          <div className="space-y-2">
            {revisions.map((rev) => {
              const result = rev.ai_result as any;
              const editedPages = result?.edited_page_numbers;
              return (
                <Card key={rev.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        {statusIcon(rev.ai_status)}
                        <span className="text-sm font-medium text-foreground truncate">
                          {rev.original_file_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {statusLabel(rev.ai_status)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {rev.revision_instructions}
                      </p>
                      {editedPages && editedPages.length > 0 && (
                        <p className="text-xs text-accent">
                          已修改第 {editedPages.join(", ")} 页
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60">
                        {new Date(rev.created_at).toLocaleString("zh-CN")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canDownload(rev) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(rev)}
                          disabled={downloading}
                        >
                          {downloading ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                              生成中
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5 mr-1" />
                              下载
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(rev.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContractRevision;
