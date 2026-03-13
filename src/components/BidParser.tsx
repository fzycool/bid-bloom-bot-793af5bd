import { useState, useEffect, useCallback, useRef } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  FileSearch,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Eye,
  Tag,
  Users,
  BarChart3,
  Trash2,
  Plus,
  Upload,
  FileText,
  GitCompare,
  Pause,
  Play,
  XCircle,
  Download,
} from "lucide-react";

interface StructureSection {
  number?: string;
  title: string;
  page_hint?: string;
  importance: "critical" | "high" | "medium" | "low";
  importance_reason?: string;
  children?: StructureSection[];
}

interface DocumentStructure {
  document_title: string;
  total_pages?: number;
  sections: StructureSection[];
  summary: string;
}

interface BidAnalysis {
  id: string;
  project_name: string | null;
  scoring_table: any[];
  disqualification_items: any[];
  trap_items: any[];
  conflict_items: any[];
  technical_keywords: string[];
  business_keywords: string[];
  responsibility_keywords: string[];
  personnel_requirements: any[];
  summary: string | null;
  risk_score: number | null;
  ai_status: string;
  created_at: string;
  custom_prompt: string | null;
  document_id: string | null;
  file_path: string | null;
  bid_deadline: string | null;
  bid_location: string | null;
  requires_presentation: boolean | null;
  deposit_amount: string | null;
  document_structure: any;
  user_id: string;
  submitter_name?: string;
}

export default function BidParser() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [analyses, setAnalyses] = useState<BidAnalysis[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [content, setContent] = useState("");
  const [customPrompt, setCustomPrompt] = useState(
    "1. 投标截止时间，投标地点，是否讲标，投标保证金金额\n2. 评分标准表（分类、权重、评分细则、佐证材料）\n3. 废标项（★标记、否决投标条款）\n4. 陷阱项（容易忽略的失分条款）\n5. 人员配置要求（角色、数量、资质、证书）\n6. 专业技能/业务技能/职责关键词\n7. 风险评分与总体分析\n8. 检查招标文件中明显有逻辑错误或者冲突的内容"
  );
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [selectedAnalysis, setSelectedAnalysis] = useState<BidAnalysis | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState("");
  const [reAnalyzing, setReAnalyzing] = useState(false);
  const [detailParsing, setDetailParsing] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<{ prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null>(null);
  const [aiProgress, setAiProgress] = useState<string | null>(null);
  const tokenPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Helper: invoke edge function with SSE streaming, reading progress events
  const invokeWithStreaming = async (
    fnName: string,
    body: any,
    onProgress?: (msg: string) => void,
  ): Promise<void> => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const session = (await supabase.auth.getSession()).data.session;
    const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${session?.access_token || supabaseKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(errText || `HTTP ${resp.status}`);
    }
    // Check content type - handle both SSE streams and JSON responses
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      // Read SSE stream
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "progress" && onProgress) {
                onProgress(evt.message);
              } else if (evt.type === "error") {
                if (onProgress) onProgress(evt.message);
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } else {
      // JSON response - background processing, just consume body
      const text = await resp.text();
      if (onProgress) onProgress("后台处理中，请稍候...");
    }
  };

  // Poll token_usage and status from DB during parsing
  const startTokenPolling = useCallback((analysisId: string, onComplete?: (analysis: any) => void) => {
    stopTokenPolling();
    tokenPollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from("bid_analyses")
        .select("*")
        .eq("id", analysisId)
        .single();
      if (data?.token_usage) {
        const tu = data.token_usage as any;
        setTokenUsage({ prompt_tokens: tu.prompt_tokens, completion_tokens: tu.completion_tokens, total_tokens: tu.total_tokens });
      }
      if ((data as any)?.ai_progress) {
        setAiProgress((data as any).ai_progress);
      }
      // Stop polling when parsing is done
      if (data && !["analyzing_structure", "processing"].includes(data.ai_status)) {
        stopTokenPolling();
        if (onComplete) onComplete(data);
      }
    }, 3000);
  }, []);

  const stopTokenPolling = useCallback(() => {
    if (tokenPollRef.current) {
      clearInterval(tokenPollRef.current);
      tokenPollRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopTokenPolling(), [stopTokenPolling]);

  const fetchAnalyses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("bid_analyses")
      .select("*")
      .order("created_at", { ascending: false });
    const rawAnalyses = (data as unknown as BidAnalysis[]) || [];

    // Fetch submitter names from profiles
    const userIds = [...new Set(rawAnalyses.map((a) => a.user_id))];
    const profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, company")
        .in("user_id", userIds);
      for (const p of profiles || []) {
        profileMap[p.user_id] = p.full_name || p.company || "未知用户";
      }
    }

    const analyses = rawAnalyses.map((a) => ({
      ...a,
      submitter_name: profileMap[a.user_id] || "未知用户",
    }));
    
    // Auto-detect timeout: if processing/analyzing_structure for >2 minutes, mark as timeout
    const TIMEOUT_MS = 2 * 60 * 1000;
    const now = Date.now();
    for (const a of analyses) {
      if ((a.ai_status === "processing" || a.ai_status === "analyzing_structure") && 
          now - new Date(a.created_at).getTime() > TIMEOUT_MS &&
          now - new Date((a as any).updated_at || a.created_at).getTime() > TIMEOUT_MS) {
        await supabase.from("bid_analyses").update({ ai_status: "timeout" } as any).eq("id", a.id);
        a.ai_status = "timeout";
      }
    }
    
    setAnalyses(analyses);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAnalyses(); }, [fetchAnalyses]);

  const handleAnalyze = async () => {
    if (inputMode === "text" && !content.trim()) {
      toast({ title: "请粘贴招标文件内容", variant: "destructive" });
      return;
    }
    if (inputMode === "file" && uploadedFiles.length === 0) {
      toast({ title: "请上传招标文件", variant: "destructive" });
      return;
    }
    if (!user) return;

    setAnalyzing(true);

    if (inputMode === "file") {
      let lastAnalysis: any = null;
      for (const file of uploadedFiles) {
        const fileExt = file.name.split('.').pop() || 'bin';
        const safeFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${fileExt}`;
        const storagePath = `${user.id}/${safeFileName}`;
        const { error: uploadErr } = await supabase.storage
          .from("knowledge-base")
          .upload(storagePath, file);
        if (uploadErr) {
          toast({ title: `${file.name} 上传失败`, description: uploadErr.message, variant: "destructive" });
          continue;
        }

        const name = projectName || file.name.replace(/\.(pdf|docx?|xlsx?|txt)$/i, "");
        const { data: analysis, error: insertErr } = await supabase
          .from("bid_analyses")
          .insert({ user_id: user.id, project_name: name, custom_prompt: customPrompt.trim() || null, file_path: storagePath } as any)
          .select()
          .single();

        if (insertErr || !analysis) {
          toast({ title: `${file.name} 创建失败`, description: insertErr?.message, variant: "destructive" });
          continue;
        }

        try {
          setTokenUsage(null);
          // Start polling - will detect when structure analysis completes
          startTokenPolling(analysis.id, (completed) => {
            if (completed.ai_status === "structure_ready") {
              setSelectedAnalysis(completed as unknown as BidAnalysis);
              fetchAnalyses();
            }
          });
          await invokeWithStreaming("parse-bid-structure", {
            analysisId: analysis.id,
            projectName: name,
            filePath: storagePath,
            fileType: file.type || "",
          }, (msg) => setAiProgress(msg));
          lastAnalysis = analysis;
        } catch (err: any) {
          toast({ title: `${file.name} 结构分析失败`, description: err.message, variant: "destructive" });
        }
      }

      toast({ title: "结构分析完成", description: `已分析 ${uploadedFiles.length} 个文件的整体结构，请查看后进行详细解析` });
      setUploadedFiles([]);
      setProjectName("");
      setShowForm(false);
      await fetchAnalyses();

      if (lastAnalysis) {
        const { data: updated } = await supabase
          .from("bid_analyses")
          .select("*")
          .eq("id", lastAnalysis.id)
          .single();
        if (updated) setSelectedAnalysis(updated as unknown as BidAnalysis);
      }
    } else {
      // Text mode
      const { data: analysis, error: insertErr } = await supabase
        .from("bid_analyses")
        .insert({ user_id: user.id, project_name: projectName || "未命名项目", custom_prompt: customPrompt.trim() || null } as any)
        .select()
        .single();

      if (insertErr || !analysis) {
        toast({ title: "创建失败", description: insertErr?.message, variant: "destructive" });
        setAnalyzing(false);
        return;
      }

      try {
        setTokenUsage(null);
        startTokenPolling(analysis.id, (completed) => {
          if (completed.ai_status === "structure_ready") {
            setSelectedAnalysis(completed as unknown as BidAnalysis);
            toast({ title: "结构分析完成", description: "请查看文档结构后进行详细解析" });
            fetchAnalyses();
            setAnalyzing(false);
          } else if (completed.ai_status === "failed") {
            toast({ title: "结构分析失败", variant: "destructive" });
            setAnalyzing(false);
          }
        });
        await invokeWithStreaming("parse-bid-structure", {
          analysisId: analysis.id,
          projectName: projectName || "未命名项目",
          content: content.substring(0, 30000),
        }, (msg) => setAiProgress(msg));
        setContent("");
        setProjectName("");
        setShowForm(false);
        // Don't set analyzing=false here - wait for polling callback
        return;
      } catch (err: any) {
        toast({ title: "结构分析失败", description: err.message, variant: "destructive" });
      }
    }
    setAnalyzing(false);
  };

  // Step 2: Detailed parsing based on structure
  const handleDetailParse = async () => {
    if (!selectedAnalysis || !user) return;
    setDetailParsing(true);

    try {
      const body: any = {
        analysisId: selectedAnalysis.id,
        projectName: selectedAnalysis.project_name || "未命名项目",
        customPrompt: editingPrompt.trim() || undefined,
        documentStructure: selectedAnalysis.document_structure || undefined,
      };

      if (selectedAnalysis.file_path) {
        body.filePath = selectedAnalysis.file_path;
      } else if (selectedAnalysis.document_id) {
        const { data: doc } = await supabase.from("documents").select("file_path, file_type").eq("id", selectedAnalysis.document_id).single();
        if (doc) {
          body.filePath = doc.file_path;
          body.fileType = doc.file_type || "";
        }
      }

      await supabase.from("bid_analyses").update({ ai_status: "processing" } as any).eq("id", selectedAnalysis.id);
      setSelectedAnalysis((prev) => prev ? { ...prev, ai_status: "processing" } : prev);
      
      setAiProgress(null);
      startTokenPolling(selectedAnalysis.id, (completed) => {
        if (completed.ai_status === "completed") {
          setSelectedAnalysis(completed as unknown as BidAnalysis);
          setAiProgress(null);
          toast({ title: "详细解析完成" });
          fetchAnalyses();
        } else if (completed.ai_status === "failed" || completed.ai_status === "structure_ready") {
          // structure_ready here means detail parse failed but structure preserved
          setSelectedAnalysis(completed as unknown as BidAnalysis);
          const progress = (completed as any).ai_progress;
          if (progress && progress.includes("失败")) {
            toast({ title: "详细解析失败", description: progress, variant: "destructive" });
          } else if (completed.ai_status === "failed") {
            toast({ title: "详细解析失败", variant: "destructive" });
          }
          setAiProgress(progress || null);
        }
        setDetailParsing(false);
      });

      await invokeWithStreaming("parse-bid", body, (msg) => setAiProgress(msg));
      // Don't set detailParsing=false here - wait for polling callback
      return;
    } catch (err: any) {
      toast({ title: "详细解析失败", description: err.message, variant: "destructive" });
      // If structure exists, go back to structure_ready instead of failed
      if (selectedAnalysis.document_structure) {
        await supabase.from("bid_analyses").update({ ai_status: "structure_ready", ai_progress: `详细解析失败: ${err.message}` } as any).eq("id", selectedAnalysis.id);
        setSelectedAnalysis((prev) => prev ? { ...prev, ai_status: "structure_ready" } : prev);
        setAiProgress(`详细解析失败: ${err.message}`);
      } else {
        await supabase.from("bid_analyses").update({ ai_status: "failed" } as any).eq("id", selectedAnalysis.id);
        setSelectedAnalysis((prev) => prev ? { ...prev, ai_status: "failed" } : prev);
      }
    }
    setDetailParsing(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("bid_analyses").delete().eq("id", id);
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
    if (selectedAnalysis?.id === id) setSelectedAnalysis(null);
    toast({ title: "已删除" });
  };

  const handleReAnalyze = async () => {
    if (!selectedAnalysis || !user) return;
    setReAnalyzing(true);
    setTokenUsage(null);
    const newPrompt = editingPrompt.trim() || null;

    await supabase.from("bid_analyses").update({ ai_status: "analyzing_structure", custom_prompt: newPrompt, token_usage: null } as any).eq("id", selectedAnalysis.id);
    setSelectedAnalysis((prev) => prev ? { ...prev, ai_status: "analyzing_structure", custom_prompt: newPrompt } : prev);

    try {
      const body: any = {
        analysisId: selectedAnalysis.id,
        projectName: selectedAnalysis.project_name || "未命名项目",
      };

      if (selectedAnalysis.file_path) {
        body.filePath = selectedAnalysis.file_path;
      } else if (selectedAnalysis.document_id) {
        const { data: doc } = await supabase.from("documents").select("file_path, file_type").eq("id", selectedAnalysis.document_id).single();
        if (doc) {
          body.filePath = doc.file_path;
          body.fileType = doc.file_type || "";
        }
      }

      startTokenPolling(selectedAnalysis.id, (completed) => {
        if (completed.ai_status === "structure_ready") {
          setSelectedAnalysis(completed as unknown as BidAnalysis);
          toast({ title: "结构重新分析完成", description: "请查看后进行详细解析" });
          fetchAnalyses();
        } else if (completed.ai_status === "failed") {
          toast({ title: "解析失败", variant: "destructive" });
        }
        setReAnalyzing(false);
      });

      await invokeWithStreaming("parse-bid-structure", body, (msg) => setAiProgress(msg));
      // Don't set reAnalyzing=false here - wait for polling callback
      return;
    } catch (err: any) {
      toast({ title: "解析失败", description: err.message, variant: "destructive" });
      await supabase.from("bid_analyses").update({ ai_status: "failed" } as any).eq("id", selectedAnalysis.id);
    }
    setReAnalyzing(false);
  };

  const severityConfig: Record<string, { color: string; label: string }> = {
    critical: { color: "bg-red-100 text-red-800 border-red-200", label: "必废标" },
    high: { color: "bg-orange-100 text-orange-800 border-orange-200", label: "极高风险" },
    medium: { color: "bg-yellow-100 text-yellow-800 border-yellow-200", label: "较高风险" },
  };

  const riskColor = (score: number) => {
    if (score >= 70) return "text-red-600";
    if (score >= 40) return "text-orange-500";
    return "text-green-600";
  };

  // When selecting an analysis, initialize editing prompt and load saved token usage
  useEffect(() => {
    if (selectedAnalysis) {
      setEditingPrompt(selectedAnalysis.custom_prompt || "1. 投标截止时间，投标地点，是否讲标，投标保证金金额\n2. 评分标准表（分类、权重、评分细则、佐证材料）\n3. 废标项（★标记、否决投标条款）\n4. 陷阱项（容易忽略的失分条款）\n5. 人员配置要求（角色、数量、资质、证书）\n6. 专业技能/业务技能/职责关键词\n7. 风险评分与总体分析\n8. 检查招标文件中明显有逻辑错误或者冲突的内容");
      // Load saved token usage from DB
      const tu = (selectedAnalysis as any).token_usage;
      if (tu) setTokenUsage({ prompt_tokens: tu.prompt_tokens, completion_tokens: tu.completion_tokens, total_tokens: tu.total_tokens });
    }
  }, [selectedAnalysis?.id]);

  const importanceConfig: Record<string, { color: string; label: string }> = {
    critical: { color: "bg-red-100 text-red-800 border-red-200", label: "关键" },
    high: { color: "bg-orange-100 text-orange-800 border-orange-200", label: "重要" },
    medium: { color: "bg-yellow-100 text-yellow-800 border-yellow-200", label: "一般" },
    low: { color: "bg-muted text-muted-foreground border-border", label: "参考" },
  };

  const renderStructureSection = (section: StructureSection, depth: number = 0) => {
    const imp = importanceConfig[section.importance] || importanceConfig.medium;
    return (
      <div key={`${section.number}-${section.title}`} className={`${depth > 0 ? "ml-6 border-l-2 border-border pl-4" : ""}`}>
        <div className="flex items-center gap-2 py-2">
          <span className={`text-xs px-2 py-0.5 rounded-full border ${imp.color}`}>{imp.label}</span>
          {section.number && <span className="text-sm font-mono text-muted-foreground">{section.number}</span>}
          <span className={`text-sm ${section.importance === "critical" ? "font-bold text-foreground" : section.importance === "high" ? "font-semibold text-foreground" : "text-foreground"}`}>
            {section.title}
          </span>
          {section.page_hint && <span className="text-xs text-muted-foreground">({section.page_hint})</span>}
        </div>
        {section.importance_reason && (
          <p className="text-xs text-muted-foreground ml-[72px] -mt-1 mb-1">{section.importance_reason}</p>
        )}
        {section.children?.map((child) => renderStructureSection(child, depth + 1))}
      </div>
    );
  };

  if (selectedAnalysis) {
    const a = selectedAnalysis;
    const structure = a.document_structure as DocumentStructure | null;
    const isStructureReady = a.ai_status === "structure_ready";
    const isCompleted = a.ai_status === "completed";
    const isAnalyzingStructure = a.ai_status === "analyzing_structure";
    const isProcessing = a.ai_status === "processing";
    const isTimeout = a.ai_status === "timeout";
    const isFailed = a.ai_status === "failed";
    const isPaused = a.ai_status === "paused";
    const isPausedStructure = a.ai_status === "paused_structure";
    const isCancelled = a.ai_status === "cancelled";

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => { setSelectedAnalysis(null); setTokenUsage(null); }}
              className="text-sm text-accent hover:underline mb-1"
            >
              ← 返回列表
            </button>
            <h2 className="text-xl font-bold text-foreground">{a.project_name}</h2>
            <p className="text-sm text-muted-foreground">
              解析于 {new Date(a.created_at).toLocaleString("zh-CN")}
            </p>
            {(tokenUsage || isAnalyzingStructure || isProcessing) && (
              <div className="mt-1 inline-flex items-center gap-1.5 text-xs font-mono bg-muted px-2.5 py-1 rounded">
                {(isAnalyzingStructure || isProcessing) && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
                🔢 Token: {(tokenUsage?.total_tokens || 0).toLocaleString()}
                <span className="text-muted-foreground/70">（输入 {(tokenUsage?.prompt_tokens || 0).toLocaleString()} / 输出 {(tokenUsage?.completion_tokens || 0).toLocaleString()}）</span>
              </div>
            )}
            {isCompleted && (
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {a.bid_deadline && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-red-100 text-red-700 font-bold text-sm">
                    📅 投标截止: {new Date(a.bid_deadline).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                {a.bid_location && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-blue-100 text-blue-700 font-bold text-sm">
                    📍 {a.bid_location}
                  </span>
                )}
              </div>
            )}
          </div>
          {isCompleted && a.risk_score !== null && (
            <div className="text-center">
              <div className={`text-3xl font-bold ${riskColor(a.risk_score)}`}>{a.risk_score}</div>
              <div className="text-xs text-muted-foreground">风险评分</div>
            </div>
          )}
        </div>

        {/* Status indicators */}
        {isAnalyzingStructure && (
          <Card className="border-accent/30">
            <CardContent className="flex items-center justify-between p-6">
              <div className="flex items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
                <div>
                  <p className="font-medium text-foreground">正在分析文档整体结构...</p>
                  <p className="text-sm text-muted-foreground">AI正在识别文档章节和目录结构</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={async () => {
                    await supabase.from("bid_analyses").update({ ai_status: "paused_structure" } as any).eq("id", a.id);
                    setSelectedAnalysis((prev) => prev ? { ...prev, ai_status: "paused_structure" } : prev);
                    toast({ title: "已暂停结构分析" });
                  }}
                >
                  <Pause className="w-4 h-4" />
                  暂停解析
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => {
                    supabase.from("bid_analyses").update({ ai_status: "cancelled" } as any).eq("id", a.id);
                    setSelectedAnalysis(null);
                    fetchAnalyses();
                    toast({ title: "已退出解析" });
                  }}
                >
                  <XCircle className="w-4 h-4" />
                  退出解析
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {(isTimeout || isFailed) && (
          <Card className="border-destructive/30">
            <CardContent className="flex items-center justify-between p-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <div>
                  <p className="font-medium text-foreground">{isTimeout ? "解析超时" : "解析失败"}</p>
                  <p className="text-sm text-muted-foreground">{isTimeout ? "AI处理时间过长，请尝试重新解析" : "解析过程中出现错误，请重试"}</p>
                </div>
              </div>
              <Button onClick={handleReAnalyze} disabled={reAnalyzing} className="gap-2">
                {reAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                重新解析
              </Button>
            </CardContent>
          </Card>
        )}

        {isProcessing && (
          <Card className="border-accent/30">
            <CardContent className="flex items-center justify-between p-6">
              <div className="flex items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
                <div>
                  <p className="font-medium text-foreground">正在进行详细解析...</p>
                  <p className="text-sm text-muted-foreground">{aiProgress || "AI正在根据文档结构逐章节详细解读"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={async () => {
                    await supabase.from("bid_analyses").update({ ai_status: "paused" } as any).eq("id", a.id);
                    setSelectedAnalysis((prev) => prev ? { ...prev, ai_status: "paused" } : prev);
                    toast({ title: "已暂停详细解析" });
                  }}
                >
                  <Pause className="w-4 h-4" />
                  暂停解析
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => {
                    supabase.from("bid_analyses").update({ ai_status: "cancelled" } as any).eq("id", a.id);
                    setSelectedAnalysis(null);
                    fetchAnalyses();
                    toast({ title: "已退出解析" });
                  }}
                >
                  <XCircle className="w-4 h-4" />
                  退出解析
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Paused state: show resume button */}
        {isPausedStructure && (
          <Card className="border-amber-300/50 bg-amber-50/30">
            <CardContent className="flex items-center justify-between p-6">
              <div className="flex items-center gap-3">
                <Pause className="w-6 h-6 text-amber-600" />
                <div>
                  <p className="font-medium text-foreground">结构分析已暂停</p>
                  <p className="text-sm text-muted-foreground">当前解析状态已保存，可随时继续</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    supabase.from("bid_analyses").update({ ai_status: "analyzing_structure" } as any).eq("id", a.id);
                    setSelectedAnalysis((prev) => prev ? { ...prev, ai_status: "analyzing_structure" } : prev);
                    handleReAnalyze();
                  }}
                >
                  <Play className="w-4 h-4" />
                  继续解析
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => {
                    supabase.from("bid_analyses").update({ ai_status: "cancelled" } as any).eq("id", a.id);
                    setSelectedAnalysis(null);
                    fetchAnalyses();
                    toast({ title: "已退出解析" });
                  }}
                >
                  <XCircle className="w-4 h-4" />
                  退出解析
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isPaused && (
          <Card className="border-amber-300/50 bg-amber-50/30">
            <CardContent className="flex items-center justify-between p-6">
              <div className="flex items-center gap-3">
                <Pause className="w-6 h-6 text-amber-600" />
                <div>
                  <p className="font-medium text-foreground">详细解析已暂停</p>
                  <p className="text-sm text-muted-foreground">当前解析状态已保存，可随时继续</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setSelectedAnalysis((prev) => prev ? { ...prev, ai_status: "processing" } : prev);
                    handleDetailParse();
                  }}
                >
                  <Play className="w-4 h-4" />
                  继续解析
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => {
                    supabase.from("bid_analyses").update({ ai_status: "cancelled" } as any).eq("id", a.id);
                    setSelectedAnalysis(null);
                    fetchAnalyses();
                    toast({ title: "已退出解析" });
                  }}
                >
                  <XCircle className="w-4 h-4" />
                  退出解析
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isCancelled && (
          <Card className="border-border">
            <CardContent className="flex items-center justify-between p-6">
              <div className="flex items-center gap-3">
                <XCircle className="w-6 h-6 text-muted-foreground" />
                <div>
                  <p className="font-medium text-foreground">解析已取消</p>
                  <p className="text-sm text-muted-foreground">可重新开始解析此文档</p>
                </div>
              </div>
              <Button onClick={handleReAnalyze} disabled={reAnalyzing} className="gap-2">
                {reAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                重新解析
              </Button>
            </CardContent>
          </Card>
        )}

        {structure && (
          <Card className="border-2 border-accent/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                🗂️ 文档整体结构
                {structure.total_pages && <span className="text-xs text-muted-foreground font-normal">（约{structure.total_pages}页）</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {structure.summary && (
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 mb-3">{structure.summary}</p>
              )}
              <div className="space-y-0.5">
                {structure.sections?.map((section) => renderStructureSection(section))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2 trigger: Show detailed parsing button when structure is ready */}
        {isStructureReady && (
          <Card className="border-2 border-accent/50 bg-accent/5">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2 text-accent">
                <FileSearch className="w-5 h-5" />
                <h3 className="font-semibold">结构分析已完成，请开始详细解析</h3>
              </div>
              {aiProgress && aiProgress.includes("失败") && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {aiProgress}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                AI已识别出文档的整体结构，接下来将根据上述结构，结合自定义解析清单，逐章节详细解读每一块的具体内容。
              </p>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  📝 自定义解析清单
                  <span className="text-xs text-muted-foreground font-normal">（可修改后再解析）</span>
                </Label>
                <Textarea
                  value={editingPrompt}
                  onChange={(e) => setEditingPrompt(e.target.value)}
                  className="min-h-[100px] text-sm"
                  disabled={detailParsing}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleDetailParse}
                  disabled={detailParsing}
                  className="gap-2"
                >
                  {detailParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
                  {detailParsing ? "详细解析中..." : "开始详细解析"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReAnalyze}
                  disabled={reAnalyzing || detailParsing}
                  size="sm"
                  className="gap-2"
                >
                  {reAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  重新分析结构
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Completed: Show detailed results */}
        {isCompleted && (
          <>
            {a.summary && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-foreground leading-relaxed">{a.summary}</p>
                </CardContent>
              </Card>
            )}

            <Card className="border-2 border-accent/30">
              <CardContent className="p-5">
                <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">📋 招标基本信息</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">投标截止时间</div>
                    <div className={`text-sm font-bold ${a.bid_deadline ? "text-red-600" : "text-muted-foreground"}`}>
                      {a.bid_deadline
                        ? new Date(a.bid_deadline).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                        : "未识别"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">投标地点</div>
                    <div className={`text-sm font-bold ${a.bid_location ? "text-blue-600" : "text-muted-foreground"}`}>
                      {a.bid_location || "未识别"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">是否讲标</div>
                    <div className={`text-sm font-bold ${a.requires_presentation === true ? "text-orange-600" : a.requires_presentation === false ? "text-green-600" : "text-muted-foreground"}`}>
                      {a.requires_presentation === true ? "✅ 需要讲标" : a.requires_presentation === false ? "❌ 无需讲标" : "未识别"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">投标保证金</div>
                    <div className={`text-sm font-bold ${a.deposit_amount ? "text-amber-600" : "text-muted-foreground"}`}>
                      {a.deposit_amount || "未识别"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  📝 解析提示词
                  <span className="text-xs text-muted-foreground font-normal">（修改后可重新解析）</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <Textarea
                  value={editingPrompt}
                  onChange={(e) => setEditingPrompt(e.target.value)}
                  className="min-h-[100px] text-sm"
                  disabled={reAnalyzing}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleReAnalyze}
                    disabled={reAnalyzing}
                    size="sm"
                    className="gap-2"
                  >
                    {reAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
                    {reAnalyzing ? "重新解析中..." : "重新解析"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="disqualification">
              <TabsList className="grid grid-cols-6 w-full">
                <TabsTrigger value="disqualification" className="text-xs gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  废标项
                  {a.disqualification_items?.length > 0 && (
                    <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0 h-4">{a.disqualification_items.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="traps" className="text-xs gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  陷阱项
                </TabsTrigger>
                <TabsTrigger value="conflicts" className="text-xs gap-1">
                  <GitCompare className="w-3.5 h-3.5" />
                  逻辑冲突
                  {a.conflict_items?.length > 0 && (
                    <Badge className="ml-1 text-[10px] px-1 py-0 h-4 bg-purple-100 text-purple-800">{a.conflict_items.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="scoring" className="text-xs gap-1">
                  <BarChart3 className="w-3.5 h-3.5" />
                  评分表
                </TabsTrigger>
                <TabsTrigger value="keywords" className="text-xs gap-1">
                  <Tag className="w-3.5 h-3.5" />
                  关键词
                </TabsTrigger>
                <TabsTrigger value="personnel" className="text-xs gap-1">
                  <Users className="w-3.5 h-3.5" />
                  人员要求
                </TabsTrigger>
              </TabsList>

              {/* Disqualification items */}
              <TabsContent value="disqualification" className="space-y-3 mt-4">
                {(a.disqualification_items as any[])?.length > 0 ? (
                  (a.disqualification_items as any[]).map((item: any, i: number) => {
                    const sev = severityConfig[item.severity] || severityConfig.medium;
                    return (
                      <Card key={i} className="border-l-4" style={{ borderLeftColor: item.severity === "critical" ? "#ef4444" : item.severity === "high" ? "#f97316" : "#eab308" }}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                                <span className="font-medium text-foreground text-sm">{item.item}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full border ${sev.color}`}>{sev.label}</span>
                              </div>
                              {item.source_text && (
                                <p className="text-xs text-muted-foreground mt-1 bg-muted/50 p-2 rounded italic">
                                  「{item.source_text}」
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <p className="text-center text-muted-foreground py-8">未识别到废标项</p>
                )}
              </TabsContent>

              {/* Trap items */}
              <TabsContent value="traps" className="space-y-3 mt-4">
                {(a.trap_items as any[])?.length > 0 ? (
                  (a.trap_items as any[]).map((item: any, i: number) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className={`w-4 h-4 ${item.risk_level === "high" ? "text-red-500" : item.risk_level === "medium" ? "text-orange-500" : "text-yellow-500"}`} />
                          <span className="font-medium text-foreground text-sm">{item.item}</span>
                          <Badge variant="outline" className="text-xs">
                            {item.risk_level === "high" ? "高风险" : item.risk_level === "medium" ? "中风险" : "低风险"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{item.description}</p>
                        {item.suggestion && (
                          <div className="text-xs bg-accent/10 text-accent-foreground p-2 rounded">
                            💡 建议: {item.suggestion}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <p className="text-center text-muted-foreground py-8">未识别到陷阱项</p>
                )}
              </TabsContent>

              {/* Conflict / Logic error items */}
              <TabsContent value="conflicts" className="space-y-3 mt-4">
                {(a.conflict_items as any[])?.length > 0 ? (
                  (a.conflict_items as any[]).map((item: any, i: number) => {
                    const sev = severityConfig[item.severity] || severityConfig.medium;
                    return (
                      <Card key={i} className="border-l-4" style={{ borderLeftColor: item.severity === "critical" ? "#a855f7" : item.severity === "high" ? "#8b5cf6" : "#c084fc" }}>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <GitCompare className="w-4 h-4 text-purple-500 shrink-0" />
                            <span className="font-medium text-foreground text-sm">{item.item}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${sev.color}`}>{sev.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{item.detail}</p>
                          {item.location && (
                            <div className="text-xs text-muted-foreground/70 italic">
                              📍 位置: {item.location}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <p className="text-center text-muted-foreground py-8">未识别到逻辑冲突项</p>
                )}
              </TabsContent>

              {/* Scoring table */}
              <TabsContent value="scoring" className="mt-4">
                {(a.scoring_table as any[])?.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-3 font-medium">分类</th>
                          <th className="text-left p-3 font-medium">评分项</th>
                          <th className="text-left p-3 font-medium w-20">分值</th>
                          <th className="text-left p-3 font-medium">评分细则</th>
                          <th className="text-left p-3 font-medium">佐证材料</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(a.scoring_table as any[]).map((row: any, i: number) => (
                          <tr key={i} className="border-t">
                            <td className="p-3 text-xs">{row.category}</td>
                            <td className="p-3 text-xs font-medium">{row.item}</td>
                            <td className="p-3 text-xs font-bold text-accent">{row.weight}</td>
                            <td className="p-3 text-xs">{row.criteria}</td>
                            <td className="p-3 text-xs text-muted-foreground">{row.evidence_required || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">未识别到评分表</p>
                )}
              </TabsContent>

              {/* Keywords */}
              <TabsContent value="keywords" className="mt-4 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    🔧 专业技能关键词
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {(a.technical_keywords as string[])?.length > 0 ? (
                      (a.technical_keywords as string[]).map((kw: string, i: number) => (
                        <Badge key={i} className="bg-blue-100 text-blue-800 hover:bg-blue-200">{kw}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">无</span>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    💼 业务技能关键词
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {(a.business_keywords as string[])?.length > 0 ? (
                      (a.business_keywords as string[]).map((kw: string, i: number) => (
                        <Badge key={i} className="bg-green-100 text-green-800 hover:bg-green-200">{kw}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">无</span>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    📋 工作职责关键词
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {(a.responsibility_keywords as string[])?.length > 0 ? (
                      (a.responsibility_keywords as string[]).map((kw: string, i: number) => (
                        <Badge key={i} className="bg-purple-100 text-purple-800 hover:bg-purple-200">{kw}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">无</span>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Personnel */}
              <TabsContent value="personnel" className="space-y-3 mt-4">
                {(a.personnel_requirements as any[])?.length > 0 ? (
                  (a.personnel_requirements as any[]).map((p: any, i: number) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Users className="w-4 h-4 text-accent" />
                          <span className="font-medium text-foreground">{p.role}</span>
                          {p.count && <Badge variant="secondary">{p.count}人</Badge>}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {p.qualifications && (
                            <div><span className="text-muted-foreground">学历/资质: </span><span className="text-foreground">{p.qualifications}</span></div>
                          )}
                          {p.experience_years && (
                            <div><span className="text-muted-foreground">经验要求: </span><span className="text-foreground">{p.experience_years}年以上</span></div>
                          )}
                          {p.certifications?.length > 0 && (
                            <div className="sm:col-span-2">
                              <span className="text-muted-foreground">所需证书: </span>
                              {p.certifications.map((c: string, ci: number) => (
                                <Badge key={ci} variant="outline" className="text-xs mr-1 mt-1">{c}</Badge>
                              ))}
                            </div>
                          )}
                          {p.specific_requirements && (
                            <div className="sm:col-span-2"><span className="text-muted-foreground">特殊要求: </span><span className="text-foreground">{p.specific_requirements}</span></div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <p className="text-center text-muted-foreground py-8">未识别到人员要求</p>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileSearch className="w-6 h-6 text-accent" />
            招标文件解析引擎
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            像资深标书专员一样读题，自动提取评分表、废标项、陷阱项和关键词
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportBidParserDesignDoc()} className="gap-2">
            <Download className="w-4 h-4" />
            导出设计文档
          </Button>
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <Plus className="w-4 h-4" />
            新建解析
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label>项目名称（可选）</Label>
              <Input
                placeholder="例如：XX市智慧城市建设项目"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>

            {/* Input mode toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setInputMode("file")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === "file"
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                <Upload className="w-4 h-4" />
                上传文件
              </button>
              <button
                onClick={() => setInputMode("text")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === "text"
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                <FileText className="w-4 h-4" />
                粘贴文本
              </button>
            </div>

            {inputMode === "file" ? (
              <div className="space-y-2">
                <Label>上传招标文件（支持多个）</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xlsx,.xls,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      const fileArray = Array.from(files);
                      const allowedExts = /\.(pdf|docx?|xlsx?|xls)$/i;
                      const validFiles = fileArray.filter((f) => allowedExts.test(f.name));
                      const invalidFiles = fileArray.filter((f) => !allowedExts.test(f.name));
                      if (invalidFiles.length > 0) {
                        toast({
                          title: "不支持的文件格式",
                          description: `${invalidFiles.map((f) => f.name).join("、")} 格式不支持，请上传 PDF、Word 或 Excel 文件`,
                          variant: "destructive",
                        });
                      }
                      if (validFiles.length > 0) {
                        setUploadedFiles((prev) => [...prev, ...validFiles]);
                        if (!projectName && validFiles.length === 1) {
                          setProjectName(validFiles[0].name.replace(/\.(pdf|docx?|xlsx?|txt)$/i, ""));
                        }
                      }
                    }
                    // Reset after a short delay to avoid clearing file references
                    setTimeout(() => {
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }, 100);
                  }}
                />
                <div
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent/50 hover:bg-accent/5 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length === 0) return;
                    const allowedExts = /\.(pdf|docx?|xlsx?|xls)$/i;
                    const validFiles = files.filter((f) => allowedExts.test(f.name));
                    const invalidFiles = files.filter((f) => !allowedExts.test(f.name));
                    if (invalidFiles.length > 0) {
                      toast({
                        title: "不支持的文件格式",
                        description: `${invalidFiles.map((f) => f.name).join("、")} 格式不支持，请上传 PDF、Word 或 Excel 文件`,
                        variant: "destructive",
                      });
                    }
                    if (validFiles.length > 0) {
                      setUploadedFiles((prev) => [...prev, ...validFiles]);
                      if (!projectName && validFiles.length === 1) {
                        setProjectName(validFiles[0].name.replace(/\.(pdf|docx?|xlsx?|txt)$/i, ""));
                      }
                    }
                  }}
                >
                  {uploadedFiles.length > 0 ? (
                    <div className="space-y-2">
                      {uploadedFiles.map((file, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 bg-muted/50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-5 h-5 text-accent shrink-0" />
                            <div className="text-left min-w-0">
                              <p className="font-medium text-foreground text-sm truncate">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {(file.size / (1024 * 1024)).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setUploadedFiles((prev) => prev.filter((_, idx) => idx !== i));
                            }}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground mt-2">点击继续添加更多文件</p>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm font-medium text-foreground">点击上传招标文件</p>
                      <p className="text-xs text-muted-foreground mt-1">支持 PDF、Word、Excel 格式，可选择多个文件，最大 20MB/个</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>招标文件内容</Label>
                <Textarea
                  placeholder="请粘贴招标文件的关键内容（评分标准、资格要求、人员配置等章节）..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[200px]"
                />
                <p className="text-xs text-muted-foreground">
                  建议粘贴评分标准表、投标人资格要求、人员配置要求等核心章节，最大支持30000字
                </p>
              </div>
            )}

            {/* Custom prompt */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                📝 自定义解析清单
                <span className="text-xs text-muted-foreground font-normal">（告诉AI重点关注哪些内容）</span>
              </Label>
              <Textarea
                placeholder="输入你希望AI重点解析的内容清单..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="min-h-[120px] text-sm"
              />
              <p className="text-xs text-muted-foreground">
                可自由编辑，AI会按照此清单重点提取对应信息
              </p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleAnalyze} disabled={analyzing} className="gap-2">
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
                {analyzing ? "AI解析中..." : "开始解析"}
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setContent(""); setProjectName(""); setUploadedFiles([]); }}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      ) : analyses.length === 0 && !showForm ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileSearch className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">暂无解析记录</p>
            <p className="text-sm">点击「新建解析」粘贴招标文件内容开始</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {analyses.map((a) => (
            <Card
              key={a.id}
              className="hover:shadow-card-hover transition-shadow cursor-pointer"
              onClick={async () => {
                if (a.ai_status === "pending" || a.ai_status === "analyzing_structure") return;
                // Always fetch fresh data from DB to avoid stale document_structure
                const { data: fresh } = await supabase
                  .from("bid_analyses")
                  .select("*")
                  .eq("id", a.id)
                  .single();
                if (fresh) {
                  setSelectedAnalysis(fresh as unknown as BidAnalysis);
                } else {
                  setSelectedAnalysis(a);
                }
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground text-sm line-clamp-1">{a.project_name}</span>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium text-xs whitespace-nowrap">
                        👤 {a.submitter_name}
                      </span>
                      <span className="whitespace-nowrap">{new Date(a.created_at).toLocaleString("zh-CN")}</span>
                      {a.bid_deadline && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold text-xs whitespace-nowrap">
                          📅 {new Date(a.bid_deadline).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {a.bid_location && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold text-xs whitespace-nowrap">
                          📍 {a.bid_location}
                        </span>
                      )}
                      {a.ai_status === "completed" && (
                        <>
                          <span className="whitespace-nowrap">废标项: {(a.disqualification_items as any[])?.length || 0}</span>
                          <span className="whitespace-nowrap">陷阱项: {(a.trap_items as any[])?.length || 0}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(a.ai_status === "processing" || a.ai_status === "analyzing_structure") && (
                      <Badge className="bg-blue-100 text-blue-800 gap-1 whitespace-nowrap">
                        <Loader2 className="w-3 h-3 animate-spin" />{a.ai_status === "analyzing_structure" ? "分析结构中" : "详细解析中"}
                      </Badge>
                    )}
                    {a.ai_status === "structure_ready" && (
                      <Badge className="bg-amber-100 text-amber-800 whitespace-nowrap">
                        待详细解析
                      </Badge>
                    )}
                    {a.ai_status === "completed" && a.risk_score !== null && (
                      <Badge className={`whitespace-nowrap ${a.risk_score >= 70 ? "bg-red-100 text-red-800" : a.risk_score >= 40 ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}`}>
                        风险: {a.risk_score}
                      </Badge>
                    )}
                    {a.ai_status === "failed" && (
                      <Badge variant="destructive" className="whitespace-nowrap">解析失败</Badge>
                    )}
                    {a.ai_status === "timeout" && (
                      <Badge className="bg-gray-100 text-gray-800 whitespace-nowrap">⏱ 解析超时</Badge>
                    )}
                    {(a.ai_status === "paused" || a.ai_status === "paused_structure") && (
                      <Badge className="bg-amber-100 text-amber-800 whitespace-nowrap">⏸ 已暂停</Badge>
                    )}
                    {a.ai_status === "cancelled" && (
                      <Badge className="bg-gray-100 text-gray-800 whitespace-nowrap">已取消</Badge>
                    )}
                    {(a.ai_status === "completed" || a.ai_status === "structure_ready" || a.ai_status === "timeout" || a.ai_status === "failed" || a.ai_status === "paused" || a.ai_status === "paused_structure" || a.ai_status === "cancelled") && (
                      <Button variant="ghost" size="sm" className="text-xs gap-1 shrink-0">
                        <Eye className="w-3.5 h-3.5" />
                        {a.ai_status === "structure_ready" ? "查看结构" : a.ai_status === "timeout" ? "重试" : a.ai_status === "failed" ? "重试" : (a.ai_status === "paused" || a.ai_status === "paused_structure") ? "继续" : a.ai_status === "cancelled" ? "查看" : "查看"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
