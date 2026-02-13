import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Shield, LogOut } from "lucide-react";

const Dashboard = () => {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
            <Shield className="w-5 h-5 text-accent-foreground" />
          </div>
          <h1 className="text-lg font-bold text-foreground">润和捷科AI智标工厂</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-1" />
            退出
          </Button>
        </div>
      </header>
      <main className="p-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">工作台</h2>
        <p className="text-muted-foreground">欢迎使用润和捷科AI智标工厂，请选择功能模块开始工作。</p>
      </main>
    </div>
  );
};

export default Dashboard;
