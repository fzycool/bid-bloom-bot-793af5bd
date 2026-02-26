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
  ShieldCheck, AlertCircle, Clock, Image as ImageIcon,
} from "lucide-react";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Header, Footer, LevelFormat, convertInchesToTwip } from "docx";
import { saveAs } from "file-saver";
import JSZip from "jszip";

interface TemplateStyles {
  body: { font?: string; size?: number; lineSpacing?: number };
  heading1: { font?: string; size?: number; bold?: boolean };
  heading2: { font?: string; size?: number; bold?: boolean };
  heading3: { font?: string; size?: number; bold?: boolean };
  heading4: { font?: string; size?: number; bold?: boolean };
  title: { font?: string; size?: number; bold?: boolean };
  pageMargin?: { top?: number; bottom?: number; left?: number; right?: number };
}

async function parseTemplateStyles(file: File): Promise<TemplateStyles> {
  const zip = await JSZip.loadAsync(file);
  const styles: TemplateStyles = {
    body: {}, heading1: {}, heading2: {}, heading3: {}, heading4: {}, title: {},
  };

  // Parse styles.xml
  const stylesXml = zip.file("word/styles.xml");
  if (stylesXml) {
    const xml = await stylesXml.async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    // Extract default run properties
    const docDefaults = doc.getElementsByTagNameNS(ns, "docDefaults")[0];
    if (docDefaults) {
      const rPrDefault = docDefaults.getElementsByTagNameNS(ns, "rPrDefault")[0];
      if (rPrDefault) {
        const rPr = rPrDefault.getElementsByTagNameNS(ns, "rPr")[0];
        if (rPr) {
          const sz = rPr.getElementsByTagNameNS(ns, "sz")[0];
          if (sz) styles.body.size = parseInt(sz.getAttributeNS(ns, "val") || sz.getAttribute("w:val") || "0");
          const rFonts = rPr.getElementsByTagNameNS(ns, "rFonts")[0];
          if (rFonts) {
            styles.body.font = rFonts.getAttributeNS(ns, "eastAsia") || rFonts.getAttribute("w:eastAsia")
              || rFonts.getAttributeNS(ns, "ascii") || rFonts.getAttribute("w:ascii") || undefined;
          }
        }
      }
      const pPrDefault = docDefaults.getElementsByTagNameNS(ns, "pPrDefault")[0];
      if (pPrDefault) {
        const pPr = pPrDefault.getElementsByTagNameNS(ns, "pPr")[0];
        if (pPr) {
          const spacing = pPr.getElementsByTagNameNS(ns, "spacing")[0];
          if (spacing) {
            const lineVal = spacing.getAttributeNS(ns, "line") || spacing.getAttribute("w:line");
            if (lineVal) styles.body.lineSpacing = parseInt(lineVal);
          }
        }
      }
    }

    // Map style IDs to our structure
    const styleMap: Record<string, keyof TemplateStyles> = {
      "1": "heading1", "2": "heading2", "3": "heading3", "4": "heading4",
    };
    const styleEls = doc.getElementsByTagNameNS(ns, "style");
    for (let i = 0; i < styleEls.length; i++) {
      const el = styleEls[i];
      const styleId = el.getAttributeNS(ns, "styleId") || el.getAttribute("w:styleId") || "";
      const type = el.getAttributeNS(ns, "type") || el.getAttribute("w:type") || "";

      let target: keyof TemplateStyles | null = null;
      if (type === "paragraph") {
        // Match heading styles by ID pattern
        const headingMatch = styleId.match(/(?:heading|Heading|标题)\s*(\d)/i);
        if (headingMatch) target = styleMap[headingMatch[1]] || null;
        // Check name element for Chinese heading names
        if (!target) {
          const nameEl = el.getElementsByTagNameNS(ns, "name")[0];
          const name = nameEl?.getAttributeNS(ns, "val") || nameEl?.getAttribute("w:val") || "";
          const nameMatch = name.match(/heading\s*(\d)/i);
          if (nameMatch) target = styleMap[nameMatch[1]] || null;
          if (name.toLowerCase() === "title" || name === "标题") target = "title";
        }
        if (styleId.toLowerCase() === "title") target = "title";
      }
      if (type === "paragraph" && (styleId === "Normal" || styleId === "a" || styleId === "a0")) {
        // Normal/body style
        const rPr = el.getElementsByTagNameNS(ns, "rPr")[0];
        if (rPr) {
          const sz = rPr.getElementsByTagNameNS(ns, "sz")[0];
          if (sz) styles.body.size = parseInt(sz.getAttributeNS(ns, "val") || sz.getAttribute("w:val") || "0");
          const rFonts = rPr.getElementsByTagNameNS(ns, "rFonts")[0];
          if (rFonts) {
            const f = rFonts.getAttributeNS(ns, "eastAsia") || rFonts.getAttribute("w:eastAsia")
              || rFonts.getAttributeNS(ns, "ascii") || rFonts.getAttribute("w:ascii");
            if (f) styles.body.font = f;
          }
        }
        const pPr = el.getElementsByTagNameNS(ns, "pPr")[0];
        if (pPr) {
          const spacing = pPr.getElementsByTagNameNS(ns, "spacing")[0];
          if (spacing) {
            const lineVal = spacing.getAttributeNS(ns, "line") || spacing.getAttribute("w:line");
            if (lineVal) styles.body.lineSpacing = parseInt(lineVal);
          }
        }
      }

      if (target && target !== "body" && target !== "pageMargin") {
        const tgt = styles[target] as { font?: string; size?: number; bold?: boolean };
        const rPr = el.getElementsByTagNameNS(ns, "rPr")[0];
        if (rPr) {
          const sz = rPr.getElementsByTagNameNS(ns, "sz")[0];
          if (sz) tgt.size = parseInt(sz.getAttributeNS(ns, "val") || sz.getAttribute("w:val") || "0");
          const rFonts = rPr.getElementsByTagNameNS(ns, "rFonts")[0];
          if (rFonts) {
            tgt.font = rFonts.getAttributeNS(ns, "eastAsia") || rFonts.getAttribute("w:eastAsia")
              || rFonts.getAttributeNS(ns, "ascii") || rFonts.getAttribute("w:ascii") || undefined;
          }
          const bold = rPr.getElementsByTagNameNS(ns, "b")[0];
          if (bold) {
            const bVal = bold.getAttributeNS(ns, "val") || bold.getAttribute("w:val");
            tgt.bold = bVal !== "0" && bVal !== "false";
          }
        }
      }
    }
  }

  // Parse section properties from document.xml for page margins
  const docXml = zip.file("word/document.xml");
  if (docXml) {
    const xml = await docXml.async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const sectPr = doc.getElementsByTagNameNS(ns, "sectPr");
    if (sectPr.length > 0) {
      const pgMar = sectPr[sectPr.length - 1].getElementsByTagNameNS(ns, "pgMar")[0];
      if (pgMar) {
        styles.pageMargin = {
          top: parseInt(pgMar.getAttributeNS(ns, "top") || pgMar.getAttribute("w:top") || "0") || undefined,
          bottom: parseInt(pgMar.getAttributeNS(ns, "bottom") || pgMar.getAttribute("w:bottom") || "0") || undefined,
          left: parseInt(pgMar.getAttributeNS(ns, "left") || pgMar.getAttribute("w:left") || "0") || undefined,
          right: parseInt(pgMar.getAttributeNS(ns, "right") || pgMar.getAttribute("w:right") || "0") || undefined,
        };
      }
    }
  }

  return styles;
}

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

interface CompanyMaterialMatch {
  id: string;
  file_name: string;
  file_path: string;
  material_type: string | null;
  content_description: string | null;
  expire_at: string | null;
  issued_at: string | null;
  certificate_number: string | null;
  issuing_authority: string | null;
  ai_status: string;
}

function getExpiryStatus(expireAt: string | null): {
  label: string;
  color: string;
  icon: typeof CheckCircle;
} {
  if (!expireAt) return { label: "长期有效", color: "bg-green-100 text-green-800", icon: ShieldCheck };
  const now = new Date();
  const expiry = new Date(expireAt);
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: `已过期${Math.abs(diffDays)}天`, color: "bg-red-100 text-red-800", icon: AlertCircle };
  if (diffDays <= 30) return { label: `${diffDays}天后过期`, color: "bg-yellow-100 text-yellow-800", icon: AlertTriangle };
  if (diffDays <= 90) return { label: `${diffDays}天后过期`, color: "bg-orange-100 text-orange-800", icon: Clock };
  return { label: `有效期至${expireAt}`, color: "bg-green-100 text-green-800", icon: ShieldCheck };
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
  const [autoFilling, setAutoFilling] = useState(false);
  const [companyMaterials, setCompanyMaterials] = useState<CompanyMaterialMatch[]>([]);
  const [materialMatchMap, setMaterialMatchMap] = useState<Map<string, CompanyMaterialMatch>>(new Map());
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateUploading, setTemplateUploading] = useState(false);
  const [templatePath, setTemplatePath] = useState<string | null>(null);
  const [templateStyles, setTemplateStyles] = useState<TemplateStyles | null>(null);
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

  const fetchCompanyMaterials = useCallback(async () => {
    if (!user) return [];
    const { data } = await supabase
      .from("company_materials")
      .select("id, file_name, file_path, material_type, content_description, expire_at, issued_at, certificate_number, issuing_authority, ai_status")
      .eq("user_id", user.id)
      .eq("ai_status", "completed");
    const cms = (data as CompanyMaterialMatch[]) || [];
    setCompanyMaterials(cms);
    return cms;
  }, [user]);

  const matchCompanyMaterials = useCallback((proposalMats: ProposalMaterial[], cms: CompanyMaterialMatch[]) => {
    const matchMap = new Map<string, CompanyMaterialMatch>();
    for (const pm of proposalMats) {
      const name = (pm.material_name || "").toLowerCase().trim();
      if (!name) continue;
      const match = cms.find((cm) => {
        const cmType = (cm.material_type || "").toLowerCase().trim();
        const cmDesc = (cm.content_description || "").toLowerCase().trim();
        // Direct containment checks
        if (cmType && (cmType === name || name.includes(cmType) || cmType.includes(name))) return true;
        if (cmDesc && (cmDesc.includes(name) || name.includes(cmDesc))) return true;
        // Keyword-based matching: extract key terms and check overlap
        // e.g. "ISO9001" in name matches "ISO9001" in description
        const keywords = name.match(/[a-z0-9]+|[\u4e00-\u9fa5]{2,}/gi) || [];
        for (const kw of keywords) {
          const kwLower = kw.toLowerCase();
          if (kwLower.length < 2) continue;
          // Match specific certificate identifiers like ISO9001, ISO27001, CMMI etc.
          if (/^(iso|cmmi|tmmi|gb)/i.test(kwLower) && (cmDesc.includes(kwLower) || cmType.includes(kwLower))) return true;
          if (kwLower === "营业执照" && (cmType.includes("营业执照") || cmDesc.includes("营业执照"))) return true;
        }
        return false;
      });
      if (match) matchMap.set(pm.id, match);
    }
    setMaterialMatchMap(matchMap);
  }, []);

  const fetchProposalDetails = useCallback(async (proposalId: string) => {
    const [{ data: secs }, { data: mats }, cms] = await Promise.all([
      supabase.from("proposal_sections").select("*").eq("proposal_id", proposalId).order("sort_order"),
      supabase.from("proposal_materials").select("*").eq("proposal_id", proposalId),
      fetchCompanyMaterials(),
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
    const proposalMats = (mats as any[]) || [];
    setMaterials(proposalMats);
    matchCompanyMaterials(proposalMats, cms);
  }, [fetchCompanyMaterials, matchCompanyMaterials]);

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

  const handleRegenerate = async (proposal: Proposal) => {
    if (!proposal.bid_analysis_id) {
      toast({ title: "无法重新生成", description: "缺少关联的招标解析", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      // Clear old sections & materials
      await Promise.all([
        supabase.from("proposal_sections").delete().eq("proposal_id", proposal.id),
        supabase.from("proposal_materials").delete().eq("proposal_id", proposal.id),
      ]);

      // Reset status
      await supabase.from("bid_proposals").update({
        ai_status: "processing",
        ai_progress: "正在准备数据...",
        outline_content: null,
        token_usage: null,
      } as any).eq("id", proposal.id);

      const updated = { ...proposal, ai_status: "processing", ai_progress: "正在准备数据...", outline_content: null, token_usage: null };
      setSelectedProposal(updated);
      setSections([]);
      setMaterials([]);
      fetchProposals();

      supabase.functions.invoke("bidding-assistant", {
        body: {
          action: "generate-outline",
          proposalId: proposal.id,
          bidAnalysisId: proposal.bid_analysis_id,
          customPrompt: proposal.custom_prompt || undefined,
        },
      }).then(({ error: fnErr }) => {
        if (fnErr) toast({ title: "生成失败", description: fnErr.message, variant: "destructive" });
      });

      toast({ title: "重新生成中", description: "请等待AI生成完成..." });
    } catch (e: any) {
      toast({ title: "重新生成失败", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
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

  const handleAutoFillMaterials = async () => {
    if (!user || !selectedProposal || materialMatchMap.size === 0) return;
    setAutoFilling(true);
    let filled = 0;
    try {
      for (const [pmId, cm] of materialMatchMap.entries()) {
        const pm = materials.find(m => m.id === pmId);
        // Skip already uploaded/matched items
        if (!pm || pm.status === "uploaded" || pm.status === "matched") continue;

        // Download company material file
        const { data: fileData, error: dlErr } = await supabase.storage
          .from("company-materials")
          .download(cm.file_path);
        if (dlErr || !fileData) {
          console.warn("Failed to download company material:", cm.file_path, dlErr);
          continue;
        }

        // Upload to proposal-materials bucket
        const ext = cm.file_name.split(".").pop() || "png";
        const destPath = `${user.id}/${selectedProposal.id}/${pmId}_${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("proposal-materials")
          .upload(destPath, fileData);
        if (upErr) {
          console.warn("Failed to upload to proposal-materials:", upErr);
          continue;
        }

        // Update proposal_materials record
        await supabase
          .from("proposal_materials")
          .update({ status: "uploaded", matched_file_path: destPath, matched_document_id: null })
          .eq("id", pmId);
        filled++;
      }

      toast({ title: "自动补齐完成", description: `已从公司材料库自动填充 ${filled} 项材料` });
      await fetchProposalDetails(selectedProposal.id);
    } catch (e: any) {
      toast({ title: "自动补齐失败", description: e.message, variant: "destructive" });
    } finally {
      setAutoFilling(false);
    }
  };

  const handleExportWord = async () => {
    if (!selectedProposal) return;
    const flatSections = flattenSections(sections);

    // Get format spec from AI output if available
    const formatSpec = parsedOutline?.format_spec || {};
    const projectTitle = selectedProposal.project_name || "投标文件";
    const ts = templateStyles; // parsed template styles

    // Priority: template styles > AI-detected > defaults
    const bodyFont = ts?.body?.font || formatSpec.font_name || "仿宋";
    const headingFont = ts?.heading1?.font || ts?.heading2?.font || formatSpec.font_name || "黑体";
    const bodySize = ts?.body?.size || parseInt(formatSpec.font_size_body) || 24;
    const titleSize = ts?.title?.size || parseInt(formatSpec.font_size_heading) || 44;
    const h1Size = ts?.heading1?.size || parseInt(formatSpec.font_size_heading) || 36;
    const h2Size = ts?.heading2?.size || 28;
    const h3Size = ts?.heading3?.size || 26;
    const h4Size = ts?.heading4?.size || bodySize;
    const h1Font = ts?.heading1?.font || headingFont;
    const h2Font = ts?.heading2?.font || headingFont;
    const h3Font = ts?.heading3?.font || headingFont;
    const titleFont = ts?.title?.font || headingFont;
    // Line spacing: template value (in twips) > AI value (multiplier) > default 1.5x
    const lineSpacing = ts?.body?.lineSpacing || Math.round((parseFloat(formatSpec.line_spacing) || 1.5) * 240);
    // Page margins from template
    const margins = ts?.pageMargin || {};
    const pgTop = margins.top || 1440;
    const pgBottom = margins.bottom || 1440;
    const pgLeft = margins.left || 1440;
    const pgRight = margins.right || 1440;

    const children: Paragraph[] = [
      new Paragraph({
        children: [new TextRun({ text: projectTitle, font: titleFont, size: titleSize, bold: true })],
        alignment: AlignmentType.CENTER,
        spacing: { line: lineSpacing },
      }),
      new Paragraph({ text: "" }),
    ];

    if (parsedOutline?.overall_strategy) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "投标策略建议", font: h1Font, size: h1Size, bold: true })],
          spacing: { line: lineSpacing },
        }),
        new Paragraph({
          children: [new TextRun({ text: parsedOutline.overall_strategy, font: bodyFont, size: bodySize })],
          spacing: { line: lineSpacing },
        }),
        new Paragraph({ text: "" }),
      );
    }

    children.push(new Paragraph({
      children: [new TextRun({ text: "投标文件提纲", font: h1Font, size: h1Size, bold: true })],
      spacing: { line: lineSpacing },
    }));

    for (const { section, depth } of flatSections) {
      const fontSize = depth === 0 ? h2Size : depth === 1 ? h3Size : depth === 2 ? h4Size : bodySize;
      const sectionFont = depth === 0 ? h2Font : depth === 1 ? h3Font : headingFont;
      const prefix = section.section_number ? `${section.section_number} ` : "";
      children.push(new Paragraph({
        children: [new TextRun({ text: `${prefix}${section.title}`, font: sectionFont, size: fontSize, bold: true })],
        spacing: { line: lineSpacing },
      }));
      if (section.content) {
        children.push(new Paragraph({
          children: [new TextRun({ text: section.content, font: bodyFont, size: bodySize })],
          spacing: { line: lineSpacing },
        }));
      }
    }

    if (parsedOutline?.personnel_plan?.length > 0) {
      children.push(new Paragraph({ text: "" }));
      children.push(new Paragraph({
        children: [new TextRun({ text: "人员配置建议", font: h1Font, size: h1Size, bold: true })],
        spacing: { line: lineSpacing },
      }));
      for (const p of parsedOutline.personnel_plan) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${p.role}`, bold: true, font: bodyFont, size: bodySize }),
            new TextRun({ text: ` — ${p.requirements || ""}`, font: bodyFont, size: bodySize }),
          ],
          spacing: { line: lineSpacing },
        }));
        if (p.suggested_candidate) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `  建议人选: ${p.suggested_candidate}`, font: bodyFont, size: bodySize })],
            spacing: { line: lineSpacing },
          }));
        }
      }
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: pgTop, bottom: pgBottom, left: pgLeft, right: pgRight },
          },
        },
        headers: formatSpec.page_header ? {
          default: {
            options: { children: [new Paragraph({ text: formatSpec.page_header || projectTitle, alignment: AlignmentType.CENTER })] },
          },
        } : undefined,
        children,
      }],
    });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${projectTitle}.docx`);
    toast({ title: "导出成功", description: "投标文件已导出为Word格式" });
  };

  const parsedOutline = selectedProposal?.outline_content
    ? (() => { try { return JSON.parse(selectedProposal.outline_content); } catch { return null; } })()
    : null;

  const hardMissing = materials.filter((m) => m.requirement_type === "hard" && m.status === "missing" && !materialMatchMap.has(m.id));
  const softMissing = materials.filter((m) => m.requirement_type === "soft" && m.status === "missing" && !materialMatchMap.has(m.id));
  const matched = materials.filter((m) => m.status === "matched" || m.status === "uploaded" || materialMatchMap.has(m.id));

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

  const renderMaterialItem = (m: ProposalMaterial, icon: React.ReactNode, bgClass: string) => {
    const companyMatch = materialMatchMap.get(m.id);
    const expiry = companyMatch ? getExpiryStatus(companyMatch.expire_at) : null;
    const ExpiryIcon = expiry?.icon;

    return (
    <div key={m.id} className={`flex items-start justify-between gap-3 text-sm p-3 rounded-lg border border-border/50 ${bgClass}`}>
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-foreground">{m.material_name || "未知材料"}</p>
            {expiry && ExpiryIcon && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${expiry.color}`}>
                <ExpiryIcon className="w-3 h-3" />
                {expiry.label}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-xs mt-1">{m.requirement_text}</p>
          {(m as any).material_format && (
            <p className="text-xs text-accent mt-1">📋 建议格式: {(m as any).material_format}</p>
          )}
          {companyMatch && (
            <p className="text-xs text-blue-600 mt-1.5 flex items-center gap-1 font-medium">
              <ImageIcon className="w-3 h-3" />
              公司材料库已有: {companyMatch.content_description || companyMatch.file_name}
              {companyMatch.certificate_number && <span className="text-muted-foreground ml-1">({companyMatch.certificate_number})</span>}
            </p>
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
        {companyMatch ? (
          <Badge variant="default" className="text-[10px]">✅ 已匹配公司材料</Badge>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
    );
  };

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
            <div>
              <label className="text-sm font-medium text-foreground">Word模板（可选）</label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">上传.docx模板文件，导出时将按模板的字体、字号、行间距格式生成。若不上传，则按招标文件要求或默认格式导出。</p>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    accept=".docx"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (!file.name.endsWith(".docx")) {
                        toast({ title: "格式错误", description: "仅支持.docx格式的模板文件", variant: "destructive" });
                        return;
                      }
                      setTemplateFile(file);
                      // Parse template styles
                      try {
                        const parsed = await parseTemplateStyles(file);
                        setTemplateStyles(parsed);
                        console.log("Parsed template styles:", parsed);
                      } catch (err) { console.warn("Failed to parse template styles:", err); }
                      // Upload to storage
                      if (user) {
                        setTemplateUploading(true);
                        try {
                          const ext = file.name.split('.').pop() || 'docx';
                          const path = `${user.id}/templates/${Date.now()}_template.${ext}`;
                          const { error: upErr } = await supabase.storage.from("proposal-materials").upload(path, file);
                          if (upErr) throw upErr;
                          setTemplatePath(path);
                          toast({ title: "模板上传成功", description: `已解析模板样式: ${file.name}` });
                        } catch (err: any) {
                          toast({ title: "模板上传失败", description: err.message, variant: "destructive" });
                          setTemplateFile(null);
                        } finally {
                          setTemplateUploading(false);
                        }
                      }
                      e.target.value = "";
                    }}
                  />
                  <Button variant="outline" size="sm" asChild disabled={templateUploading}>
                    <span>
                      {templateUploading ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />上传中...</>
                      ) : (
                        <><Upload className="w-3.5 h-3.5 mr-1" />选择模板文件</>
                      )}
                    </span>
                  </Button>
                </label>
                {templateFile && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <FileText className="w-3.5 h-3.5" />
                    <span>{templateFile.name}</span>
                    <button onClick={() => { setTemplateFile(null); setTemplatePath(null); setTemplateStyles(null); }} className="text-destructive hover:text-destructive/80">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
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
                          <span className="font-medium flex-1 break-words whitespace-normal">{p.project_name}</span>
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
          ) : selectedProposal.ai_status === "failed" ? (
            <Card className="flex items-center justify-center py-20">
              <div className="text-center space-y-4">
                <XCircle className="w-10 h-10 mx-auto text-destructive opacity-60" />
                <div>
                  <p className="text-sm font-medium text-foreground">提纲生成失败</p>
                  <p className="text-xs text-muted-foreground mt-1">{selectedProposal.ai_progress || "未知错误"}</p>
                </div>
                <Button onClick={() => handleRegenerate(selectedProposal)} disabled={generating}>
                  {generating ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />重新生成中...</> : <><RefreshCw className="w-4 h-4 mr-1" />重新生成</>}
                </Button>
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
                <div className="flex items-center justify-between flex-wrap gap-2">
                  {selectedProposal.token_usage && (
                    <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
                      <span>🔤 Prompt: {formatTokenCount(selectedProposal.token_usage.prompt_tokens)}</span>
                      <span>✍️ Completion: {formatTokenCount(selectedProposal.token_usage.completion_tokens)}</span>
                      <span className="font-medium text-foreground">📊 Total: {formatTokenCount(selectedProposal.token_usage.total_tokens)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" accept=".docx" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !file.name.endsWith(".docx")) { toast({ title: "仅支持.docx格式", variant: "destructive" }); return; }
                        setTemplateFile(file);
                        try {
                          const parsed = await parseTemplateStyles(file);
                          setTemplateStyles(parsed);
                        } catch (err) { console.warn("Failed to parse template styles:", err); }
                        if (user) {
                          setTemplateUploading(true);
                          try {
                            const ext = file.name.split('.').pop() || 'docx';
                            const path = `${user.id}/templates/${Date.now()}_template.${ext}`;
                            await supabase.storage.from("proposal-materials").upload(path, file);
                            setTemplatePath(path);
                            toast({ title: "模板已上传", description: `已解析模板样式: ${file.name}` });
                          } catch (err: any) { toast({ title: "上传失败", description: err.message, variant: "destructive" }); setTemplateFile(null); }
                          finally { setTemplateUploading(false); }
                        }
                        e.target.value = "";
                      }} />
                      <Button variant="ghost" size="sm" asChild disabled={templateUploading}>
                        <span>{templateFile ? <><FileText className="w-3.5 h-3.5 mr-1" />{templateFile.name}</> : <><Upload className="w-3.5 h-3.5 mr-1" />上传模板</>}</span>
                      </Button>
                    </label>
                    <Button variant="outline" size="sm" onClick={handleExportWord} disabled={sections.length === 0}>
                      <Download className="w-4 h-4 mr-1" />导出Word
                    </Button>
                  </div>
                </div>

                {parsedOutline?.format_spec && (parsedOutline.format_spec.font_name || parsedOutline.format_spec.line_spacing) && (
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-sm font-medium text-foreground mb-1">📐 招标文件格式要求</p>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {parsedOutline.format_spec.font_name && <span>字体: {parsedOutline.format_spec.font_name}</span>}
                        {parsedOutline.format_spec.font_size_body && <span>正文字号: {parsedOutline.format_spec.font_size_body}</span>}
                        {parsedOutline.format_spec.font_size_heading && <span>标题字号: {parsedOutline.format_spec.font_size_heading}</span>}
                        {parsedOutline.format_spec.line_spacing && <span>行间距: {parsedOutline.format_spec.line_spacing}</span>}
                        {parsedOutline.format_spec.page_header && <span>页眉: {parsedOutline.format_spec.page_header}</span>}
                      </div>
                    </CardContent>
                  </Card>
                )}

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
                    <div>
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
                    </div>
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
                  <div className="flex gap-2">
                    {materialMatchMap.size > 0 && (
                      <Button variant="default" size="sm" onClick={handleAutoFillMaterials} disabled={autoFilling}>
                        {autoFilling ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                        自动补齐 ({materialMatchMap.size})
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={handleCheckMaterials} disabled={checking}>
                      {checking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
                      重新检查
                    </Button>
                  </div>
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
