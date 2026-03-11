import React, { createContext, useContext, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ExtractionTask {
  id: string;
  projectName: string;
  status: "running" | "paused" | "cancelled" | "done" | "error";
  current: number;
  total: number;
  phase: "saving" | "importing_resumes";
  errorMessage?: string;
  resumeImportResult?: { created: string[]; merged: string[] };
}

interface ExtractionTaskContextType {
  activeTask: ExtractionTask | null;
  startTask: (params: StartTaskParams) => void;
  pauseTask: () => void;
  resumeTask: () => void;
  cancelTask: () => void;
  clearTask: () => void;
}

interface ChapterForSave {
  section_number: string;
  title: string;
  level: number;
  content: string;
  startChunk: number;
  endChunk: number;
}

interface StartTaskParams {
  userId: string;
  fileName: string;
  projectName: string;
  projectCategory: string;
  chapters: ChapterForSave[];
  selectedIndices: number[];
  buildChapterDocx: (startChunk: number, endChunk: number) => Promise<Blob>;
  allChaptersToc: { section_number: string; title: string; level: number }[];
  onComplete: () => void;
}

const ExtractionTaskContext = createContext<ExtractionTaskContextType | null>(null);

export function useExtractionTask() {
  const ctx = useContext(ExtractionTaskContext);
  if (!ctx) throw new Error("useExtractionTask must be used within ExtractionTaskProvider");
  return ctx;
}

const resumeTitleKeywords = [
  "简历", "人员", "履历", "项目经理", "技术负责人", "项目总监",
  "拟投入", "团队成员", "主要人员", "人员配置", "人员组织",
  "项目团队", "投标人员", "拟派人员", "管理人员", "技术人员",
  "项目组", "人员安排", "岗位人员", "人力资源", "组织机构",
  "项目部", "负责人", "总工", "总监理", "安全员", "质量员",
  "资格审查", "人员表", "人员情况", "人员资质", "业绩人员",
  "项目负责", "技术骨干", "核心人员", "关键人员", "服务人员",
  "团队介绍", "团队配置", "人员名单", "人员信息", "人员资料",
  "拟任", "拟配", "拟安排", "专业人员", "管理团队",
];
const resumeContentPatterns = [
  /姓\s*名[\s:：]/, /性\s*别[\s:：].{0,4}[男女]/, /出生.{0,6}\d{4}/,
  /学\s*历[\s:：]/, /毕业院校|毕业学校/, /工作经[历验]/,
  /项目经[历验]/, /职\s*称[\s:：]/, /身份证/, /执业资格|资格证书|注册.*师/,
  /年\s*龄[\s:：]/, /民\s*族[\s:：]/, /籍\s*贯[\s:：]/, /联系[电话方式]/,
  /技术职称|专业职称/, /从事.*工作.*年/, /参[加与]工作/, /工作单位/,
  /担任.*[职务岗位角色]/, /负责.*[项目工程]/, /主持.*[项目工程]/,
  /[本硕博]科|学士|硕士|博士|研究生/, /毕\s*业/, /专\s*业[\s:：]/,
];

export function ExtractionTaskProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [activeTask, setActiveTask] = useState<ExtractionTask | null>(null);
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const taskRunningRef = useRef(false);

  const updateTask = (patch: Partial<ExtractionTask>) => {
    setActiveTask(prev => prev ? { ...prev, ...patch } : null);
  };

  const uploadWithRetry = async (path: string, data: Blob, maxRetries = 3) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { error } = await supabase.storage
        .from("company-materials")
        .upload(path, data, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      if (!error) return;
      if (attempt < maxRetries - 1 && error.message?.includes("Failed to fetch")) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  };

  const waitWhilePaused = async () => {
    while (pausedRef.current && !cancelledRef.current) {
      await new Promise(r => setTimeout(r, 300));
    }
  };

  const startTask = useCallback((params: StartTaskParams) => {
    if (taskRunningRef.current) return;
    taskRunningRef.current = true;
    pausedRef.current = false;
    cancelledRef.current = false;

    const {
      userId, fileName, projectName, projectCategory,
      chapters, selectedIndices, buildChapterDocx, allChaptersToc, onComplete,
    } = params;

    const sel = chapters.filter((_, i) => selectedIndices.includes(i));
    const taskId = crypto.randomUUID();

    const task: ExtractionTask = {
      id: taskId,
      projectName,
      status: "running",
      current: 0,
      total: sel.length,
      phase: "saving",
    };
    setActiveTask(task);

    // Run async
    (async () => {
      try {
        const prefix = projectName ? `${projectName}_` : "";

        const { data: analysis, error: analysisErr } = await supabase
          .from("bid_analyses")
          .insert({
            user_id: userId,
            project_name: projectName || fileName.replace(/\.docx$/i, ""),
            ai_status: "completed",
            project_category: projectCategory || null,
            document_structure: allChaptersToc,
            summary: `从「${fileName}」提取，共${allChaptersToc.length}个章节`,
          } as any)
          .select("id")
          .single();

        if (analysisErr || !analysis) throw new Error(analysisErr?.message || "创建项目失败");
        const analysisId = (analysis as any).id;

        for (let i = 0; i < sel.length; i++) {
          if (cancelledRef.current) {
            updateTask({ status: "cancelled" });
            taskRunningRef.current = false;
            return;
          }
          await waitWhilePaused();
          if (cancelledRef.current) {
            updateTask({ status: "cancelled" });
            taskRunningRef.current = false;
            return;
          }

          const ch = sel[i];
          updateTask({ current: i + 1, phase: "saving" });

          try {
            const blob = await buildChapterDocx(ch.startChunk, ch.endChunk);
            const storagePath = `${userId}/${Date.now()}_ch${i}.docx`;
            await uploadWithRetry(storagePath, blob);

            await supabase.from("company_materials").insert({
              user_id: userId,
              file_name: `${prefix}${ch.section_number} ${ch.title}.docx`,
              file_path: storagePath,
              file_size: blob.size,
              file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ai_status: "completed",
              content_description: `从「${fileName}」提取的章节内容`,
              material_type: "标书章节",
              bid_analysis_id: analysisId,
            });
          } catch (err: any) {
            console.error(`Save chapter ${ch.section_number} error:`, err);
          }
          if (i < sel.length - 1) await new Promise(r => setTimeout(r, 500));
        }

        // Auto-detect and import resume chapters with enhanced detection
        const resumeChapters = sel.filter(ch => {
          const titleText = `${ch.section_number} ${ch.title}`.toLowerCase();
          // Strong title match
          if (resumeTitleKeywords.some(kw => titleText.includes(kw))) return true;
          // Content-based detection: scan more content (first 5000 chars)
          const contentSample = (ch.content || "").substring(0, 5000);
          if (!contentSample || contentSample.length < 100) return false;
          let hits = 0;
          for (const pat of resumeContentPatterns) {
            if (pat.test(contentSample)) hits++;
            if (hits >= 2) return true;
          }
          return false;
        });

        // If no resume chapters found by heuristics, try AI-based detection on likely candidates
        if (resumeChapters.length === 0 && !cancelledRef.current) {
          const candidates = sel.filter(ch => {
            const content = (ch.content || "").substring(0, 2000);
            // Check for at least 1 resume pattern hit
            return resumeContentPatterns.some(pat => pat.test(content));
          });
          if (candidates.length > 0 && candidates.length <= 10) {
            console.log(`Heuristic found 0 resumes, trying AI detection on ${candidates.length} candidates`);
            for (const ch of candidates) {
              if (!resumeChapters.includes(ch)) resumeChapters.push(ch);
            }
          }
        }

        if (resumeChapters.length > 0 && !cancelledRef.current) {
          updateTask({ phase: "importing_resumes", current: 0, total: resumeChapters.length });
          try {
            const chaptersForImport = resumeChapters.map(ch => ({
              section_number: ch.section_number,
              title: ch.title,
              content: ch.content || "",
            }));
            const { data: importResult, error: importErr } = await supabase.functions.invoke("resume-factory", {
              body: { action: "import-from-chapters", userId, chapters: chaptersForImport },
            });
            if (!importErr && importResult?.results?.length) {
              const created = importResult.results.filter((r: any) => r.action === "created").map((r: any) => r.name);
              const merged = importResult.results.filter((r: any) => r.action === "merged").map((r: any) => r.name);
              updateTask({ resumeImportResult: { created, merged } });
              const parts: string[] = [];
              if (created.length) parts.push(`新增${created.length}人`);
              if (merged.length) parts.push(`更新${merged.length}人`);
              if (parts.length) toast({ title: "简历已自动导入", description: `${parts.join("，")}至简历工厂` });
            }
          } catch (err: any) {
            console.error("Resume import error:", err);
          }
        }

        updateTask({ status: "done" });
        toast({ title: "提取完成", description: `成功保存${sel.length}个章节到项目「${projectName}」` });
        onComplete();
      } catch (err: any) {
        updateTask({ status: "error", errorMessage: err.message });
        toast({ title: "提取失败", description: err.message, variant: "destructive" });
      } finally {
        taskRunningRef.current = false;
      }
    })();
  }, [toast]);

  const pauseTask = useCallback(() => {
    pausedRef.current = true;
    updateTask({ status: "paused" });
  }, []);

  const resumeTask = useCallback(() => {
    pausedRef.current = false;
    updateTask({ status: "running" });
  }, []);

  const cancelTask = useCallback(() => {
    cancelledRef.current = true;
    pausedRef.current = false;
    updateTask({ status: "cancelled" });
  }, []);

  const clearTask = useCallback(() => {
    setActiveTask(null);
  }, []);

  return (
    <ExtractionTaskContext.Provider value={{ activeTask, startTask, pauseTask, resumeTask, cancelTask, clearTask }}>
      {children}
    </ExtractionTaskContext.Provider>
  );
}
