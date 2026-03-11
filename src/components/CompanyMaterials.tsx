import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useExtractionTask } from "@/contexts/ExtractionTaskContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Building2,
  Loader2,
  FolderOpen,
  Image as ImageIcon,
  Briefcase,
  Trash2,
  FileText,
  Wrench,
  Users,
  ChevronDown,
  ChevronRight,
  List,
  Pause,
  Play,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import MaterialGrid from "./company-materials/MaterialGrid";
import MaterialExtractor from "./MaterialExtractor";

interface ProjectGroup {
  id: string | null; // null = 通用材料
  name: string;
  materialCount: number;
  category?: string | null;
  documentStructure?: any[] | null;
}

export default function CompanyMaterials() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { activeTask, pauseTask, resumeTask, cancelTask, clearTask } = useExtractionTask();
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<ProjectGroup | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [extractorOpen, setExtractorOpen] = useState(false);
  const [expandedToc, setExpandedToc] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    if (!user) return;

    // Fetch all materials with their bid_analysis_id
    const { data: materials, error: matError } = await supabase
      .from("company_materials")
      .select("id, bid_analysis_id");

    if (matError) {
      console.error("fetch materials error:", matError);
      setLoading(false);
      return;
    }

    // Group by bid_analysis_id
    const countMap = new Map<string | null, number>();
    for (const m of materials || []) {
      const key = (m as any).bid_analysis_id || null;
      countMap.set(key, (countMap.get(key) || 0) + 1);
    }

    // Fetch project names for non-null analysis ids
    const analysisIds = Array.from(countMap.keys()).filter((k): k is string => k !== null);
    let analysisMap = new Map<string, string>();

    if (analysisIds.length > 0) {
      const { data: analyses } = await supabase
        .from("bid_analyses")
        .select("id, project_name")
        .in("id", analysisIds);
      for (const a of analyses || []) {
        analysisMap.set(a.id, a.project_name || "未命名项目");
      }
    }

    // Also fetch all user's bid_analyses to show empty projects too
    const { data: allAnalyses } = await supabase
      .from("bid_analyses")
      .select("id, project_name, project_category, document_structure")
      .order("created_at", { ascending: false });

    const groups: ProjectGroup[] = [];

    // Add 通用材料 first
    const generalCount = countMap.get(null) || 0;
    groups.push({ id: null, name: "通用材料", materialCount: generalCount });

    // Add all analysis projects
    const addedIds = new Set<string>();
    for (const a of allAnalyses || []) {
      addedIds.add(a.id);
      groups.push({
        id: a.id,
        name: (a as any).project_name || "未命名项目",
        materialCount: countMap.get(a.id) || 0,
        category: (a as any).project_category || null,
        documentStructure: (a as any).document_structure || null,
      });
    }

    setProjects(groups);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleDeleteProject = async (project: ProjectGroup) => {
    if (!project.id) return;
    setDeletingId(project.id);
    try {
      // Delete materials' storage files first
      const { data: mats } = await supabase
        .from("company_materials")
        .select("file_path")
        .eq("bid_analysis_id", project.id);
      if (mats && mats.length > 0) {
        await supabase.storage.from("company-materials").remove(mats.map(m => m.file_path));
        await supabase.from("company_materials").delete().eq("bid_analysis_id", project.id);
      }
      // Delete the bid_analysis record (project card)
      await supabase.from("bid_analyses").delete().eq("id", project.id);
      toast({ title: `已删除项目「${project.name}」及其所有材料` });
      fetchProjects();
    } catch (err: any) {
      toast({ title: "删除失败", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  // If a project is selected, show its materials
  if (selectedProject) {
    return (
      <MaterialGrid
        projectId={selectedProject.id}
        projectName={selectedProject.name}
        onBack={() => {
          setSelectedProject(null);
          fetchProjects(); // refresh counts
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-6 h-6 text-accent" />
            公司材料库
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            按招标项目分类管理公司资质证书、营业执照等材料
          </p>
        </div>
        <Button variant="outline" onClick={() => setExtractorOpen(true)} className="gap-2">
          <FileText className="w-4 h-4" />
          材料提取
        </Button>
      </div>

      {/* Active extraction progress */}
      {activeTask && (activeTask.status === "running" || activeTask.status === "paused") && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-4 h-4 text-accent shrink-0" />
              <span className="text-sm font-medium flex-1 truncate">
                正在提取：{activeTask.projectName}
                {activeTask.status === "paused" && (
                  <span className="text-yellow-600 dark:text-yellow-400 ml-2">（已暂停）</span>
                )}
              </span>
              <div className="flex gap-1 shrink-0">
                {activeTask.status === "running" && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={pauseTask} title="暂停">
                    <Pause className="w-3.5 h-3.5" />
                  </Button>
                )}
                {activeTask.status === "paused" && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resumeTask} title="继续">
                    <Play className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={cancelTask} title="取消">
                  <XIcon className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <Progress value={activeTask.total > 0 ? (activeTask.current / activeTask.total) * 100 : 0} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1.5">
              {activeTask.phase === "saving"
                ? `${activeTask.current} / ${activeTask.total} 个章节已保存`
                : "AI 正在提取简历信息并导入简历工厂"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Project List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => {
            const isGeneral = project.id === null;
            return (
              <Card
                key={project.id || "general"}
                className="cursor-pointer hover:shadow-card-hover transition-all hover:border-accent/50 group"
                onClick={() => setSelectedProject(project)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      isGeneral
                        ? "bg-secondary text-muted-foreground group-hover:bg-accent/10 group-hover:text-accent"
                        : "bg-accent/10 text-accent"
                    }`}>
                      {isGeneral ? (
                        <FolderOpen className="w-6 h-6" />
                      ) : (
                        <Briefcase className="w-6 h-6" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate group-hover:text-accent transition-colors">
                        {project.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          <ImageIcon className="w-3 h-3 mr-1" />
                          {project.materialCount} 个材料
                        </Badge>
                        {project.category === "技术交付类" && (
                          <Badge className="text-xs bg-blue-600 text-white hover:bg-blue-700">
                            <Wrench className="w-3 h-3 mr-1" />技术交付类
                          </Badge>
                        )}
                        {project.category === "人力资源类" && (
                          <Badge className="text-xs bg-emerald-600 text-white hover:bg-emerald-700">
                            <Users className="w-3 h-3 mr-1" />人力资源类
                          </Badge>
                        )}
                        {project.documentStructure && Array.isArray(project.documentStructure) && project.documentStructure.length > 0 && (
                          <Badge
                            variant="outline"
                            className="text-xs cursor-pointer hover:bg-muted"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedToc(expandedToc === project.id ? null : project.id);
                            }}
                          >
                            <List className="w-3 h-3 mr-1" />
                            目录 ({project.documentStructure.length})
                            {expandedToc === project.id ? <ChevronDown className="w-3 h-3 ml-1" /> : <ChevronRight className="w-3 h-3 ml-1" />}
                          </Badge>
                        )}
                      </div>
                      {/* Inline TOC display */}
                      {expandedToc === project.id && project.documentStructure && (
                        <div className="mt-2 max-h-48 overflow-y-auto border rounded-md bg-muted/30 p-2 text-xs space-y-0.5" onClick={(e) => e.stopPropagation()}>
                          {(project.documentStructure as any[]).map((ch: any, idx: number) => (
                            <div key={idx} style={{ paddingLeft: `${((ch.level || 1) - 1) * 16}px` }} className="text-muted-foreground">
                              <span className="text-foreground/50 mr-1">{ch.section_number}</span>
                              <span className={ch.level === 1 ? "font-medium text-foreground" : ""}>{ch.title}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {!isGeneral && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {deletingId === project.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认删除</AlertDialogTitle>
                            <AlertDialogDescription>
                              将删除「{project.name}」下的所有 {project.materialCount} 个材料，此操作不可恢复。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(e) => { e.stopPropagation(); handleDeleteProject(project); }}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <MaterialExtractor open={extractorOpen} onOpenChange={setExtractorOpen} onComplete={fetchProjects} />
    </div>
  );
}
