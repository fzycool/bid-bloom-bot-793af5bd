import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";

interface Revision {
  id: string;
  original_file_name: string;
  revision_instructions: string;
  ai_status: string;
  revised_file_path: string | null;
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

  useEffect(() => {
    if (user) fetchRevisions();
  }, [user]);

  // Poll for processing status
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
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
  };

  const handleSubmit = async () => {
    if (!user || !selectedFile || !instructions.trim()) {
      toast({ title: "请上传合同文件并输入修改指令", variant: "destructive" });
      return;
    }

    setProcessing(true);
    try {
      // Upload PDF
      const ext = "pdf";
      const path = `${user.id}/contracts/${Date.now()}_contract.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("contract-files")
        .upload(path, selectedFile);

      if (upErr) throw upErr;

      // Create revision record
      const { data: rev, error: insertErr } = await supabase
        .from("contract_revisions")
        .insert({
          user_id: user.id,
          original_file_path: path,
          original_file_name: selectedFile.name,
          revision_instructions: instructions.trim(),
          ai_status: "pending",
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Trigger edge function
      const { error: fnErr } = await supabase.functions.invoke(
        "contract-revision",
        { body: { revisionId: rev.id } }
      );

      if (fnErr) {
        console.error("Edge function error:", fnErr);
        // The function may still be processing in background
      }

      toast({ title: "合同修订任务已提交，AI正在处理..." });
      setSelectedFile(null);
      setInstructions("");
      fetchRevisions();
    } catch (err: any) {
      console.error(err);
      toast({ title: "提交失败: " + err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async (revision: Revision) => {
    if (!revision.revised_file_path) return;
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
    a.download = revision.original_file_name.replace(
      /\.pdf$/i,
      "_修订版.pdf"
    );
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
        return "处理中...";
      case "pending":
        return "排队中";
      case "error":
        return "处理失败";
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">合同修订</h2>
        <p className="text-sm text-muted-foreground mt-1">
          上传PDF合同，输入修改指令，AI将自动定位并修改指定条款
        </p>
      </div>

      {/* Upload & Instructions */}
      <Card className="p-6 space-y-4">
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">
            上传合同文件
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileSelect}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent transition-colors"
          >
            {selectedFile ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="w-5 h-5 text-accent" />
                <span className="text-sm text-foreground">
                  {selectedFile.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  点击或拖拽上传PDF合同文件
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            修改指令
          </label>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={`请描述需要修改的内容，例如：\n\n1. 将第三条第2款中的"甲方"改为"委托方"\n2. 将违约金比例从5%修改为3%\n3. 在第五条增加一款：..."双方应在合同签署后10个工作日内完成备案"...`}
            rows={6}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!selectedFile || !instructions.trim() || processing}
          className="w-full"
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
              提交中...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-1" />
              提交修改
            </>
          )}
        </Button>
      </Card>

      {/* Revision History */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">修订记录</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            暂无修订记录
          </p>
        ) : (
          <div className="space-y-2">
            {revisions.map((rev) => (
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
                    <p className="text-[10px] text-muted-foreground/60">
                      {new Date(rev.created_at).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {rev.ai_status === "completed" && rev.revised_file_path && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(rev)}
                      >
                        <Download className="w-3.5 h-3.5 mr-1" />
                        下载
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContractRevision;
