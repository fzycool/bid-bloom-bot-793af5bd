import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, AlertTriangle, XCircle, Loader2,
  Shield, Eye, GitBranch, BookOpen, Trash2, Sparkles, Info,
  Upload, FileText, ChevronDown, ChevronUp, Users, ListChecks, Target, AlertOctagon,
  ArrowLeft,
} from "lucide-react";

interface Proposal {
  id: string;
  project_name: string;
  ai_status: string;
  proposal_doc_status: string;
  bid_analysis_id: string | null;
  created_at: string;
}

interface Finding {
  category: "response" | "logic" | "semantic";
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  location: string;
  suggestion: string;
}

interface AuditReport {
  id: string;
  proposal_id: string;
  ai_status: string;
  audit_type: string;
  findings: Finding[];
  summary: string | null;
  score: number | null;
  file_path: string | null;
  created_at: string;
}

interface BidAnalysisPreview {
  disqualification_items: any[];
  trap_items: any[];
  personnel_requirements: any[];
  scoring_table: any[];
}

const categoryConfig = {
  response: { label: "响应性", icon: Eye, color: "text-blue-500" },
  logic: { label: "逻辑一致性", icon: GitBranch, color: "text-purple-500" },
  semantic: { label: "语义连贯性", icon: BookOpen, color: "text-orange-500" },
};

const severityConfig = {
  error: { label: "错误", icon: XCircle, color: "text-destructive", bg: "bg-destructive/5 border-destructive/20" },
  warning: { label: "警告", icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-500/5 border-yellow-500/20" },
  info: { label: "建议", icon: Info, color: "text-blue-400", bg: "bg-blue-400/5 border-blue-400/20" },
};

export default function HolographicAudit() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState("");
  const [reports, setReports] = useState<AuditReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<AuditReport | null>(null);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [bidPreview, setBidPreview] = useState<BidAnalysisPreview | null>(null);
  const [showBidPreview, setShowBidPreview] = useState(true);
  const [sectionCount, setSectionCount] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);

  const defaultPrompt = `请按以下维度进行逐项检查：

## 1. 响应性检查
逐条对照招标文件的评分标准和废标条件，检查终版标书中是否有实质性应答。
- 不仅检查星号项，还要检查每一个评分细则
- 标注漏项风险和应答不充分的章节

## 2. 逻辑一致性校验
- 人员逻辑：方案中提到的人数与实际人员清单/简历数量是否一致
- 证书逻辑：简历中声称的证书与实际附件证明材料是否匹配
- 报价逻辑：如有报价信息，检查分项累加是否一致
- 数据一致性：各章节引用的数据、数字是否前后一致

## 3. 语义连贯性审查
- 检查各章节之间的过渡是否自然
- 检测是否存在"硬拼接"（前后章节主题突然跳变、行业术语不一致）
- 检查是否存在上下文语义漂移（如前文讲智慧校园后文却提智慧医疗）
- 检查是否有明显的复制粘贴痕迹（如项目名称不一致）`;

  const [customPrompt, setCustomPrompt] = useState(defaultPrompt);

  const fetchProposals = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("bid_proposals")
      .select("id, project_name, ai_status, proposal_doc_status, bid_analysis_id, created_at")
      .eq("user_id", user.id)
      .eq("ai_status", "completed")
      .order("created_at", { ascending: false });
    setProposals((data as any[]) || []);
  }, [user]);

  const fetchReports = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("audit_reports")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setReports((data as any[]) || []);
  }, [user]);

  useEffect(() => {
    fetchProposals();
    fetchReports();
  }, [fetchProposals, fetchReports]);

  useEffect(() => {
    if (!selectedProposalId) {
      setBidPreview(null);
      setSectionCount(0);
      return;
    }
    const proposal = proposals.find(p => p.id === selectedProposalId);

    supabase
      .from("proposal_sections")
      .select("id", { count: "exact", head: true })
      .eq("proposal_id", selectedProposalId)
      .then(({ count }) => setSectionCount(count || 0));

    if (proposal?.bid_analysis_id) {
      supabase
        .from("bid_analyses")
        .select("disqualification_items, trap_items, personnel_requirements, scoring_table")
        .eq("id", proposal.bid_analysis_id)
        .single()
        .then(({ data }) => {
          if (data) {
            setBidPreview({
              disqualification_items: (data.disqualification_items as any[]) || [],
              trap_items: (data.trap_items as any[]) || [],
              personnel_requirements: (data.personnel_requirements as any[]) || [],
              scoring_table: (data.scoring_table as any[]) || [],
            });
          } else {
            setBidPreview(null);
          }
        });
    } else {
      setBidPreview(null);
    }
  }, [selectedProposalId, proposals]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(file.type)) {
      toast({ title: "仅支持 PDF、DOC、DOCX 格式", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "文件大小不能超过20MB", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
  };

  const handleRun = async () => {
    if (!selectedProposalId) return;
    if (!selectedFile && sectionCount === 0) {
      toast({ title: "该方案尚无生成的标书内容，请上传标书文件", variant: "destructive" });
      return;
    }

    setRunning(true);
    setUploading(true);
    try {
      let storagePath: string | null = null;
      let fileType: string | null = null;

      if (selectedFile) {
        const timestamp = Date.now();
        const safeName = `${timestamp}_${selectedFile.name.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, "_")}`;
        storagePath = `${user!.id}/audit/${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from("knowledge-base")
          .upload(storagePath, selectedFile);
        if (uploadErr) throw new Error(`文件上传失败: ${uploadErr.message}`);
        fileType = selectedFile.type;
      }

      setUploading(false);

      const { data, error } = await supabase.functions.invoke("holographic-audit", {
        body: {
          proposalId: selectedProposalId,
          ...(storagePath ? { filePath: storagePath, fileType } : { useGeneratedContent: true }),
          customPrompt: customPrompt !== defaultPrompt ? customPrompt : undefined,
        },
      });
      if (error) throw error;
      toast({ title: "全息审查完成" });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchReports();
      if (data?.reportId) {
        const { data: fresh } = await supabase
          .from("audit_reports")
          .select("*")
          .eq("id", data.reportId)
          .single();
        if (fresh) setSelectedReport(fresh as any);
      }
    } catch (e: any) {
      toast({ title: "审查失败", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from("audit_reports").delete().eq("id", id);
    if (selectedReport?.id === id) setSelectedReport(null);
    fetchReports();
  };

  const selectedProposal = proposals.find(p => p.id === selectedProposalId);
  const hasGeneratedDoc = selectedProposal?.proposal_doc_status === "completed" || sectionCount > 0;

  // Detail view
  if (selectedReport) {
    const findings = selectedReport.findings || [];
    const filtered = filter === "all" ? findings : findings.filter((f) => f.category === filter);
    const errorCount = findings.filter((f) => f.severity === "error").length;
    const warningCount = findings.filter((f) => f.severity === "warning").length;
    const infoCount = findings.filter((f) => f.severity === "info").length;
    const reportProposal = proposals.find(p => p.id === selectedReport.proposal_id);

    const scoreColor = (s: number | null) => {
      if (!s) return "text-muted-foreground";
      if (s >= 90) return "text-green-500";
      if (s >= 70) return "text-yellow-500";
      if (s >= 50) return "text-orange-500";
      return "text-destructive";
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedReport(null); setFilter("all"); }}>
            <ArrowLeft className="w-4 h-4 mr-1" />返回列表
          </Button>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-foreground truncate">
              {reportProposal?.project_name || "审查报告"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {new Date(selectedReport.created_at).toLocaleString()}
            </p>
          </div>
        </div>

        {selectedReport.ai_status === "processing" ? (
          <Card className="flex items-center justify-center py-20">
            <div className="text-center">
              <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-accent" />
              <p className="text-sm text-muted-foreground">正在执行全息审查...</p>
            </div>
          </Card>
        ) : (
          <>
            {/* Score cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">质量评分</p>
                  <p className={`text-3xl font-bold ${scoreColor(selectedReport.score)}`}>
                    {selectedReport.score ?? "-"}
                  </p>
                  <Progress value={selectedReport.score ?? 0} className="mt-2 h-1.5" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">错误</p>
                  <p className="text-2xl font-bold text-destructive">{errorCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">警告</p>
                  <p className="text-2xl font-bold text-yellow-500">{warningCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">建议</p>
                  <p className="text-2xl font-bold text-blue-400">{infoCount}</p>
                </CardContent>
              </Card>
            </div>

            {/* Summary */}
            {selectedReport.summary && (
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-foreground mb-1">📋 审查总结</p>
                  <p className="text-sm text-muted-foreground">{selectedReport.summary}</p>
                </CardContent>
              </Card>
            )}

            {/* Filter */}
            <div className="flex gap-2 flex-wrap">
              {[
                { key: "all", label: "全部", count: findings.length },
                { key: "response", label: "响应性", count: findings.filter((f) => f.category === "response").length },
                { key: "logic", label: "逻辑一致性", count: findings.filter((f) => f.category === "logic").length },
                { key: "semantic", label: "语义连贯性", count: findings.filter((f) => f.category === "semantic").length },
              ].map((item) => (
                <Button
                  key={item.key}
                  variant={filter === item.key ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                  <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">{item.count}</Badge>
                </Button>
              ))}
            </div>

            {/* Findings list */}
            <div>
              <div className="space-y-3">
                {filtered.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-60" />
                      <p className="text-sm text-muted-foreground">该类别未发现问题</p>
                    </CardContent>
                  </Card>
                ) : (
                  filtered.map((f, i) => {
                    const sev = severityConfig[f.severity] || severityConfig.info;
                    const cat = categoryConfig[f.category] || categoryConfig.response;
                    const SevIcon = sev.icon;
                    const CatIcon = cat.icon;

                    return (
                      <Card key={i} className={`border ${sev.bg}`}>
                        <CardContent className="pt-4">
                          <div className="flex items-start gap-3">
                            <SevIcon className={`w-5 h-5 mt-0.5 shrink-0 ${sev.color}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-foreground">{f.title}</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                                  <CatIcon className="w-3 h-3" />
                                  {cat.label}
                                </Badge>
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${sev.color}`}>
                                  {sev.label}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">{f.description}</p>
                              {f.location && (
                                <p className="text-xs text-muted-foreground mt-1">📍 位置：{f.location}</p>
                              )}
                              {f.suggestion && (
                                <div className="mt-2 p-2 rounded bg-secondary/50">
                                  <p className="text-xs text-foreground">💡 建议：{f.suggestion}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // List view (default)
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">全息检查与逻辑自证</h2>
          <p className="text-sm text-muted-foreground mt-1">选择已生成的标书或上传手工标书，模拟评委视角逐条审查</p>
        </div>
      </div>

      {/* Run audit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">发起审查</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">① 选择投标方案</p>
            <Select value={selectedProposalId} onValueChange={setSelectedProposalId}>
              <SelectTrigger>
                <SelectValue placeholder="选择关联的投标方案" />
              </SelectTrigger>
              <SelectContent>
                {proposals.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      <span>{p.project_name}</span>
                      {p.proposal_doc_status === "completed" && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">已生成标书</Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProposalId && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                <FileText className="w-4 h-4 text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  {hasGeneratedDoc ? (
                    <p className="text-sm text-foreground">✅ 已加载平台生成的标书（{sectionCount} 个章节）</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">⚠️ 该方案尚未生成标书，请上传手工标书文件</p>
                  )}
                </div>
              </div>

              {bidPreview && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setShowBidPreview(!showBidPreview)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-secondary/30 hover:bg-secondary/50 transition-colors text-sm font-medium text-foreground"
                  >
                    <span>📋 已加载招标解析数据</span>
                    {showBidPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showBidPreview && (
                    <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="flex items-center gap-2 p-2 rounded bg-destructive/5 border border-destructive/20">
                        <AlertOctagon className="w-4 h-4 text-destructive shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">废标红线</p>
                          <p className="text-sm font-bold text-foreground">{bidPreview.disqualification_items.length} 条</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded bg-yellow-500/5 border border-yellow-500/20">
                        <Target className="w-4 h-4 text-yellow-500 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">陷阱项</p>
                          <p className="text-sm font-bold text-foreground">{bidPreview.trap_items.length} 条</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded bg-blue-500/5 border border-blue-500/20">
                        <Users className="w-4 h-4 text-blue-500 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">人员要求</p>
                          <p className="text-sm font-bold text-foreground">{bidPreview.personnel_requirements.length} 条</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded bg-purple-500/5 border border-purple-500/20">
                        <ListChecks className="w-4 h-4 text-purple-500 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">评分标准</p>
                          <p className="text-sm font-bold text-foreground">{bidPreview.scoring_table.length} 条</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  ② 上传手工标书（可选，{hasGeneratedDoc ? "如不上传则使用平台生成的标书" : "当前方案无生成标书，需要上传"}）
                </p>
                <div
                  className="border-2 border-dashed border-border rounded-lg p-3 text-center cursor-pointer hover:border-accent transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="w-4 h-4 text-accent" />
                      <span className="text-sm font-medium text-foreground">{selectedFile.name}</span>
                      <span className="text-xs text-muted-foreground">({(selectedFile.size / 1024 / 1024).toFixed(1)}MB)</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        className="text-muted-foreground hover:text-destructive ml-1"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 py-1">
                      <Upload className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">点击上传手工标书（PDF/DOC/DOCX，最大20MB）</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Custom prompt */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-muted-foreground">③ 审查提示词</p>
                  <div className="flex items-center gap-2">
                    {customPrompt !== defaultPrompt && (
                      <button
                        onClick={() => setCustomPrompt(defaultPrompt)}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        恢复默认
                      </button>
                    )}
                    <button
                      onClick={() => setShowPrompt(!showPrompt)}
                      className="text-[11px] text-accent hover:underline flex items-center gap-0.5"
                    >
                      {showPrompt ? "收起" : "查看/编辑"}
                      {showPrompt ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                {showPrompt && (
                  <Textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    rows={12}
                    className="text-xs font-mono leading-relaxed"
                    placeholder="输入自定义审查提示词..."
                  />
                )}
                {!showPrompt && customPrompt !== defaultPrompt && (
                  <p className="text-[11px] text-accent">已自定义提示词</p>
                )}
              </div>
            </div>
          )}

          <Button
            onClick={handleRun}
            disabled={!selectedProposalId || (!selectedFile && !hasGeneratedDoc) || running}
            className="w-full sm:w-auto"
          >
            {running ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" />{uploading ? "上传中..." : "审查中..."}</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-1" />开始全息审查</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Reports table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">审查报告</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {reports.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">暂无审查报告</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>报告名称</TableHead>
                  <TableHead className="w-[80px] text-center">评分</TableHead>
                  <TableHead className="w-[100px] text-center">问题统计</TableHead>
                  <TableHead className="w-[80px] text-center">状态</TableHead>
                  <TableHead className="w-[100px] text-right">日期</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => {
                  const proposal = proposals.find((p) => p.id === r.proposal_id);
                  const f = r.findings || [];
                  const ec = f.filter((x) => x.severity === "error").length;
                  const wc = f.filter((x) => x.severity === "warning").length;
                  const ic = f.filter((x) => x.severity === "info").length;
                  const sc = r.score;

                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-secondary/50"
                      onClick={() => setSelectedReport(r)}
                    >
                      <TableCell className="font-medium">
                        <span className="line-clamp-1">{proposal?.project_name || "未知方案"}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        {sc != null ? (
                          <span className={`font-bold ${sc >= 90 ? "text-green-500" : sc >= 70 ? "text-yellow-500" : sc >= 50 ? "text-orange-500" : "text-destructive"}`}>
                            {sc}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {ec > 0 && <span className="text-[11px] text-destructive font-medium">{ec}错</span>}
                          {wc > 0 && <span className="text-[11px] text-yellow-500 font-medium">{wc}警</span>}
                          {ic > 0 && <span className="text-[11px] text-blue-400 font-medium">{ic}议</span>}
                          {ec === 0 && wc === 0 && ic === 0 && <span className="text-[11px] text-muted-foreground">-</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={r.ai_status === "completed" ? "secondary" : r.ai_status === "processing" ? "outline" : "destructive"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {r.ai_status === "completed" ? "已完成" : r.ai_status === "processing" ? "处理中" : "失败"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={(e) => handleDelete(r.id, e)}
                          className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
