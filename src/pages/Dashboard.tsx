import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import DashboardOverview from "@/components/DashboardOverview";
import {
  Shield,
  LogOut,
  BookOpen,
  FileSearch,
  Users,
  ClipboardCheck,
  CheckCircle,
  UserCog,
  Clock,
  LayoutDashboard,
  GitCompare,
} from "lucide-react";
import KnowledgeBase from "@/components/KnowledgeBase";
import BidParser from "@/components/BidParser";
import ResumeFactory from "@/components/ResumeFactory";
import BiddingAssistant from "@/components/BiddingAssistant";
import HolographicAudit from "@/components/HolographicAudit";
import BackendManagement from "@/components/BackendManagement";
import BidComparison from "@/components/BidComparison";

const baseModules = [
  { id: "overview", label: "数据看板", icon: LayoutDashboard },
  { id: "parse", label: "招标解析", icon: FileSearch },
  { id: "compare", label: "差异对比", icon: GitCompare },
  { id: "resume", label: "简历工厂", icon: Users },
  { id: "bid", label: "投标助手", icon: ClipboardCheck },
  { id: "audit", label: "全息审查", icon: CheckCircle },
  { id: "knowledge", label: "知识库", icon: BookOpen },
];

const Dashboard = () => {
  const { user, isApproved, isAdmin, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState("overview");

  const modules = [
    ...baseModules,
    ...(isAdmin ? [{ id: "admin", label: "后台管理", icon: UserCog }] : []),
  ];

  // Show pending approval screen for unapproved users
  if (isApproved === false && !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Clock className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold text-foreground">等待管理员审批</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          您的账号已注册成功，请等待管理员审批后方可使用系统。
        </p>
        <Button variant="outline" size="sm" onClick={signOut} className="mt-4">
          <LogOut className="w-4 h-4 mr-1" />
          退出登录
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <Shield className="w-4 h-4 text-accent-foreground" />
          </div>
          <h1 className="text-base font-bold text-foreground">润和捷科AI智标工厂</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground hidden sm:block">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-1" />
            退出
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-56 border-r border-border bg-card shrink-0 p-3 hidden md:flex md:flex-col">
          <div className="space-y-1 flex-1">
            {modules.map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeModule === m.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <m.icon className="w-4 h-4" />
                {m.label}
              </button>
            ))}
          </div>
          <div className="pt-3 border-t border-border mt-3">
            <p className="text-[10px] text-muted-foreground/50 text-center leading-tight">
              本平台由AI代码开发<br />润和AI中心
            </p>
          </div>
        </nav>

        {/* Mobile nav */}
        <div className="md:hidden border-b border-border bg-card px-2 py-2 flex gap-1 overflow-x-auto shrink-0 absolute top-[57px] left-0 right-0 z-10">
          {modules.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveModule(m.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                activeModule === m.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              <m.icon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          ))}
        </div>

        {/* Main content */}
        <main className="flex-1 min-h-0 overflow-auto p-6 md:p-8">
          {activeModule === "overview" && <DashboardOverview />}
          {activeModule === "knowledge" && <KnowledgeBase />}
          {activeModule === "parse" && <BidParser />}
          {activeModule === "compare" && <BidComparison />}
          {activeModule === "resume" && <ResumeFactory />}
          {activeModule === "bid" && <BiddingAssistant />}
          {activeModule === "audit" && <HolographicAudit />}
          {activeModule === "admin" && isAdmin && <BackendManagement />}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
