import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, FileText, CheckCircle, AlertTriangle, XCircle,
  RefreshCw, Users, ChevronRight, ChevronDown, Loader2,
  ClipboardCheck, Trash2, Search, Sparkles, Download, Upload, Paperclip,
} from "lucide-react";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { saveAs } from "file-saver";

function flattenSections(sections: ProposalSection[], depth = 0): { section: ProposalSection; depth: number }[] {
  const result: { section: ProposalSection; depth: number }[] = [];
  for (const s of sections) {
    result.push({ section: s, depth });
    if (s.children?.length) result.push(...flattenSections(s.children, depth + 1));
  }
  return result;
}

function formatTokenCount(count: number | undefined | null): string {
  if (count == null) return "0";
  if (count >= 1_000_000_000) return (count / 1_000_000_000).toFixed(1) + "B";
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + "M";
  if (count >= 1_000) return (count / 1_000).toFixed(1) + "K";
  return String(count);
}

interface BidAnalysis {
  id: string;
  project_name: string | null;
  summary: string | null;
  scoring_table: any;
  personnel_requirements: any;
  disqualification_items: any;
}

interface Proposal {
  id: string;
  project_name: string;
  status: string;
  ai_status: string;
  ai_progress: string | null;
  token_usage: any;
  outline_content: string | null;
  custom_prompt: string | null;
  bid_analysis_id: string | null;
  created_at: string;
}

interface ProposalMaterial {
  id: string;
  requirement_text: string;
  requirement_type: string;
  material_name: string | null;
  material_format: string | null;
  status: string;
  severity: string;
  matched_document_id: string | null;
  matched_file_path: string | null;
  notes: string | null;
}

interface ProposalSection {
  id: string;
  section_number: string | null;
  title: string;
  content: string | null;
  sort_order: number;
  parent_id: string | null;
  children?: ProposalSection[];
}

export default function BiddingAssistant() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [analyses, setAnalyses] = useState<BidAnalysis[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const [materials, setMaterials] = useState<ProposalMaterial[]>([]);

  const [creating, setCreating] = useState(false);
  const [selectedBidId, setSelectedBidId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [uploadingMaterialId, setUploadingMaterialId] = useState<string | null>(null);
  const [expandedFormats, setExpandedFormats] = useState<Set<string>>(new Set());
  const fetchAnalyses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("bid_analyses")
      .select("id, project_name, summary, scoring_table, personnel_requirements, disqualification_items")
      .eq("user_id", user.id)
      .eq("ai_status", "completed")
      .order("created_at", { ascending: false });
    setAnalyses(data || []);
  }, [user]);

  const fetchProposals = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("bid_proposals")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setProposals((data as any[]) || []);
  }, [user]);

  const fetchProposalDetails = useCallback(async (proposalId: string) => {
    const [{ data: secs }, { data: mats }] = await Promise.all([
      supabase.from("proposal_sections").select("*").eq("proposal_id", proposalId).order("sort_order"),
      supabase.from("proposal_materials").select("*").eq("proposal_id", proposalId),
    ]);

    // Build tree
    const allSections = (secs as any[]) || [];
    const roots: ProposalSection[] = [];
    const map = new Map<string, ProposalSection>();
    allSections.forEach((s) => { map.set(s.id, { ...s, children: [] }); });
    allSections.forEach((s) => {
      const node = map.get(s.id)!;
      if (s.parent_id && map.has(s.parent_id)) {
        map.get(s.parent_id)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });

    setSections(roots);
    setMaterials((mats as any[]) || []);
  }, []);

  useEffect(() => { fetchAnalyses(); fetchProposals(); }, [fetchAnalyses, fetchProposals]);

  // Poll for progress when a proposal is processing
  useEffect(() => {
    if (!selectedProposal || selectedProposal.ai_status !== "processing") return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("bid_proposals")
        .select("ai_status, ai_progress, token_usage")
        .eq("id", selectedProposal.id)
        .single();
      if (data) {
        setSelectedProposal((prev) => prev ? { ...prev, ...(data as any) } : prev);
        if ((data as any).ai_status !== "processing") {
          clearInterval(interval);
          fetchProposals();
          if ((data as any).ai_status === "completed") {
            fetchProposalDetails(selectedProposal.id);
          }
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedProposal?.id, selectedProposal?.ai_status, fetchProposals, fetchProposalDetails]);

  useEffect(() => {
    if (selectedProposal) {
      fetchProposalDetails(selectedProposal.id);
      setCustomPrompt(selectedProposal.custom_prompt || "");
    }
  }, [selectedProposal?.id, fetchProposalDetails]);

  const handleCreate = async () => {
    if (!user || !selectedBidId) return;
    setGenerating(true);
    try {
      const bid = analyses.find((a) => a.id === selectedBidId);
      const name = projectName.trim() || bid?.project_name || "未命名投标方案";

      const { data: proposal, error } = await supabase
        .from("bid_proposals")
        .insert({
          user_id: user.id,
          bid_analysis_id: selectedBidId,
          project_name: name,
          custom_prompt: customPrompt.trim() || null,
        } as any)
        .select()
        .single();

      if (error || !proposal) throw error || new Error("创建失败");

      // Immediately select the new proposal with processing status so polling starts
      const newProposal: Proposal = {
        ...(proposal as any),
        ai_status: "processing",
        ai_progress: "正在准备数据...",
      };
      setSelectedProposal(newProposal);
      setCreating(false);
      setProjectName("");
      setCustomPrompt("");
      setSelectedBidId("");
      fetchProposals();

      // Fire-and-forget: invoke edge function without awaiting
      supabase.functions.invoke("bidding-assistant", {
        body: {
          action: "generate-outline",
          proposalId: (proposal as any).id,
          bidAnalysisId: selectedBidId,
          customPrompt: customPrompt.trim() || undefined,
        },
      }).then(({ error: fnErr }) => {
        if (fnErr) {
          toast({ title: "生成失败", description: fnErr.message, variant: "destructive" });
        }
      });

      toast({ title: "开始生成投标提纲", description: "请等待AI生成完成..." });
    } catch (e: any) {
      toast({ title: "创建失败", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleCheckMaterials = async () => {
    if (!selectedProposal) return;
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("bidding-assistant", {
        body: { action: "check-materials", proposalId: selectedProposal.id },
      });
      if (error) throw error;
      toast({ title: "材料检查完成", description: `新匹配 ${data?.updatedCount || 0} 项材料` });
      await fetchProposalDetails(selectedProposal.id);
    } catch (e: any) {
      toast({ title: "检查失败", description: e.message, variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("bid_proposals").delete().eq("id", id);
    if (selectedProposal?.id === id) {
      setSelectedProposal(null);
      setSections([]);
      setMaterials([]);
    }
    fetchProposals();
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleMaterialUpload = async (materialId: string, file: File) => {
    if (!user || !selectedProposal) return;
    setUploadingMaterialId(materialId);
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const filePath = `${user.id}/${selectedProposal.id}/${materialId}_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("proposal-materials").upload(filePath, file);
      if (uploadErr) throw uploadErr;

      const { error: updateErr } = await supabase
        .from("proposal_materials")
        .update({ status: "uploaded", matched_file_path: filePath })
        .eq("id", materialId);
      if (updateErr) throw updateErr;

      toast({ title: "上传成功", description: `${file.name} 已上传` });
      await fetchProposalDetails(selectedProposal.id);
    } catch (e: any) {
      toast({ title: "上传失败", description: e.message, variant: "destructive" });
    } finally {
      setUploadingMaterialId(null);
    }
  };

  const handleExportWord = async () => {
    if (!selectedProposal) return;
    const flatSections = flattenSections(sections);
    const children: Paragraph[] = [
      new Paragraph({
        text: selectedProposal.project_name,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({ text: "" }),
    ];

    if (parsedOutline?.overall_strategy) {
      children.push(
        new Paragraph({ text: "投标策略建议", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: parsedOutline.overall_strategy }),
        new Paragraph({ text: "" }),
      );
    }

    children.push(new Paragraph({ text: "投标文件提纲", heading: HeadingLevel.HEADING_1 }));

    for (const { section, depth } of flatSections) {
      const heading = depth === 0 ? HeadingLevel.HEADING_2 : depth === 1 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4;
      const prefix = section.section_number ? `${section.section_number} ` : "";
      children.push(new Paragraph({ text: `${prefix}${section.title}`, heading }));
      if (section.content) {
        children.push(new Paragraph({ text: section.content }));
      }
    }

    if (parsedOutline?.personnel_plan?.length > 0) {
      children.push(new Paragraph({ text: "" }));
      children.push(new Paragraph({ text: "人员配置建议", heading: HeadingLevel.HEADING_1 }));
      for (const p of parsedOutline.personnel_plan) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${p.role}`, bold: true }),
            new TextRun({ text: ` — ${p.requirements || ""}` }),
          ],
        }));
        if (p.suggested_candidate) {
          children.push(new Paragraph({ text: `  建议人选: ${p.suggested_candidate}` }));
        }
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children }],
    });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${selectedProposal.project_name || "投标文件"}.docx`);
    toast({ title: "导出成功", description: "投标文件已导出为Word格式" });
  };

  const parsedOutline = selectedProposal?.outline_content
    ? (() => { try { return JSON.parse(selectedProposal.outline_content); } catch { return null; } })()
    : null;

  const hardMissing = materials.filter((m) => m.requirement_type === "hard" && m.status === "missing");
  const softMissing = materials.filter((m) => m.requirement_type === "soft" && m.status === "missing");
  const matched = materials.filter((m) => m.status === "matched" || m.status === "uploaded");

  // Group materials by format category for structured upload view
  const groupMaterialsByFormat = (mats: ProposalMaterial[]) => {
    const groups: Record<string, ProposalMaterial[]> = {};
    for (const m of mats) {
      const key = (m as any).material_format || "其他材料";
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const renderMaterialItem = (m: ProposalMaterial, icon: React.ReactNode, bgClass: string) => (
    <div key={m.id} className={`flex items-start justify-between gap-3 text-sm p-3 rounded-lg border border-border/50 ${bgClass}`}>
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">{m.material_name || "未知材料"}</p>
          <p className="text-muted-foreground text-xs mt-1">{m.requirement_text}</p>
          {(m as any).material_format && (
            <p className="text-xs text-accent mt-1">📋 建议格式: {(m as any).material_format}</p>
          )}
          {m.status === "uploaded" && m.matched_file_path && (
            <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1 font-medium">
              <Paperclip className="w-3 h-3" />
              已上传: {m.matched_file_path.split("/").pop()?.replace(/^[^_]+_\d+\./, ".")}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <Badge variant={m.status === "uploaded" ? "default" : m.status === "matched" ? "secondary" : "outline"} className="text-[10px]">
          {m.status === "uploaded" ? "✅ 已上传" : m.status === "matched" ? "已匹配" : "⚠️ 待上传"}
        </Badge>
        <label className="cursor-pointer">
          <input
            type="file"
            className="hidden"
            accept=".pdf,.docx,.doc,.xlsx,.xls,.jpg,.png,.jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleMaterialUpload(m.id, file);
              e.target.value = "";
            }}
          />
          <Button variant={m.status === "uploaded" ? "ghost" : "default"} size="sm" asChild disabled={uploadingMaterialId === m.id}>
            <span>
              {uploadingMaterialId === m.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : m.status === "uploaded" ? (
                <><RefreshCw className="w-3.5 h-3.5 mr-1" />重新上传</>
              ) : (
                <><Upload className="w-3.5 h-3.5 mr-1" />上传材料</>
              )}
            </span>
          </Button>
        </label>
      </div>
    </div>
  );

  // ---- RENDER ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">智能投标助手</h2>
          <p className="text-sm text-muted-foreground mt-1">根据招标解析自动生成投标提纲，智能检查证明材料</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <Plus className="w-4 h-4 mr-1" /> 新建投标方案
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <Card>
          <CardHeader><CardTitle className="text-base">新建投标方案</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">关联招标解析 *</label>
              <Select value={selectedBidId} onValueChange={setSelectedBidId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="选择已完成的招标解析" /></SelectTrigger>
                <SelectContent>
                  {analyses.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.project_name || "未命名"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">方案名称</label>
              <Input className="mt-1" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="可选，默认使用招标项目名" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">自定义提纲生成要求</label>
              <Textarea className="mt-1" rows={3} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="可选。例如：重点关注技术方案部分，细化实施计划章节..." />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={!selectedBidId || generating}>
                {generating ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />生成中...</> : <><Sparkles className="w-4 h-4 mr-1" />生成投标提纲</>}
              </Button>
              <Button variant="outline" onClick={() => setCreating(false)} disabled={generating}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: proposal list */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">投标方案列表</CardTitle></CardHeader>
            <CardContent className="p-2">
              <ScrollArea className="max-h-[500px]">
                {proposals.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无方案</p>
                ) : (
                  <div className="space-y-1">
                    {proposals.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedProposal(p)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors group ${
                          selectedProposal?.id === p.id
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-secondary text-foreground"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate flex-1">{p.project_name}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge variant={p.ai_status === "completed" ? "default" : p.ai_status === "processing" ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0">
                            {p.ai_status === "completed" ? "已完成" : p.ai_status === "processing" ? "生成中" : p.ai_status === "failed" ? "失败" : "待处理"}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right: proposal details */}
        <div className="lg:col-span-3">
          {!selectedProposal ? (
            <Card className="flex items-center justify-center py-20">
              <div className="text-center text-muted-foreground">
                <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">选择或新建投标方案</p>
              </div>
            </Card>
          ) : selectedProposal.ai_status === "processing" ? (
            <Card className="flex items-center justify-center py-20">
              <div className="text-center space-y-3">
                <Loader2 className="w-8 h-8 mx-auto animate-spin text-accent" />
                <p className="text-sm font-medium text-foreground">
                  {selectedProposal.ai_progress || "正在生成投标提纲..."}
                </p>
                {selectedProposal.token_usage && (
                  <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground mt-2">
                    <span>Prompt: {formatTokenCount(selectedProposal.token_usage.prompt_tokens)}</span>
                    <span>Completion: {formatTokenCount(selectedProposal.token_usage.completion_tokens)}</span>
                    <span className="font-medium text-foreground">Total: {formatTokenCount(selectedProposal.token_usage.total_tokens)}</span>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Tabs defaultValue="outline" className="space-y-4">
              <TabsList>
                <TabsTrigger value="outline"><FileText className="w-4 h-4 mr-1" />应答提纲</TabsTrigger>
                <TabsTrigger value="materials">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  证明材料
                  {hardMissing.length > 0 && <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">{hardMissing.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="personnel"><Users className="w-4 h-4 mr-1" />人员配置</TabsTrigger>
              </TabsList>

              {/* Outline tab */}
              <TabsContent value="outline" className="space-y-4">
                <div className="flex items-center justify-between">
                  {selectedProposal.token_usage && (
                    <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
                      <span>🔤 Prompt: {formatTokenCount(selectedProposal.token_usage.prompt_tokens)}</span>
                      <span>✍️ Completion: {formatTokenCount(selectedProposal.token_usage.completion_tokens)}</span>
                      <span className="font-medium text-foreground">📊 Total: {formatTokenCount(selectedProposal.token_usage.total_tokens)}</span>
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={handleExportWord} disabled={sections.length === 0}>
                    <Download className="w-4 h-4 mr-1" />导出Word
                  </Button>
                </div>

                {parsedOutline?.overall_strategy && (
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm font-medium text-foreground mb-1">📋 投标策略建议</p>
                      <p className="text-sm text-muted-foreground">{parsedOutline.overall_strategy}</p>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">投标文件提纲</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-[600px]">
                      {sections.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">暂无提纲内容</p>
                      ) : (
                        <div className="space-y-1">
                          {sections.map((section) => (
                            <SectionNode
                              key={section.id}
                              section={section}
                              expanded={expandedSections}
                              onToggle={toggleSection}
                            />
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Materials tab */}
              <TabsContent value="materials" className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-3 text-sm">
                    <span className="flex items-center gap-1"><XCircle className="w-4 h-4 text-destructive" />硬性缺失 {hardMissing.length}</span>
                    <span className="flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-yellow-500" />软性缺失 {softMissing.length}</span>
                    <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4 text-green-500" />已匹配 {matched.length}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleCheckMaterials} disabled={checking}>
                    {checking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
                    重新检查
                  </Button>
                </div>

                {/* Hard requirements - grouped by format, collapsible */}
                {hardMissing.length > 0 && (
                  <Card className="border-destructive/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-destructive flex items-center gap-1.5">
                        <XCircle className="w-4 h-4" /> 硬性要求 - 缺失材料（必须补全）
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {groupMaterialsByFormat(hardMissing).map(([format, items]) => {
                        const formatKey = `hard-${format}`;
                        const isOpen = expandedFormats.has(formatKey);
                        const uploadedCount = items.filter(i => i.status === "uploaded").length;
                        return (
                          <div key={format} className="rounded-lg border border-border/60 overflow-hidden">
                            <button
                              onClick={() => setExpandedFormats(prev => {
                                const next = new Set(prev);
                                next.has(formatKey) ? next.delete(formatKey) : next.add(formatKey);
                                return next;
                              })}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
                            >
                              <div className="flex items-center gap-2">
                                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                <span className="text-sm font-medium text-foreground">{format}</span>
                                <Badge variant="outline" className="text-[10px]">{uploadedCount}/{items.length} 已上传</Badge>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="px-4 pb-3 space-y-2 border-t border-border/40">
                                {items.map((m) => renderMaterialItem(m, <XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />, "bg-destructive/5"))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                {/* Soft requirements - grouped by format, collapsible */}
                {softMissing.length > 0 && (
                  <Card className="border-yellow-500/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-yellow-600 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" /> 软性要求 - 建议补充
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {groupMaterialsByFormat(softMissing).map(([format, items]) => {
                        const formatKey = `soft-${format}`;
                        const isOpen = expandedFormats.has(formatKey);
                        const uploadedCount = items.filter(i => i.status === "uploaded").length;
                        return (
                          <div key={format} className="rounded-lg border border-border/60 overflow-hidden">
                            <button
                              onClick={() => setExpandedFormats(prev => {
                                const next = new Set(prev);
                                next.has(formatKey) ? next.delete(formatKey) : next.add(formatKey);
                                return next;
                              })}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
                            >
                              <div className="flex items-center gap-2">
                                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                <span className="text-sm font-medium text-foreground">{format}</span>
                                <Badge variant="outline" className="text-[10px]">{uploadedCount}/{items.length} 已上传</Badge>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="px-4 pb-3 space-y-2 border-t border-border/40">
                                {items.map((m) => renderMaterialItem(m, <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />, "bg-yellow-500/5"))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                {/* Matched/Uploaded - grouped by format, collapsible */}
                {matched.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-green-600 flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4" /> 已匹配/已上传材料
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {groupMaterialsByFormat(matched).map(([format, items]) => {
                        const formatKey = `matched-${format}`;
                        const isOpen = expandedFormats.has(formatKey);
                        return (
                          <div key={format} className="rounded-lg border border-border/60 overflow-hidden">
                            <button
                              onClick={() => setExpandedFormats(prev => {
                                const next = new Set(prev);
                                next.has(formatKey) ? next.delete(formatKey) : next.add(formatKey);
                                return next;
                              })}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
                            >
                              <div className="flex items-center gap-2">
                                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                <span className="text-sm font-medium text-foreground">{format}</span>
                                <Badge variant="default" className="text-[10px]">{items.length} 项已完成</Badge>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="px-4 pb-3 space-y-2 border-t border-border/40">
                                {items.map((m) => renderMaterialItem(m, <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />, "bg-green-500/5"))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                {materials.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无证明材料检查结果</p>
                )}
              </TabsContent>

              {/* Personnel tab */}
              <TabsContent value="personnel" className="space-y-4">
                {parsedOutline?.personnel_plan && parsedOutline.personnel_plan.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">人员配置建议</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {parsedOutline.personnel_plan.map((p: any, i: number) => (
                          <div key={i} className="p-3 rounded-lg border border-border">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-foreground">{p.role}</span>
                              {p.suggested_candidate && (
                                <Badge variant="secondary" className="text-xs">{p.suggested_candidate}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{p.requirements}</p>
                            {p.match_reason && (
                              <p className="text-xs text-accent mt-1">💡 {p.match_reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无人员配置建议</p>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionNode({
  section,
  expanded,
  onToggle,
  depth = 0,
}: {
  section: ProposalSection;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  depth?: number;
}) {
  const hasChildren = section.children && section.children.length > 0;
  const isExpanded = expanded.has(section.id);

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <button
        onClick={() => onToggle(section.id)}
        className="w-full text-left flex items-start gap-1.5 px-2 py-1.5 rounded hover:bg-secondary transition-colors"
      >
        {hasChildren ? (
          isExpanded ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">
            {section.section_number && <span className="text-muted-foreground mr-1">{section.section_number}</span>}
            {section.title}
          </span>
          {isExpanded && section.content && (
            <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{section.content}</p>
          )}
        </div>
      </button>
      {isExpanded && hasChildren && (
        <div>
          {section.children!.map((child) => (
            <SectionNode key={child.id} section={child} expanded={expanded} onToggle={onToggle} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
