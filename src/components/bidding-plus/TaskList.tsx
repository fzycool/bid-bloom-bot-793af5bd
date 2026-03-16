import React, { useEffect, useState, useCallback } from "react";
import { Plus, ScrollText, Loader2, Trash2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  task_name: string;
  current_step: number;
  created_at: string;
  updated_at: string;
}

interface TaskListProps {
  onSelectTask: (taskId: string) => void;
}

export default function TaskList({ onSelectTask }: TaskListProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("bidding_plus_tasks")
        .select("id, task_name, current_step, created_at, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      setTasks((data as Task[]) || []);
    } catch (err: any) {
      toast({ title: "获取任务列表失败", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleCreate = async () => {
    if (!user || !newName.trim()) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("bidding_plus_tasks")
        .insert({ user_id: user.id, task_name: newName.trim() })
        .select("id")
        .single();
      if (error) throw error;
      toast({ title: "任务已创建" });
      setNewName("");
      setShowCreate(false);
      // Also create a default "主文档" sheet
      await supabase.from("bidding_plus_sheets").insert({
        task_id: (data as any).id,
        user_id: user.id,
        title: "主文档",
        sort_order: 0,
      });
      onSelectTask((data as any).id);
    } catch (err: any) {
      toast({ title: "创建失败", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("确定删除此任务？所有相关数据将被清除。")) return;
    try {
      const { error } = await supabase.from("bidding_plus_tasks").delete().eq("id", id);
      if (error) throw error;
      setTasks((prev) => prev.filter((t) => t.id !== id));
      toast({ title: "任务已删除" });
    } catch (err: any) {
      toast({ title: "删除失败", description: err.message, variant: "destructive" });
    }
  };

  const stepLabels = ["", "大纲生成", "在线编写"];

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-bold text-foreground">投标助手 Plus</h2>
          <span className="text-xs text-muted-foreground">任务管理</span>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> 新建任务
        </Button>
      </div>

      {showCreate && (
        <Card className="p-4 flex items-center gap-3">
          <Input
            placeholder="输入任务名称（如：XX项目投标书编写）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
            className="flex-1"
          />
          <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "创建"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setNewName(""); }}>
            取消
          </Button>
        </Card>
      )}

      <div className="flex-1 overflow-auto space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ScrollText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>暂无任务，点击「新建任务」开始</p>
          </div>
        ) : (
          tasks.map((task) => (
            <Card
              key={task.id}
              className={cn(
                "p-4 cursor-pointer hover:bg-muted/50 transition-colors group"
              )}
              onClick={() => onSelectTask(task.id)}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-sm truncate">{task.task_name}</h3>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(task.updated_at).toLocaleDateString("zh-CN")}
                    </span>
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-medium",
                      task.current_step === 1 ? "bg-accent/10 text-accent" : "bg-primary/10 text-primary"
                    )}>
                      步骤{task.current_step}：{stepLabels[task.current_step]}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={(e) => handleDelete(e, task.id)}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
