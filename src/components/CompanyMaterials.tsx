import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Loader2,
  FolderOpen,
  Image as ImageIcon,
  Briefcase,
} from "lucide-react";
import MaterialGrid from "./company-materials/MaterialGrid";

interface ProjectGroup {
  id: string | null; // null = 通用材料
  name: string;
  materialCount: number;
}

export default function CompanyMaterials() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<ProjectGroup | null>(null);

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
      .select("id, project_name")
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
        name: a.project_name || "未命名项目",
        materialCount: countMap.get(a.id) || 0,
      });
    }

    setProjects(groups);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

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
      <div>
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Building2 className="w-6 h-6 text-accent" />
          公司材料库
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          按招标项目分类管理公司资质证书、营业执照等材料
        </p>
      </div>

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
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="secondary" className="text-xs">
                          <ImageIcon className="w-3 h-3 mr-1" />
                          {project.materialCount} 个材料
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
