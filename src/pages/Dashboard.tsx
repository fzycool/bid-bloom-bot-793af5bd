import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Shield,
  LogOut,
  BookOpen,
  FileSearch,
  Users,
  ClipboardCheck,
  CheckCircle,
} from "lucide-react";
import KnowledgeBase from "@/components/KnowledgeBase";
import BidParser from "@/components/BidParser";
import ResumeFactory from "@/components/ResumeFactory";

const modules = [
  { id: "knowledge", label: "知识库", icon: BookOpen },
  { id: "parse", label: "招标解析", icon: FileSearch },
  { id: "resume", label: "简历工场", icon: Users },
  { id: "bid", label: "投标助手", icon: ClipboardCheck },
  { id: "audit", label: "全息审查", icon: CheckCircle },
];

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState("knowledge");

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
        <nav className="w-56 border-r border-border bg-card shrink-0 p-3 space-y-1 hidden md:block">
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
        <main className="flex-1 overflow-auto p-6 md:p-8">
          {activeModule === "knowledge" && <KnowledgeBase />}
          {activeModule === "parse" && <BidParser />}
          {activeModule === "resume" && <ResumeFactory />}
          {activeModule === "bid" && (
            <div className="text-muted-foreground text-center py-20">
              <ClipboardCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">智能投标助手</p>
              <p className="text-sm">即将上线</p>
            </div>
          )}
          {activeModule === "audit" && (
            <div className="text-muted-foreground text-center py-20">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">全息检查与逻辑自证</p>
              <p className="text-sm">即将上线</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
