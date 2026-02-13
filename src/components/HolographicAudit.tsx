import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, AlertTriangle, XCircle, Loader2,
  Shield, Eye, GitBranch, BookOpen, Trash2, Sparkles, Info,
} from "lucide-react";

interface Proposal {
  id: string;
  project_name: string;
  ai_status: string;
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
  created_at: string;
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

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState("");
  const [reports, setReports] = useState<AuditReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<AuditReport | null>(null);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const fetchProposals = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("bid_proposals")
      .select("id, project_name, ai_status, created_at")
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

  const handleRun = async () => {
    if (!selectedProposalId) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("holographic-audit", {
        body: { proposalId: selectedProposalId },
      });
      if (error) throw error;
      toast({ title: "全息审查完成" });
      await fetchReports();
      // Auto-select new report
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
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("audit_reports").delete().eq("id", id);
    if (selectedReport?.id === id) setSelectedReport(null);
    fetchReports();
  };

  const findings = selectedReport?.findings || [];
  const filtered = filter === "all" ? findings : findings.filter((f) => f.category === filter);

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;

  const scoreColor = (s: number | null) => {
    if (!s) return "text-muted-foreground";
    if (s >= 90) return "text-green-500";
    if (s >= 70) return "text-yellow-500";
    if (s >= 50) return "text-orange-500";
    return "text-destructive";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">全息检查与逻辑自证</h2>
          <p className="text-sm text-muted-foreground mt-1">模拟评委视角，逐条响应性检查、逻辑一致性校验、语义连贯性审查</p>
        </div>
      </div>

      {/* Run audit */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={selectedProposalId} onValueChange={setSelectedProposalId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="选择已完成的投标方案" />
              </SelectTrigger>
              <SelectContent>
                {proposals.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.project_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleRun} disabled={!selectedProposalId || running}>
              {running ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" />审查中...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-1" />开始全息审查</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: report list */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">审查报告列表</CardTitle></CardHeader>
            <CardContent className="p-2">
              <ScrollArea className="max-h-[500px]">
                {reports.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无报告</p>
                ) : (
                  <div className="space-y-1">
                    {reports.map((r) => {
                      const proposal = proposals.find((p) => p.id === r.proposal_id);
                      return (
                        <button
                          key={r.id}
                          onClick={() => setSelectedReport(r)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors group ${
                            selectedReport?.id === r.id
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-secondary text-foreground"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium truncate flex-1">
                              {proposal?.project_name || "未知方案"}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            {r.score != null && (
                              <Badge variant={r.score >= 70 ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                                {r.score}分
                              </Badge>
                            )}
                            <Badge variant={r.ai_status === "completed" ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0">
                              {r.ai_status === "completed" ? "已完成" : r.ai_status === "processing" ? "处理中" : "失败"}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right: report details */}
        <div className="lg:col-span-3">
          {!selectedReport ? (
            <Card className="flex items-center justify-center py-20">
              <div className="text-center text-muted-foreground">
                <Shield className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">选择投标方案开始全息审查</p>
              </div>
            </Card>
          ) : selectedReport.ai_status === "processing" ? (
            <Card className="flex items-center justify-center py-20">
              <div className="text-center">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-accent" />
                <p className="text-sm text-muted-foreground">正在执行全息审查...</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Score card */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">质量评分</p>
                    <p className={`text-3xl font-bold ${scoreColor(selectedReport.score)}`}>
                      {selectedReport.score ?? "-"}
                    </p>
                    <Progress
                      value={selectedReport.score ?? 0}
                      className="mt-2 h-1.5"
                    />
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
              <ScrollArea className="max-h-[600px]">
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
              </ScrollArea>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
