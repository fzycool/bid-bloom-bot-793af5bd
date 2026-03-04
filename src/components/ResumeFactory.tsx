import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  Plus,
  Loader2,
  FileText,
  Upload,
  AlertTriangle,
  CheckCircle,
  Target,
  Sparkles,
  Clock,
  Trash2,
  ChevronLeft,
  Copy,
  FileSpreadsheet,
  FileDown,
  LayoutTemplate,
} from "lucide-react";

interface Employee {
  id: string;
  name: string;
  gender: string | null;
  birth_year: number | null;
  education: string | null;
  major: string | null;
  current_company: string | null;
  current_position: string | null;
  years_of_experience: number | null;
  certifications: string[];
  skills: string[];
  created_at: string;
}

interface ResumeVersion {
  id: string;
  employee_id: string;
  version_name: string;
  target_role: string | null;
  target_industry: string | null;
  content: string | null;
  work_experiences: any[];
  project_experiences: any[];
  education_history: any[];
  timeline_issues: any[];
  match_score: number | null;
  match_details: any;
  polished_content: string | null;
  ai_status: string;
  created_at: string;
}

interface BidAnalysis {
  id: string;
  project_name: string | null;
  ai_status: string;
  technical_keywords: string[] | null;
  business_keywords: string[] | null;
  responsibility_keywords: string[] | null;
  personnel_requirements: any[] | null;
}

export default function ResumeFactory() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [bidAnalyses, setBidAnalyses] = useState<BidAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<ResumeVersion | null>(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showAddVersion, setShowAddVersion] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Templates
  const [resumeTemplates, setResumeTemplates] = useState<{ id: string; template_name: string; file_path: string; is_default: boolean }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [generating, setGenerating] = useState(false);

  // Add employee form
  const [newName, setNewName] = useState("");
  // Add version form
  const [versionName, setVersionName] = useState("标准版");
  const [resumeContent, setResumeContent] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [inputMode, setInputMode] = useState<"text" | "file">("text");
  const [batchImporting, setBatchImporting] = useState(false);

  // Match/polish
  const [selectedBidId, setSelectedBidId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [polishInstructions, setPolishInstructions] = useState("");
  const [matchPrompt, setMatchPrompt] = useState(
    "1. 分析候选人与招标要求的匹配程度\n2. 列出候选人的核心优势和不足\n3. 标出简历中缺失的关键词\n4. 推荐最适合的投标角色\n5. 给出具体的简历改进建议"
  );

  // Derived: roles from selected bid
  const selectedBid = bidAnalyses.find((b) => b.id === selectedBidId);
  const bidRoles = (selectedBid?.personnel_requirements || []) as any[];

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [empRes, bidRes, tplRes] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: false }),
      supabase.from("bid_analyses").select("id, project_name, ai_status, technical_keywords, business_keywords, responsibility_keywords, personnel_requirements").eq("ai_status", "completed").order("created_at", { ascending: false }),
      supabase.from("resume_templates").select("id, template_name, file_path, is_default").order("is_default", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    setEmployees((empRes.data as Employee[]) || []);
    setBidAnalyses((bidRes.data as BidAnalysis[]) || []);
    const tpls = (tplRes.data as any[]) || [];
    setResumeTemplates(tpls);
    // Auto-select default template
    if (tpls.length > 0 && !selectedTemplateId) {
      const def = tpls.find((t: any) => t.is_default);
      setSelectedTemplateId(def ? def.id : tpls[0].id);
    }
    setLoading(false);
  }, [user]);

  const fetchVersions = useCallback(async (employeeId: string) => {
    const { data } = await supabase
      .from("resume_versions")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    const list = (data as ResumeVersion[]) || [];
    setVersions(list);
    // Keep selectedVersion in sync with fresh data
    setSelectedVersion((prev) => prev ? list.find((v) => v.id === prev.id) || prev : prev);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (selectedEmployee) fetchVersions(selectedEmployee.id); }, [selectedEmployee, fetchVersions]);

  const handleAddEmployee = async () => {
    if (!newName.trim() || !user) return;
    const { data, error } = await supabase
      .from("employees")
      .insert({ user_id: user.id, name: newName.trim() })
      .select()
      .single();
    if (error) { toast({ title: "添加失败", description: error.message, variant: "destructive" }); return; }
    setEmployees((prev) => [data as Employee, ...prev]);
    setNewName("");
    setShowAddEmployee(false);
    toast({ title: "员工已添加" });
  };

  const handleDeleteEmployee = async (id: string) => {
    await supabase.from("employees").delete().eq("id", id);
    setEmployees((prev) => prev.filter((e) => e.id !== id));
    if (selectedEmployee?.id === id) { setSelectedEmployee(null); setVersions([]); }
    toast({ title: "已删除" });
  };

  const handleAddVersion = async () => {
    if (!selectedEmployee || !user) return;
    if (inputMode === "text" && !resumeContent.trim()) {
      toast({ title: "请输入简历内容", variant: "destructive" }); return;
    }
    if (inputMode === "file" && !resumeFile) {
      toast({ title: "请上传简历文件", variant: "destructive" }); return;
    }

    setProcessing(true);

    let textContent = resumeContent;
    let filePath: string | undefined;

    // Upload file if in file mode
    if (inputMode === "file" && resumeFile) {
      const fileExt = resumeFile.name.split('.').pop() || 'bin';
      const storagePath = `${user.id}/resumes/${Date.now()}.${fileExt}`;
      const { error: uploadErr } = await supabase.storage.from("knowledge-base").upload(storagePath, resumeFile);
      if (uploadErr) {
        toast({ title: "上传失败", description: uploadErr.message, variant: "destructive" });
        setProcessing(false); return;
      }
      filePath = storagePath;
      textContent = ""; // will be extracted by edge function
    }

    // Create version record
    const { data: version, error: insertErr } = await supabase
      .from("resume_versions")
      .insert({
        employee_id: selectedEmployee.id,
        user_id: user.id,
        version_name: versionName || "标准版",
        content: textContent,
      })
      .select()
      .single();

    if (insertErr || !version) {
      toast({ title: "创建失败", description: insertErr?.message, variant: "destructive" });
      setProcessing(false); return;
    }

    // Call AI to parse
    try {
      const { error: fnErr } = await supabase.functions.invoke("resume-factory", {
        body: { action: "parse-resume", resumeVersionId: version.id, content: textContent || undefined, filePath, fileType: resumeFile?.type },
      });
      if (fnErr) throw fnErr;
      toast({ title: "简历已解析", description: "AI已完成结构化提取和时间线稽查" });
    } catch (err: any) {
      toast({ title: "AI解析失败", description: err.message, variant: "destructive" });
    }

    setResumeContent("");
    setResumeFile(null);
    setVersionName("标准版");
    setShowAddVersion(false);
    await fetchVersions(selectedEmployee.id);
    await fetchData(); // Refresh employee info (AI may update it)
    setProcessing(false);
  };

  const handleMatch = async (versionId: string) => {
    if (!selectedBidId) { toast({ title: "请先选择招标项目", variant: "destructive" }); return; }
    setProcessing(true);
    try {
      const { error } = await supabase.functions.invoke("resume-factory", {
        body: { action: "match-resume", resumeVersionId: versionId, bidAnalysisId: selectedBidId, targetRole: selectedRole || undefined, customPrompt: matchPrompt.trim() || undefined },
      });
      if (error) throw error;
      toast({ title: "匹配分析完成" });
      if (selectedEmployee) await fetchVersions(selectedEmployee.id);
    } catch (err: any) {
      toast({ title: "匹配失败", description: err.message, variant: "destructive" });
    }
    setProcessing(false);
  };

  const handlePolish = async (versionId: string) => {
    setProcessing(true);
    try {
      const { error } = await supabase.functions.invoke("resume-factory", {
        body: {
          action: "polish-resume",
          resumeVersionId: versionId,
          bidAnalysisId: selectedBidId || undefined,
          targetRole: selectedRole || undefined,
          customInstructions: polishInstructions || undefined,
        },
      });
      if (error) throw error;
      toast({ title: "润色完成" });
      if (selectedEmployee) await fetchVersions(selectedEmployee.id);
    } catch (err: any) {
      toast({ title: "润色失败", description: err.message, variant: "destructive" });
    }
    setProcessing(false);
  };

  const handleDeleteVersion = async (id: string) => {
    await supabase.from("resume_versions").delete().eq("id", id);
    setVersions((prev) => prev.filter((v) => v.id !== id));
    if (selectedVersion?.id === id) setSelectedVersion(null);
    toast({ title: "已删除" });
  };

  const handleCopyPolished = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "已复制到剪贴板" });
  };

  const handleGenerateResume = async (versionId: string) => {
    if (!selectedTemplateId) {
      toast({ title: "请先选择简历模板", variant: "destructive" });
      return;
    }
    const v = versions.find((ver) => ver.id === versionId) || selectedVersion;
    if (!v?.polished_content) {
      toast({ title: "请先完成简历润色", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const tpl = resumeTemplates.find((t) => t.id === selectedTemplateId);
      const { data, error } = await supabase.functions.invoke("resume-factory", {
        body: {
          action: "generate-resume-docx",
          resumeVersionId: versionId,
          templateFilePath: tpl?.file_path,
          employeeName: selectedEmployee?.name || "简历",
        },
      });
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("生成失败，未获取到下载链接");

      // Download the generated file
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = `${selectedEmployee?.name || "简历"}_${v.version_name}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      toast({ title: "简历已生成并下载" });
    } catch (err: any) {
      toast({ title: "生成失败", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleBatchImportExcel = async (file: File) => {
    if (!user) return;
    setBatchImporting(true);
    try {
      // Parse Excel client-side using SheetJS
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetsText: { name: string; text: string }[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        // Use sheet_to_json to get compact data, then stringify
        const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (!jsonData || jsonData.length === 0) continue;
        
        // Remove columns that are entirely empty across all rows
        const headers = Object.keys(jsonData[0] as object);
        const nonEmptyHeaders = headers.filter(h => 
          jsonData.some(row => {
            const val = (row as any)[h];
            return val !== "" && val !== null && val !== undefined;
          })
        );
        
        // Build compact text: header line + data lines, only non-empty columns
        const lines: string[] = [nonEmptyHeaders.join(",")];
        for (const row of jsonData) {
          const vals = nonEmptyHeaders.map(h => {
            const v = String((row as any)[h] || "").replace(/\n/g, " ").trim();
            return v.includes(",") ? `"${v}"` : v;
          });
          const line = vals.join(",");
          if (line.replace(/,/g, "").trim()) lines.push(line);
        }
        const compactText = lines.join("\n");
        if (compactText.trim()) {
          // Allow up to 6000 chars now that data is compact
          const trimmed = compactText.length > 6000 ? compactText.slice(0, 6000) : compactText;
          sheetsText.push({ name: sheetName, text: trimmed });
        }
      }
      if (sheetsText.length === 0) {
        toast({ title: "Excel中没有有效内容", variant: "destructive" });
        setBatchImporting(false);
        return;
      }

      // Process ONE sheet at a time to avoid payload size limits
      let totalCount = 0;
      for (let i = 0; i < sheetsText.length; i++) {
        toast({ title: `正在导入...`, description: `第 ${i + 1}/${sheetsText.length} 个: ${sheetsText[i].name}` });
        const { data, error } = await supabase.functions.invoke("resume-factory", {
          body: { action: "batch-import-excel", sheetsText: [sheetsText[i]], userId: user.id },
        });
        if (error) throw error;
        totalCount += data.count || 0;
      }

      toast({ title: "批量导入成功", description: `已导入 ${totalCount} 名员工` });
      await fetchData();
    } catch (err: any) {
      toast({ title: "导入失败", description: err.message, variant: "destructive" });
    }
    setBatchImporting(false);
  };

  const generatePolishInstructions = useCallback((bidId: string, role?: string) => {
    if (!bidId || bidId === "none") return;
    const bid = bidAnalyses.find((b) => b.id === bidId);
    if (!bid) return;
    const empSkills = selectedEmployee?.skills || [];
    const empCerts = selectedEmployee?.certifications || [];
    const techKws = (bid.technical_keywords || []) as string[];
    const bizKws = (bid.business_keywords || []) as string[];
    const respKws = (bid.responsibility_keywords || []) as string[];
    const allBidKws = [...techKws, ...bizKws, ...respKws];
    const matched = allBidKws.filter((k) => empSkills.some((s) => k.includes(s) || s.includes(k)));
    const missing = allBidKws.filter((k) => !empSkills.some((s) => k.includes(s) || s.includes(k)));

    const targetRole = role || selectedRole;
    const roleObj = targetRole ? (bid.personnel_requirements as any[] || []).find((r: any) => r.role === targetRole) : null;

    let instructions = "";

    if (targetRole && roleObj) {
      instructions += `【目标岗位】${targetRole}\n`;
      instructions += `岗位要求：${roleObj.qualifications || "无"}\n`;
      if (roleObj.certifications?.length) instructions += `所需证书：${roleObj.certifications.join("、")}\n`;
      if (roleObj.experience_years) instructions += `经验要求：${roleObj.experience_years}年以上\n`;
      if (roleObj.specific_requirements) instructions += `特殊要求：${roleObj.specific_requirements}\n`;
      instructions += "\n";
    }

    instructions += `【招标关键词与简历对照】\n`;
    if (matched.length > 0) instructions += `✅ 已有匹配（需重点强化）：${matched.join("、")}\n`;
    if (missing.length > 0) instructions += `⚠️ 缺失关键词（需从经历中挖掘关联）：${missing.join("、")}\n`;
    if (empCerts.length > 0) instructions += `📜 现有证书：${empCerts.join("、")}\n`;

    const roles = (bid.personnel_requirements || []) as any[];
    if (roles.length > 0) {
      instructions += `\n【招标全部人员要求】\n`;
      roles.forEach((r: any) => {
        const isTarget = r.role === targetRole;
        instructions += `${isTarget ? "👉 " : "• "}${r.role}${r.count ? `(${r.count}人)` : ""}: ${r.qualifications || ""}${r.certifications?.length ? `, 证书:${r.certifications.join("/")}` : ""}${r.experience_years ? `, ${r.experience_years}年+` : ""}\n`;
      });
    }

    instructions += `\n【润色要求】\n1. 将简历中的职责描述对齐到${targetRole ? `"${targetRole}"岗位的` : "招标"}评分关键词\n2. 对已有匹配技能进行量化强化（加入具体数据和成果）\n3. 对缺失关键词从现有经历中挖掘关联描述\n4. 保持时间线不变，不编造经历`;
    setPolishInstructions(instructions);
  }, [bidAnalyses, selectedEmployee, selectedRole]);

  // ====== VERSION DETAIL VIEW ======
  if (selectedVersion) {
    const v = selectedVersion;
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectedVersion(null)} className="text-sm text-accent hover:underline">
            <ChevronLeft className="w-4 h-4 inline" /> 返回版本列表
          </button>
          <h2 className="text-xl font-bold text-foreground">{v.version_name}</h2>
          {v.match_score !== null && (
            <Badge className={v.match_score >= 70 ? "bg-green-100 text-green-800" : v.match_score >= 40 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}>
              匹配度 {v.match_score}%
            </Badge>
          )}
        </div>

        <Tabs defaultValue="timeline" onValueChange={(tab) => {
          if (tab === "polish" && selectedBidId && selectedBidId !== "none" && !polishInstructions) {
            generatePolishInstructions(selectedBidId);
          }
        }}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="timeline" className="text-xs gap-1"><Clock className="w-3.5 h-3.5" />时间线稽查</TabsTrigger>
            <TabsTrigger value="match" className="text-xs gap-1"><Target className="w-3.5 h-3.5" />匹配分析</TabsTrigger>
            <TabsTrigger value="polish" className="text-xs gap-1"><Sparkles className="w-3.5 h-3.5" />智能润色</TabsTrigger>
            <TabsTrigger value="raw" className="text-xs gap-1"><FileText className="w-3.5 h-3.5" />原始内容</TabsTrigger>
          </TabsList>

          {/* Timeline */}
          <TabsContent value="timeline" className="space-y-4 mt-4">
            <h3 className="font-semibold text-foreground">时间线逻辑稽查</h3>
            {(v.timeline_issues as any[])?.length > 0 ? (
              (v.timeline_issues as any[]).map((issue: any, i: number) => (
                <Card key={i} className={`border-l-4 ${issue.severity === "error" ? "border-l-destructive" : "border-l-yellow-400"}`}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <AlertTriangle className={`w-5 h-5 shrink-0 ${issue.severity === "error" ? "text-destructive" : "text-yellow-500"}`} />
                    <div>
                      <Badge variant={issue.severity === "error" ? "destructive" : "secondary"} className="text-xs mb-1">
                        {issue.type === "overlap" ? "时间重叠" : issue.type === "gap" ? "空档期" : issue.type === "impossible" ? "逻辑矛盾" : issue.type}
                      </Badge>
                      <p className="text-sm text-foreground">{issue.description}</p>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500" />
                <p>时间线无异常</p>
              </div>
            )}

            {/* Work experiences */}
            {(v.work_experiences as any[])?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">工作经历时间轴</h4>
                <div className="space-y-2">
                  {(v.work_experiences as any[]).map((w: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-sm p-3 bg-muted/50 rounded-lg">
                      <span className="text-xs text-muted-foreground w-32 shrink-0">{w.start_date} ~ {w.end_date || "至今"}</span>
                      <span className="font-medium text-foreground">{w.company}</span>
                      <span className="text-muted-foreground">{w.position}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="match" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">选择招标项目</Label>
                  <Select value={selectedBidId} onValueChange={(val) => { setSelectedBidId(val); setSelectedRole(""); }}>
                    <SelectTrigger><SelectValue placeholder="选择已解析的招标项目" /></SelectTrigger>
                    <SelectContent>
                      {bidAnalyses.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.project_name || "未命名"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">目标岗位角色</Label>
                  <Select value={selectedRole} onValueChange={setSelectedRole} disabled={!selectedBidId || bidRoles.length === 0}>
                    <SelectTrigger><SelectValue placeholder={bidRoles.length > 0 ? "选择岗位" : "请先选择招标项目"} /></SelectTrigger>
                    <SelectContent>
                      {bidRoles.map((r: any, i: number) => (
                        <SelectItem key={i} value={r.role}>
                          {r.role}{r.count ? ` (${r.count}人)` : ""}{r.experience_years ? ` · ${r.experience_years}年+` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-2">
                  📝 自定义匹配分析要求
                  <span className="text-muted-foreground font-normal">（告诉AI重点分析哪些方面）</span>
                </Label>
                <Textarea
                  placeholder="输入你希望AI重点分析的匹配维度..."
                  value={matchPrompt}
                  onChange={(e) => setMatchPrompt(e.target.value)}
                  className="min-h-[100px] text-sm"
                />
              </div>
              <Button onClick={() => handleMatch(v.id)} disabled={processing || !selectedBidId} className="gap-1.5">
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                开始匹配
              </Button>
            </div>

            {v.match_score !== null && v.match_details && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="w-4 h-4 text-accent" />
                    匹配分析结果
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 pt-0 space-y-4">
                  {/* Score + Role */}
                  <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                    <div className={`text-4xl font-bold ${(v.match_score ?? 0) >= 70 ? "text-green-600" : (v.match_score ?? 0) >= 40 ? "text-yellow-600" : "text-red-600"}`}>
                      {v.match_score}%
                    </div>
                    <div className="flex-1">
                      {v.match_details.target_role && (
                        <p className="text-sm">目标岗位: <span className="text-foreground font-semibold">{v.match_details.target_role}</span></p>
                      )}
                      {v.match_details.suggested_role && (
                        <p className="text-sm">建议角色: <span className="text-foreground font-semibold">{v.match_details.suggested_role}</span></p>
                      )}
                      {v.match_details.overall_assessment && (
                        <p className="text-xs text-muted-foreground mt-1">{v.match_details.overall_assessment}</p>
                      )}
                    </div>
                  </div>

                  {/* Role requirements analysis */}
                  {v.match_details.role_requirements_met && (
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <h4 className="text-sm font-semibold text-foreground mb-1">🎯 岗位要求逐条分析</h4>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{v.match_details.role_requirements_met}</p>
                    </div>
                  )}

                  {/* Strengths */}
                  {v.match_details.strengths?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">✅ 优势</h4>
                      <ul className="text-sm text-foreground space-y-1 pl-1">
                        {v.match_details.strengths.map((s: string, i: number) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Weaknesses */}
                  {v.match_details.weaknesses?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">⚠️ 不足</h4>
                      <ul className="text-sm text-foreground space-y-1 pl-1">
                        {v.match_details.weaknesses.map((s: string, i: number) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Keyword coverage */}
                  {v.match_details.keyword_coverage && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">🔑 关键词覆盖</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">已匹配</p>
                          <div className="flex flex-wrap gap-1">
                            {(v.match_details.keyword_coverage.matched || []).map((k: string, i: number) => (
                              <Badge key={i} className="text-xs bg-green-100 text-green-800">{k}</Badge>
                            ))}
                            {!(v.match_details.keyword_coverage.matched?.length > 0) && <span className="text-xs text-muted-foreground">无</span>}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">未匹配</p>
                          <div className="flex flex-wrap gap-1">
                            {(v.match_details.keyword_coverage.missing || []).map((k: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs border-destructive text-destructive">{k}</Badge>
                            ))}
                            {!(v.match_details.keyword_coverage.missing?.length > 0) && <span className="text-xs text-muted-foreground">无</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Legacy missing_keywords fallback */}
                  {!v.match_details.keyword_coverage && v.match_details.missing_keywords?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">缺失关键词</h4>
                      <div className="flex flex-wrap gap-1">
                        {v.match_details.missing_keywords.map((k: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs">{k}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Experience & Cert analysis */}
                  {(v.match_details.experience_relevance || v.match_details.certification_match) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {v.match_details.experience_relevance && (
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <h5 className="text-xs font-semibold text-foreground mb-1">📋 经验相关性</h5>
                          <p className="text-xs text-muted-foreground">{v.match_details.experience_relevance}</p>
                        </div>
                      )}
                      {v.match_details.certification_match && (
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <h5 className="text-xs font-semibold text-foreground mb-1">📜 证书匹配</h5>
                          <p className="text-xs text-muted-foreground">{v.match_details.certification_match}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Improvement suggestions */}
                  {v.match_details.improvement_suggestions?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">💡 改进建议</h4>
                      <ul className="text-sm text-muted-foreground space-y-1 pl-1">
                        {v.match_details.improvement_suggestions.map((s: string, i: number) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Polish */}
          <TabsContent value="polish" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">关联招标项目</Label>
                  <Select value={selectedBidId} onValueChange={(val) => {
                    setSelectedBidId(val);
                    setSelectedRole("");
                    generatePolishInstructions(val);
                  }}>
                    <SelectTrigger><SelectValue placeholder="选择招标项目" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不关联</SelectItem>
                      {bidAnalyses.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.project_name || "未命名"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">目标岗位角色</Label>
                  <Select value={selectedRole} onValueChange={(val) => {
                    setSelectedRole(val);
                    if (selectedBidId && selectedBidId !== "none") generatePolishInstructions(selectedBidId, val);
                  }} disabled={!selectedBidId || selectedBidId === "none" || bidRoles.length === 0}>
                    <SelectTrigger><SelectValue placeholder={bidRoles.length > 0 ? "选择岗位" : "请先选择项目"} /></SelectTrigger>
                    <SelectContent>
                      {bidRoles.map((r: any, i: number) => (
                        <SelectItem key={i} value={r.role}>
                          {r.role}{r.count ? ` (${r.count}人)` : ""}{r.experience_years ? ` · ${r.experience_years}年+` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-2">
                  📝 润色要求
                  <span className="text-muted-foreground font-normal">（选择招标项目后自动生成，可自由编辑）</span>
                </Label>
                <Textarea
                  placeholder="选择招标项目后会自动生成关键词对照和润色要求，也可手动输入..."
                  value={polishInstructions}
                  onChange={(e) => setPolishInstructions(e.target.value)}
                  className="min-h-[200px] text-sm"
                />
              </div>
              <Button onClick={() => handlePolish(v.id)} disabled={processing} className="gap-1.5">
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                开始润色
              </Button>
            </div>

            {v.polished_content && (
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">润色结果</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => handleCopyPolished(v.polished_content!)} className="gap-1">
                    <Copy className="w-3.5 h-3.5" /> 复制
                  </Button>
                </CardHeader>
                <CardContent className="p-4">
                  <pre className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{v.polished_content}</pre>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Raw */}
          <TabsContent value="raw" className="mt-4">
            <Card>
              <CardContent className="p-4">
                <pre className="text-sm text-foreground whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-auto">
                  {v.content || "无内容"}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // ====== EMPLOYEE DETAIL (version list) ======
  if (selectedEmployee) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <button onClick={() => { setSelectedEmployee(null); setVersions([]); }} className="text-sm text-accent hover:underline mb-1">
              <ChevronLeft className="w-4 h-4 inline" /> 返回员工列表
            </button>
            <h2 className="text-xl font-bold text-foreground">{selectedEmployee.name}</h2>
            <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
              {selectedEmployee.current_company && <span>{selectedEmployee.current_company}</span>}
              {selectedEmployee.current_position && <span>· {selectedEmployee.current_position}</span>}
              {selectedEmployee.education && <span>· {selectedEmployee.education}</span>}
              {selectedEmployee.years_of_experience && <span>· {selectedEmployee.years_of_experience}年经验</span>}
            </div>
            {selectedEmployee.skills?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedEmployee.skills.map((s, i) => <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>)}
              </div>
            )}
          </div>
          <Button onClick={() => setShowAddVersion(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> 新建版本
          </Button>
        </div>

        {/* Add version dialog */}
        <Dialog open={showAddVersion} onOpenChange={setShowAddVersion}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>新建简历版本</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>版本名称</Label>
                <Input placeholder="例如：银行客户版、政务版" value={versionName} onChange={(e) => setVersionName(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setInputMode("text")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${inputMode === "text" ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                  <FileText className="w-4 h-4" /> 粘贴文本
                </button>
                <button onClick={() => setInputMode("file")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${inputMode === "file" ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                  <Upload className="w-4 h-4" /> 上传文件
                </button>
              </div>
              {inputMode === "text" ? (
                <div className="space-y-1">
                  <Label>简历内容</Label>
                  <Textarea placeholder="粘贴员工简历全文..." value={resumeContent} onChange={(e) => setResumeContent(e.target.value)} className="min-h-[200px]" />
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-accent/50 transition-colors"
                  onClick={() => document.getElementById("resume-file-upload")?.click()}
                >
                  <input type="file" id="resume-file-upload" className="hidden" accept=".pdf,.doc,.docx,.txt,.xls,.xlsx"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setResumeFile(f); e.target.value = ""; }} />
                  {resumeFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="w-6 h-6 text-accent" />
                      <div className="text-left">
                        <p className="font-medium text-foreground text-sm">{resumeFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(resumeFile.size / 1024).toFixed(0)} KB</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-foreground">点击上传简历文件</p>
                      <p className="text-xs text-muted-foreground mt-1">支持 Word、PDF、TXT、Excel</p>
                    </>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={handleAddVersion} disabled={processing} className="gap-1.5">
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {processing ? "AI解析中..." : "创建并解析"}
                </Button>
                <Button variant="outline" onClick={() => setShowAddVersion(false)}>取消</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Version list */}
        {versions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>暂无简历版本</p>
            <p className="text-xs mt-1">点击"新建版本"上传员工简历</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {versions.map((v) => (
              <Card key={v.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => {
                // Refresh from DB before viewing
                supabase.from("resume_versions").select("*").eq("id", v.id).single().then(({ data }) => {
                  if (data) setSelectedVersion(data as ResumeVersion);
                });
              }}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-accent" />
                    <div>
                      <p className="font-medium text-foreground text-sm">{v.version_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(v.created_at).toLocaleString("zh-CN")}
                        {v.target_role && ` · ${v.target_role}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {v.ai_status === "processing" && <Badge variant="secondary"><Loader2 className="w-3 h-3 animate-spin mr-1" />解析中</Badge>}
                    {v.ai_status === "completed" && v.timeline_issues && (v.timeline_issues as any[]).length > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="w-3 h-3 mr-1" />{(v.timeline_issues as any[]).length}项时间线问题
                      </Badge>
                    )}
                    {v.match_score !== null && (
                      <Badge className={`text-xs ${(v.match_score ?? 0) >= 70 ? "bg-green-100 text-green-800" : (v.match_score ?? 0) >= 40 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>
                        匹配 {v.match_score}%
                      </Badge>
                    )}
                    {v.polished_content && <Badge variant="outline" className="text-xs"><Sparkles className="w-3 h-3 mr-1" />已润色</Badge>}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleDeleteVersion(v.id); }}>
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ====== EMPLOYEE LIST ======
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-accent" />
            简历工厂
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            多版本简历管理、招标匹配分析、智能润色与时间线稽查
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowAddEmployee(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> 添加员工
          </Button>
          <Button variant="outline" className="gap-1.5" disabled={batchImporting}
            onClick={() => document.getElementById("batch-excel-import")?.click()}>
            {batchImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {batchImporting ? "导入中..." : "Excel批量导入"}
          </Button>
          <input type="file" id="batch-excel-import" className="hidden" accept=".xls,.xlsx"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBatchImportExcel(f); e.target.value = ""; }} />
        </div>
      </div>

      {/* Add employee dialog */}
      <Dialog open={showAddEmployee} onOpenChange={setShowAddEmployee}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>添加员工</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>姓名</Label>
              <Input placeholder="员工姓名" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAddEmployee} disabled={!newName.trim()}>添加</Button>
              <Button variant="outline" onClick={() => setShowAddEmployee(false)}>取消</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
      ) : employees.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium text-foreground mb-1">还没有员工</h3>
            <p className="text-sm text-muted-foreground mb-4">添加员工后可上传简历，进行智能解析和匹配</p>
            <Button onClick={() => setShowAddEmployee(true)} className="gap-1.5">
              <Plus className="w-4 h-4" /> 添加第一个员工
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">姓名</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">公司</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">职位</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">学历</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">经验</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">证书/技能</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground w-16">操作</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr
                    key={emp.id}
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedEmployee(emp)}
                  >
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{emp.name}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{emp.current_company || "-"}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{emp.current_position || "-"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {emp.education ? <Badge variant="secondary" className="text-xs">{emp.education}</Badge> : "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {emp.years_of_experience ? `${emp.years_of_experience}年` : "-"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {emp.certifications?.slice(0, 2).map((c, i) => <Badge key={i} variant="outline" className="text-xs">{c}</Badge>)}
                        {emp.skills?.slice(0, 2).map((s, i) => <Badge key={`s${i}`} variant="secondary" className="text-xs">{s}</Badge>)}
                        {((emp.certifications?.length || 0) + (emp.skills?.length || 0)) > 4 && (
                          <span className="text-xs text-muted-foreground">+{(emp.certifications?.length || 0) + (emp.skills?.length || 0) - 4}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleDeleteEmployee(emp.id); }}>
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
