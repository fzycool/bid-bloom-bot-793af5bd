import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  BookOpen,
  FileSearch,
  Users,
  ClipboardCheck,
  CheckCircle,
  UserCog,
  AlertTriangle,
  TrendingUp,
  Clock,
  FileText,
} from "lucide-react";

interface Stats {
  documents: number;
  analyses: number;
  employees: number;
  resumeVersions: number;
  proposals: number;
  audits: number;
  highRiskAnalyses: number;
  avgRiskScore: number | null;
  recentAnalyses: { id: string; project_name: string | null; risk_score: number | null; created_at: string; bid_deadline: string | null; bid_location: string | null }[];
  pendingUsers?: number;
  totalUsers?: number;
}

export default function DashboardOverview() {
  const { user, isAdmin } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchStats = async () => {
      const [docRes, anaRes, empRes, rvRes, propRes, auditRes] = await Promise.all([
        supabase.from("documents").select("id", { count: "exact", head: true }),
        supabase.from("bid_analyses").select("id, project_name, risk_score, created_at, bid_deadline, bid_location").order("created_at", { ascending: false }).limit(100),
        supabase.from("employees").select("id", { count: "exact", head: true }),
        supabase.from("resume_versions").select("id", { count: "exact", head: true }),
        supabase.from("bid_proposals").select("id", { count: "exact", head: true }),
        supabase.from("audit_reports").select("id", { count: "exact", head: true }),
      ]);

      const analyses = anaRes.data || [];
      const riskScores = analyses.filter((a) => a.risk_score !== null).map((a) => a.risk_score as number);
      const highRisk = riskScores.filter((s) => s >= 60).length;
      const avgRisk = riskScores.length > 0 ? Math.round(riskScores.reduce((a, b) => a + b, 0) / riskScores.length) : null;

      const result: Stats = {
        documents: docRes.count || 0,
        analyses: analyses.length,
        employees: empRes.count || 0,
        resumeVersions: rvRes.count || 0,
        proposals: propRes.count || 0,
        audits: auditRes.count || 0,
        highRiskAnalyses: highRisk,
        avgRiskScore: avgRisk,
        recentAnalyses: analyses.slice(0, 5),
      };

      if (isAdmin) {
        const [profilesRes, pendingRes] = await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_approved", false),
        ]);
        result.totalUsers = profilesRes.count || 0;
        result.pendingUsers = pendingRes.count || 0;
      }

      setStats(result);
      setLoading(false);
    };
    fetchStats();
  }, [user, isAdmin]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!stats) return null;

  const riskColor = (score: number | null) => {
    if (score === null) return "text-muted-foreground";
    if (score >= 70) return "text-red-500";
    if (score >= 40) return "text-orange-500";
    return "text-green-500";
  };

  const cards = [
    { label: "知识库文档", value: stats.documents, icon: BookOpen, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "招标解析", value: stats.analyses, icon: FileSearch, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "人员库", value: stats.employees, icon: Users, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "简历版本", value: stats.resumeVersions, icon: FileText, color: "text-violet-500", bg: "bg-violet-500/10" },
    { label: "投标方案", value: stats.proposals, icon: ClipboardCheck, color: "text-cyan-500", bg: "bg-cyan-500/10" },
    { label: "审查报告", value: stats.audits, icon: CheckCircle, color: "text-pink-500", bg: "bg-pink-500/10" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">数据看板</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdmin ? "全平台数据概览" : "个人工作区概览"}
        </p>
      </div>

      {/* Core metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex flex-col items-center text-center gap-2">
              <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center`}>
                <c.icon className={`w-5 h-5 ${c.color}`} />
              </div>
              <span className="text-2xl font-bold text-foreground">{c.value}</span>
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Risk + Admin row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Risk overview */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-foreground">风险概览</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className={`text-2xl font-bold ${riskColor(stats.avgRiskScore)}`}>
                  {stats.avgRiskScore ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">平均风险分</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-500">{stats.highRiskAnalyses}</div>
                <div className="text-xs text-muted-foreground">高风险项目</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Average stats */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold text-foreground">效率指标</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {stats.employees > 0 ? (stats.resumeVersions / stats.employees).toFixed(1) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">人均简历版本</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {stats.proposals > 0 ? (stats.audits / stats.proposals * 100).toFixed(0) + "%" : "—"}
                </div>
                <div className="text-xs text-muted-foreground">方案审查率</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Admin: user stats */}
        {isAdmin && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <UserCog className="w-4 h-4 text-violet-500" />
                <span className="text-sm font-semibold text-foreground">用户管理</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-2xl font-bold text-foreground">{stats.totalUsers}</div>
                  <div className="text-xs text-muted-foreground">总用户数</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-orange-500">{stats.pendingUsers}</div>
                  <div className="text-xs text-muted-foreground">待审批</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent analyses */}
      {stats.recentAnalyses.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">最近招标解析</span>
            </div>
            <div className="space-y-2">
              {stats.recentAnalyses.map((a) => (
                <div key={a.id} className="flex flex-col gap-1 py-3 border-b border-border last:border-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileSearch className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm text-foreground truncate max-w-[200px]">{a.project_name || "未命名"}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {a.risk_score !== null && (
                        <span className={`text-sm font-bold ${riskColor(a.risk_score)}`}>{a.risk_score}分</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-5.5 flex-wrap">
                    {a.bid_deadline && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold text-xs">
                        📅 {new Date(a.bid_deadline).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    {a.bid_location && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold text-xs">
                        📍 {a.bid_location}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
