import { useExtractionTask } from "@/contexts/ExtractionTaskContext";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Pause, Play, X, Check, FileText, Loader2 } from "lucide-react";

interface Props {
  onNavigateToMaterials?: () => void;
}

export default function ExtractionProgressFloat({ onNavigateToMaterials }: Props) {
  const { activeTask, pauseTask, resumeTask, cancelTask, clearTask } = useExtractionTask();

  if (!activeTask || activeTask.status === "done" || activeTask.status === "cancelled" || activeTask.status === "error") {
    // Show brief completion toast for 3s, then hide
    if (activeTask && activeTask.status === "done") {
      return (
        <div className="fixed bottom-4 right-4 z-50 bg-card border border-border rounded-lg shadow-lg p-3 w-72 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2 text-sm">
            <Check className="w-4 h-4 text-primary shrink-0" />
            <span className="font-medium truncate">「{activeTask.projectName}」提取完成</span>
            <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto shrink-0" onClick={clearTask}>
              <X className="w-3 h-3" />
            </Button>
          </div>
          {onNavigateToMaterials && (
            <Button variant="link" size="sm" className="text-xs p-0 h-auto mt-1" onClick={() => { clearTask(); onNavigateToMaterials(); }}>
              查看材料库
            </Button>
          )}
        </div>
      );
    }
    return null;
  }

  const pct = activeTask.total > 0 ? (activeTask.current / activeTask.total) * 100 : 0;
  const isRunning = activeTask.status === "running";
  const isPaused = activeTask.status === "paused";

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-card border border-border rounded-lg shadow-lg p-3 w-80 animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4 text-accent shrink-0" />
        <span className="text-sm font-medium truncate flex-1">
          {activeTask.projectName}
        </span>
        {isPaused && <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">已暂停</span>}
      </div>
      <Progress value={pct} className="h-2 mb-2" />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {activeTask.phase === "saving"
            ? `${activeTask.current}/${activeTask.total} 章节`
            : "导入简历中..."}
        </span>
        <div className="flex gap-1">
          {isRunning && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={pauseTask} title="暂停">
              <Pause className="w-3.5 h-3.5" />
            </Button>
          )}
          {isPaused && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resumeTask} title="继续">
              <Play className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={cancelTask} title="取消">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {onNavigateToMaterials && (
        <Button variant="link" size="sm" className="text-xs p-0 h-auto mt-1" onClick={onNavigateToMaterials}>
          查看详情
        </Button>
      )}
    </div>
  );
}
