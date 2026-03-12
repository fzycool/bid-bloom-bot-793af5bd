import { useState, useEffect, useCallback, useRef } from "react";
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
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, FileText, CheckCircle, AlertTriangle, XCircle,
  RefreshCw, Users, ChevronRight, ChevronDown, Loader2,
  ClipboardCheck, Trash2, Search, Sparkles, Download, Upload, Paperclip,
  ShieldCheck, AlertCircle, Clock, Image as ImageIcon, UserPlus, X, ChevronLeft,
  Send, MessageSquare, PanelLeftClose, PanelRightClose,
  Pencil, MoreVertical, ChevronUp, FolderPlus, BookOpen,
  Pause, Play, Package,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Checkbox } from "@/components/ui/checkbox";
import TocDragEditor from "@/components/TocDragEditor";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Header, Footer, LevelFormat, convertInchesToTwip, LevelSuffix } from "docx";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import ProposalAssembler from "@/components/ProposalAssembler";

interface HeadingStyle {
  font?: string;
  size?: number;
  bold?: boolean;
  color?: string;
  spaceBefore?: number;
  spaceAfter?: number;
  lineSpacing?: number;
}

interface TemplateStyles {
  body: { font?: string; size?: number; lineSpacing?: number; spaceBefore?: number; spaceAfter?: number; color?: string };
  heading1: HeadingStyle;
  heading2: HeadingStyle;
  heading3: HeadingStyle;
  heading4: HeadingStyle;
  title: HeadingStyle;
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

    // Helper to extract color from rPr element (returns "000000" as default black)
    const extractColor = (rPr: Element): string => {
      const color = rPr.getElementsByTagNameNS(ns, "color")[0];
      if (color) {
        const val = color.getAttributeNS(ns, "val") || color.getAttribute("w:val") || color.getAttribute("val");
        if (val && val !== "auto" && val !== "windowText") return val;
        // Try themeColor mapping
        const themeColor = color.getAttributeNS(ns, "themeColor") || color.getAttribute("w:themeColor") || color.getAttribute("themeColor");
        const themeMap: Record<string, string> = {
          dark1: "000000", dark2: "44546A", light1: "FFFFFF", light2: "E7E6E6",
          accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000",
          accent5: "5B9BD5", accent6: "70AD47", hyperlink: "0563C1", followedHyperlink: "954F72",
          text1: "000000", text2: "44546A", background1: "FFFFFF", background2: "E7E6E6",
        };
        if (themeColor && themeMap[themeColor]) return themeMap[themeColor];
      }
      return "000000"; // default black
    };

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
          const c = extractColor(rPr);
          if (c) styles.body.color = c;
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
          const c = extractColor(rPr);
          if (c) styles.body.color = c;
        }
        const pPr = el.getElementsByTagNameNS(ns, "pPr")[0];
        if (pPr) {
          const spacing = pPr.getElementsByTagNameNS(ns, "spacing")[0];
          if (spacing) {
            const lineVal = spacing.getAttributeNS(ns, "line") || spacing.getAttribute("w:line");
            if (lineVal) styles.body.lineSpacing = parseInt(lineVal);
            const beforeVal = spacing.getAttributeNS(ns, "before") || spacing.getAttribute("w:before");
            if (beforeVal) styles.body.spaceBefore = parseInt(beforeVal);
            const afterVal = spacing.getAttributeNS(ns, "after") || spacing.getAttribute("w:after");
            if (afterVal) styles.body.spaceAfter = parseInt(afterVal);
          }
        }
      }

      if (target && target !== "body" && target !== "pageMargin") {
        const tgt = styles[target] as HeadingStyle;
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
          const c = extractColor(rPr);
          if (c) tgt.color = c;
        }
        // Extract paragraph spacing for headings
        const pPr = el.getElementsByTagNameNS(ns, "pPr")[0];
        if (pPr) {
          const spacing = pPr.getElementsByTagNameNS(ns, "spacing")[0];
          if (spacing) {
            const beforeVal = spacing.getAttributeNS(ns, "before") || spacing.getAttribute("w:before");
            if (beforeVal) tgt.spaceBefore = parseInt(beforeVal);
            const afterVal = spacing.getAttributeNS(ns, "after") || spacing.getAttribute("w:after");
            if (afterVal) tgt.spaceAfter = parseInt(afterVal);
            const lineVal = spacing.getAttributeNS(ns, "line") || spacing.getAttribute("w:line");
            if (lineVal) tgt.lineSpacing = parseInt(lineVal);
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

  // Ensure all styles have a color (default to black)
  if (!styles.body.color) styles.body.color = "000000";
  if (!styles.title.color) styles.title.color = "000000";
  if (!styles.heading1.color) styles.heading1.color = "000000";
  if (!styles.heading2.color) styles.heading2.color = "000000";
  if (!styles.heading3.color) styles.heading3.color = "000000";
  if (!styles.heading4.color) styles.heading4.color = "000000";

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
  user_id: string;
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

interface TocEntry {
  id: string;
  parent_section_id: string | null;
  title: string;
  content: string | null;
  section_number: string | null;
  sort_order: number;
}

export default function BiddingAssistant() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [analyses, setAnalyses] = useState<BidAnalysis[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const [tocSections, setTocSections] = useState<ProposalSection[]>([]);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [materials, setMaterials] = useState<ProposalMaterial[]>([]);

  const [creating, setCreating] = useState(false);
  const [selectedBidId, setSelectedBidId] = useState("");
  const [projectName, setProjectName] = useState("");
  const defaultOutlinePrompt = `提纲的获取来源：
1. 投标人须知——投标文件构成；
2. 投标人须知前附表/前附表——投标文件构成/组成/投标文件应包括但不限于；
3. 投标文件格式；
4. 资格要求；
5. 评分标准/评分表

要求：
a) 顺序：有明确要求的按要求执行，没有明确要求的按结构清晰的执行；
b) 内容：结构需包含来源的所有内容；如投标文件格式有对应内容，需匹配到文档中；
c) 字体：有明确要求的按要求执行，没有明确要求按文档模板执行，文档标题及页眉需匹配项目名称；`;
  const [customPrompt, setCustomPrompt] = useState(defaultOutlinePrompt);
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
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [docStatus, setDocStatus] = useState<string>("pending");
  const [docProgress, setDocProgress] = useState<string | null>(null);
  const [tocStatus, setTocStatus] = useState<string>("pending");
  const [tocProgress, setTocProgress] = useState<string | null>(null);
  const [generatingToc, setGeneratingToc] = useState(false);
  const [organizingToc, setOrganizingToc] = useState(false);
  const [activeTab, setActiveTab] = useState("outline");
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [highlightedText, setHighlightedText] = useState<string | null>(null);
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);
  const [viewingTocSection, setViewingTocSection] = useState<ProposalSection | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const centerPanelRef = useRef<HTMLDivElement>(null);
  const [collaborators, setCollaborators] = useState<{ id: string; user_id: string; email?: string; full_name?: string }[]>([]);
  const [platformUsers, setPlatformUsers] = useState<{ user_id: string; full_name: string | null; email?: string }[]>([]);
  const [showCollabDialog, setShowCollabDialog] = useState(false);
  const [collabSearch, setCollabSearch] = useState("");
  const [addingCollab, setAddingCollab] = useState(false);
  const [outlineEditId, setOutlineEditId] = useState<string | null>(null);
  const [outlineEditTitle, setOutlineEditTitle] = useState("");
  const [outlineAddParentId, setOutlineAddParentId] = useState<string | null | "root">(null);
  const [outlineAddTitle, setOutlineAddTitle] = useState("");
  const [outlineAddNumber, setOutlineAddNumber] = useState("");
  const [showTocImportDialog, setShowTocImportDialog] = useState(false);
  const [tocImportSources, setTocImportSources] = useState<{ id: string; name: string; category: string | null; toc: any[] }[]>([]);
  const [importingToc, setImportingToc] = useState(false);
  const [selectedImportSource, setSelectedImportSource] = useState<{ id: string; name: string; category: string | null; toc: any[] } | null>(null);
  const [selectedImportChapters, setSelectedImportChapters] = useState<Set<number>>(new Set());
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
    // Fetch own proposals
    const { data: own } = await supabase
      .from("bid_proposals")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    // Fetch collaborated proposals
    const { data: collabRows } = await supabase
      .from("bid_collaborators")
      .select("proposal_id")
      .eq("user_id", user.id);

    let collabProposals: any[] = [];
    if (collabRows && collabRows.length > 0) {
      const ids = collabRows.map((c: any) => c.proposal_id);
      const { data } = await supabase
        .from("bid_proposals")
        .select("*")
        .in("id", ids)
        .order("created_at", { ascending: false });
      collabProposals = (data as any[]) || [];
    }

    // Merge and deduplicate
    const allMap = new Map<string, any>();
    for (const p of [...(own || []), ...collabProposals]) {
      if (!allMap.has(p.id)) allMap.set(p.id, p);
    }
    const all = Array.from(allMap.values()).sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setProposals(all);
  }, [user]);

  const fetchCollaborators = useCallback(async (proposalId: string) => {
    const { data: collabs } = await supabase
      .from("bid_collaborators")
      .select("id, user_id")
      .eq("proposal_id", proposalId);
    if (!collabs || collabs.length === 0) { setCollaborators([]); return; }

    // Fetch profile info for collaborators
    const userIds = collabs.map((c: any) => c.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
    setCollaborators(collabs.map((c: any) => ({
      id: c.id,
      user_id: c.user_id,
      full_name: profileMap.get(c.user_id)?.full_name || "未知用户",
    })));
  }, []);

  const fetchPlatformUsers = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .eq("is_approved", true)
      .neq("user_id", user.id);
    setPlatformUsers((data as any[]) || []);
  }, [user]);

  const handleAddCollaborator = async (targetUserId: string) => {
    if (!user || !selectedProposal) return;
    setAddingCollab(true);
    try {
      const { error } = await supabase.from("bid_collaborators").insert({
        proposal_id: selectedProposal.id,
        user_id: targetUserId,
        invited_by: user.id,
      } as any);
      if (error) throw error;
      toast({ title: "添加成功", description: "已添加协作者" });
      fetchCollaborators(selectedProposal.id);
    } catch (e: any) {
      toast({ title: "添加失败", description: e.message, variant: "destructive" });
    } finally {
      setAddingCollab(false);
    }
  };

  const handleRemoveCollaborator = async (collabId: string) => {
    if (!selectedProposal) return;
    await supabase.from("bid_collaborators").delete().eq("id", collabId);
    toast({ title: "已移除协作者" });
    fetchCollaborators(selectedProposal.id);
  };

  // ---- Outline CRUD handlers ----
  const handleOutlineAdd = async (parentId: string | null) => {
    if (!selectedProposal || !outlineAddTitle.trim()) return;
    const flat = flattenSections(sections);
    // Compute sort_order: max + 1 among siblings
    const siblings = flat.filter(f => f.section.parent_id === parentId);
    const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(f => f.section.sort_order)) : -1;
    const { error } = await supabase.from("proposal_sections").insert({
      proposal_id: selectedProposal.id,
      title: outlineAddTitle.trim(),
      section_number: outlineAddNumber.trim() || null,
      parent_id: parentId,
      sort_order: maxOrder + 1,
    } as any);
    if (error) { toast({ title: "添加失败", description: error.message, variant: "destructive" }); return; }
    toast({ title: "已添加章节" });
    setOutlineAddParentId(null);
    setOutlineAddTitle("");
    setOutlineAddNumber("");
    fetchProposalDetails(selectedProposal.id);
  };

  const handleOutlineRename = async (sectionId: string) => {
    if (!outlineEditTitle.trim()) return;
    const { error } = await supabase.from("proposal_sections").update({ title: outlineEditTitle.trim() }).eq("id", sectionId);
    if (error) { toast({ title: "修改失败", description: error.message, variant: "destructive" }); return; }
    // Update local state
    const updateTitle = (list: ProposalSection[]): ProposalSection[] =>
      list.map(s => ({
        ...s,
        title: s.id === sectionId ? outlineEditTitle.trim() : s.title,
        children: s.children ? updateTitle(s.children) : undefined,
      }));
    setSections(updateTitle(sections));
    setOutlineEditId(null);
    setOutlineEditTitle("");
    toast({ title: "已修改章节名称" });
  };

  const handleOutlineDelete = async (sectionId: string) => {
    if (!selectedProposal) return;
    // Delete the section and all its children (cascade via parent_id)
    // First collect all descendant IDs
    const collectIds = (list: ProposalSection[], targetId: string): string[] => {
      const ids: string[] = [];
      for (const s of list) {
        if (s.id === targetId) {
          ids.push(s.id);
          if (s.children) {
            const collectChildren = (children: ProposalSection[]) => {
              for (const c of children) {
                ids.push(c.id);
                if (c.children) collectChildren(c.children);
              }
            };
            collectChildren(s.children);
          }
        } else if (s.children) {
          ids.push(...collectIds(s.children, targetId));
        }
      }
      return ids;
    };
    const idsToDelete = collectIds(sections, sectionId);
    if (idsToDelete.length === 0) return;
    const { error } = await supabase.from("proposal_sections").delete().in("id", idsToDelete);
    if (error) { toast({ title: "删除失败", description: error.message, variant: "destructive" }); return; }
    toast({ title: "已删除章节", description: idsToDelete.length > 1 ? `包含 ${idsToDelete.length - 1} 个子章节` : undefined });
    fetchProposalDetails(selectedProposal.id);
  };

  const handleOutlineMove = async (sectionId: string, direction: "up" | "down") => {
    if (!selectedProposal) return;
    const flat = flattenSections(sections);
    const target = flat.find(f => f.section.id === sectionId);
    if (!target) return;
    const siblings = flat.filter(f => f.section.parent_id === target.section.parent_id)
      .sort((a, b) => a.section.sort_order - b.section.sort_order);
    const idx = siblings.findIndex(f => f.section.id === sectionId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const a = siblings[idx].section;
    const b = siblings[swapIdx].section;
    await Promise.all([
      supabase.from("proposal_sections").update({ sort_order: b.sort_order } as any).eq("id", a.id),
      supabase.from("proposal_sections").update({ sort_order: a.sort_order } as any).eq("id", b.id),
    ]);
    fetchProposalDetails(selectedProposal.id);
  };

  // ---- Import TOC from company materials ----
  const handleFetchTocSources = async () => {
    if (!user) {
      toast({ title: "请先登录", variant: "destructive" });
      return;
    }
    try {
      const { data, error } = await supabase
        .from("bid_analyses")
        .select("id, project_name, project_category, document_structure")
        .not("document_structure", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const sources = (data || [])
        .filter((a: any) => Array.isArray(a.document_structure) && a.document_structure.length > 0)
        .map((a: any) => ({
          id: a.id,
          name: a.project_name || "未命名项目",
          category: a.project_category || null,
          toc: a.document_structure,
        }));
      setTocImportSources(sources);
      setSelectedImportSource(null);
      setSelectedImportChapters(new Set());
      setShowTocImportDialog(true);
    } catch (err: any) {
      console.error("fetchTocSources error:", err);
      toast({ title: "加载目录列表失败", description: err.message, variant: "destructive" });
    }
  };

  const handleImportToc = async (source: { id: string; name: string; toc: any[] }, chapterIndices?: Set<number>) => {
    const filteredToc = chapterIndices && chapterIndices.size > 0
      ? source.toc.filter((_: any, i: number) => chapterIndices.has(i))
      : source.toc;
    if (!selectedProposal || !filteredToc.length) return;
    setImportingToc(true);
    try {
      // Collect all existing outline section titles for deduplication
      const collectTitles = (nodes: ProposalSection[]): string[] => {
        const titles: string[] = [];
        for (const n of nodes) {
          titles.push(n.title.trim().replace(/\s+/g, ''));
          if (n.children) titles.push(...collectTitles(n.children));
        }
        return titles;
      };
      const outlineTitles = new Set(collectTitles(sections).map(t => t.toLowerCase()));

      // Helper: check if an imported title is similar to any existing outline title
      const isSimilar = (importedTitle: string): boolean => {
        const normalized = importedTitle.trim().replace(/\s+/g, '').toLowerCase();
        if (!normalized) return false;
        for (const ot of outlineTitles) {
          if (ot === normalized) return true;
          // Containment check (one contains the other)
          if (ot.length >= 3 && normalized.length >= 3) {
            if (ot.includes(normalized) || normalized.includes(ot)) return true;
          }
        }
        return false;
      };

      // Filter out chapters that conflict with existing outline
      const dedupedToc = filteredToc.filter((ch: any) => !isSimilar(ch.title));
      const skippedCount = filteredToc.length - dedupedToc.length;

      if (dedupedToc.length === 0) {
        toast({ title: "导入完成", description: `所有 ${filteredToc.length} 个章节与现有提纲重复，已全部跳过` });
        setShowTocImportDialog(false);
        setImportingToc(false);
        return;
      }

      // For hierarchical import: group by level
      const level1 = dedupedToc.filter((ch: any) => (ch.level || 1) === 1);
      const level2Plus = dedupedToc.filter((ch: any) => (ch.level || 1) > 1);

      // Insert level-1 sections
      const level1Inserts = level1.map((ch: any, idx: number) => ({
        proposal_id: selectedProposal.id,
        title: ch.title,
        section_number: ch.section_number || null,
        parent_id: null,
        sort_order: idx,
        source_type: "toc_imported",
      }));

      const { data: insertedL1, error: l1Err } = await supabase
        .from("proposal_sections")
        .insert(level1Inserts as any)
        .select("id, section_number, title, sort_order");
      if (l1Err) throw l1Err;

      // Build a map from section_number prefix to parent ID for sub-levels
      const parentMap = new Map<string, string>();
      for (const row of (insertedL1 || []) as any[]) {
        if (row.section_number) parentMap.set(row.section_number, row.id);
      }

      // Insert sub-level sections
      if (level2Plus.length > 0) {
        const subInserts = level2Plus.map((ch: any, idx: number) => {
          let parentId: string | null = null;
          const num = ch.section_number || "";
          const parts = num.split(/[.、-]/);
          if (parts.length > 1) {
            for (let len = parts.length - 1; len >= 1; len--) {
              const prefix = parts.slice(0, len).join(".");
              const prefixAlt = parts.slice(0, len).join("、");
              if (parentMap.has(prefix)) { parentId = parentMap.get(prefix)!; break; }
              if (parentMap.has(prefixAlt)) { parentId = parentMap.get(prefixAlt)!; break; }
            }
          }
          return {
            proposal_id: selectedProposal.id,
            title: ch.title,
            section_number: ch.section_number || null,
            parent_id: parentId,
            sort_order: 100 + idx,
            source_type: "toc_imported",
          };
        });

        const { data: insertedSub, error: subErr } = await supabase
          .from("proposal_sections")
          .insert(subInserts as any)
          .select("id, section_number");
        if (subErr) throw subErr;

        for (const row of (insertedSub || []) as any[]) {
          if (row.section_number) parentMap.set(row.section_number, row.id);
        }
      }

      // Mark TOC as completed after successful import
      await supabase.from("bid_proposals").update({
        toc_status: "completed",
        toc_progress: null,
      } as any).eq("id", selectedProposal.id);
      setTocStatus("completed");
      setTocProgress(null);

      const desc = skippedCount > 0
        ? `已导入 ${dedupedToc.length} 个章节，跳过 ${skippedCount} 个与提纲重复的章节`
        : `已从「${source.name}」导入 ${dedupedToc.length} 个章节`;
      toast({ title: "导入成功", description: desc });
      setShowTocImportDialog(false);
      fetchProposalDetails(selectedProposal.id);
    } catch (e: any) {
      toast({ title: "导入失败", description: e.message, variant: "destructive" });
    } finally {
      setImportingToc(false);
    }
  };

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
    const [{ data: secs }, { data: mats }, { data: tocData }, cms] = await Promise.all([
      supabase.from("proposal_sections").select("*").eq("proposal_id", proposalId).order("sort_order"),
      supabase.from("proposal_materials").select("*").eq("proposal_id", proposalId),
      supabase.from("proposal_toc_entries").select("*").eq("proposal_id", proposalId).order("sort_order"),
      fetchCompanyMaterials(),
    ]);

    // Build tree helper
    const buildTree = (sectionList: any[]) => {
      const roots: ProposalSection[] = [];
      const map = new Map<string, ProposalSection>();
      sectionList.forEach((s) => { map.set(s.id, { ...s, children: [] }); });
      sectionList.forEach((s) => {
        const node = map.get(s.id)!;
        if (s.parent_id && map.has(s.parent_id)) {
          map.get(s.parent_id)!.children!.push(node);
        } else {
          roots.push(node);
        }
      });
      return roots;
    };

    // Outline: exclude toc_generated and toc_imported
    const outlineSections = ((secs as any[]) || []).filter((s: any) => s.source_type !== "toc_generated" && s.source_type !== "toc_imported");
    setSections(buildTree(outlineSections));

    // TOC sections: include toc_imported but still exclude toc_generated; also include original outline sections for TOC view
    const allForToc = ((secs as any[]) || []).filter((s: any) => s.source_type !== "toc_generated");
    setTocSections(buildTree(allForToc));
    // Filter out internal marker entries (e.g. __NO_KB_MATCH__)
    setTocEntries(((tocData as TocEntry[]) || []).filter(e => e.title !== "__NO_KB_MATCH__"));
    const proposalMats = (mats as any[]) || [];
    setMaterials(proposalMats);
    matchCompanyMaterials(proposalMats, cms);

    // Auto-correct tocStatus: if TOC entries or toc_imported sections exist
    const tocList = ((tocData as TocEntry[]) || []).filter(e => e.title !== "__NO_KB_MATCH__");
    const importedSections = ((secs as any[]) || []).filter((s: any) => s.source_type === "toc_imported");
    if (tocList.length > 0 || importedSections.length > 0) {
      const currentTocStatus = tocStatus;
      if (currentTocStatus !== "processing" && currentTocStatus !== "completed") {
        setTocStatus("completed");
        setTocProgress(null);
        supabase.from("bid_proposals").update({
          toc_status: "completed",
          toc_progress: null,
        } as any).eq("id", proposalId);
      }
    }
  }, [fetchCompanyMaterials, matchCompanyMaterials, tocStatus]);

  useEffect(() => { fetchAnalyses(); fetchProposals(); }, [fetchAnalyses, fetchProposals]);

  // Poll for progress when a proposal is processing
  useEffect(() => {
    if (!selectedProposal || selectedProposal.ai_status !== "processing") return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("bid_proposals")
        .select("ai_status, ai_progress, token_usage, outline_content")
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

  const lastSyncedProposalId = useRef<string | null>(null);
  useEffect(() => {
    if (selectedProposal) {
      fetchProposalDetails(selectedProposal.id);
      fetchCollaborators(selectedProposal.id);
      setCustomPrompt(selectedProposal.custom_prompt || "");
      if (lastSyncedProposalId.current !== selectedProposal.id) {
        lastSyncedProposalId.current = selectedProposal.id;
        setDocStatus((selectedProposal as any).proposal_doc_status || "pending");
        setDocProgress((selectedProposal as any).proposal_doc_progress || null);
        setTocStatus((selectedProposal as any).toc_status || "pending");
        setTocProgress((selectedProposal as any).toc_progress || null);
        setActiveTab("outline");
      }
    }
  }, [selectedProposal?.id, fetchProposalDetails]);

  // Poll for proposal doc generation progress (UI refresh only, client drives the loop)
  useEffect(() => {
    if (!selectedProposal || docStatus !== "processing") return;
    let pollCount = 0;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("bid_proposals")
        .select("proposal_doc_status, proposal_doc_progress")
        .eq("id", selectedProposal.id)
        .single();
      if (data) {
        const d = data as any;
        setDocStatus(d.proposal_doc_status || "pending");
        setDocProgress(d.proposal_doc_progress || null);
        if (d.proposal_doc_status !== "processing") {
          clearInterval(interval);
          if (d.proposal_doc_status === "completed") {
            fetchProposalDetails(selectedProposal.id);
          }
          return;
        }
      }
      // Refresh sections every 3rd poll to show real-time content updates
      pollCount++;
      if (pollCount % 3 === 0) {
        fetchProposalDetails(selectedProposal.id);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedProposal?.id, docStatus, fetchProposalDetails]);

  // Poll for TOC generation progress + refresh sections in real-time
  // Detect stale progress (function timeout) and auto-recover
  useEffect(() => {
    if (!selectedProposal || tocStatus !== "processing") return;
    let lastProgress = "";
    let staleCount = 0;
    const MAX_STALE = 20; // 20 * 3s = 60s without progress change → auto-pause
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("bid_proposals")
        .select("toc_status, toc_progress")
        .eq("id", selectedProposal.id)
        .single();
      if (data) {
        const d = data as any;
        setTocStatus(d.toc_status || "pending");
        setTocProgress(d.toc_progress || null);
        fetchProposalDetails(selectedProposal.id);
        if (d.toc_status !== "processing") {
          clearInterval(interval);
          return;
        }
        // Detect stale: progress unchanged for too long means function died
        if (d.toc_progress === lastProgress) {
          staleCount++;
          if (staleCount >= MAX_STALE) {
            console.warn("TOC generation appears stale, auto-pausing");
            await supabase.from("bid_proposals").update({
              toc_status: "paused",
              toc_progress: `${d.toc_progress} (函数超时，请点击继续)`,
            } as any).eq("id", selectedProposal.id);
            setTocStatus("paused");
            setTocProgress(`${d.toc_progress} (函数超时，请点击继续)`);
            clearInterval(interval);
          }
        } else {
          lastProgress = d.toc_progress || "";
          staleCount = 0;
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedProposal?.id, tocStatus, fetchProposalDetails]);

  const handleGenerateToc = async (resume = false) => {
    if (!selectedProposal) return;
    setGeneratingToc(true);
    setTocStatus("processing");
    setTocProgress(resume ? "正在继续生成..." : "正在登录知识库...");
    setActiveTab("toc");
    try {
      // If resuming from pause, just set status back to processing so the next invoke picks up
      if (resume) {
        await supabase.from("bid_proposals").update({
          toc_status: "processing",
          toc_progress: "正在继续生成...",
        } as any).eq("id", selectedProposal.id);
      }
      const { error } = await supabase.functions.invoke("generate-toc", {
        body: { proposalId: selectedProposal.id, resume },
      });
      if (error) throw error;
      // Don't reset tocStatus here - polling will handle the state transitions
    } catch (e: any) {
      toast({ title: "目录生成失败", description: e.message, variant: "destructive" });
      setTocStatus("failed");
      setTocProgress(e.message);
    } finally {
      setGeneratingToc(false);
    }
  };

  const handlePauseToc = async () => {
    if (!selectedProposal) return;
    try {
      await supabase.from("bid_proposals").update({
        toc_status: "paused",
      } as any).eq("id", selectedProposal.id);
      setTocStatus("paused");
      toast({ title: "已暂停", description: "标书目录生成已暂停" });
    } catch (e: any) {
      toast({ title: "操作失败", description: e.message, variant: "destructive" });
    }
  };

  const handleCancelToc = async () => {
    if (!selectedProposal) return;
    try {
      await supabase.from("bid_proposals").update({
        toc_status: "cancelled",
      } as any).eq("id", selectedProposal.id);
      setTocStatus("cancelled");
      toast({ title: "已取消", description: "标书目录生成已取消" });
    } catch (e: any) {
      toast({ title: "操作失败", description: e.message, variant: "destructive" });
    }
  };

  const handleGenerateProposal = async (resume = false) => {
    if (!selectedProposal) return;
    setGeneratingDoc(true);
    setDocStatus("processing");
    setDocProgress(resume ? "正在继续编写..." : "正在准备数据...");
    setActiveTab("proposal");
    setWorkspaceMode(true);
    try {
      // Step 1: Init — get list of root sections
      const { data: rawInitData, error: initError } = await supabase.functions.invoke("generate-proposal", {
        body: { proposalId: selectedProposal.id },
      });
      if (initError) throw initError;
      // supabase.functions.invoke may return data as string or object
      const initData = typeof rawInitData === "string" ? JSON.parse(rawInitData) : rawInitData;
      console.log("Init response:", initData);
      const sectionsToGenerate = initData?.sections || [];
      const total = sectionsToGenerate.length;
      if (total === 0) throw new Error("没有找到需要生成的章节");

      // Step 2: Generate each section one by one
      for (let i = 0; i < total; i++) {
        const sec = sectionsToGenerate[i];

        // Skip sections that already have content when resuming
        if (resume && sec.hasContent) {
          setDocProgress(`跳过已完成章节: ${sec.section_number || ""} ${sec.title} (${i + 1}/${total})`);
          continue;
        }

        // Check if paused/cancelled before each call
        const { data: statusCheck } = await supabase.from("bid_proposals")
          .select("proposal_doc_status").eq("id", selectedProposal.id).single();
        if (statusCheck?.proposal_doc_status === "paused") {
          setDocStatus("paused");
          setDocProgress(`已暂停 (已完成 ${i}/${total} 个章节)`);
          await supabase.from("bid_proposals").update({
            proposal_doc_progress: `已暂停 (已完成 ${i}/${total} 个章节)`,
          }).eq("id", selectedProposal.id);
          return;
        }
        if (statusCheck?.proposal_doc_status === "cancelled" || statusCheck?.proposal_doc_status === "pending") {
          // Clean up
          await supabase.from("proposal_sections").update({ content: null }).eq("proposal_id", selectedProposal.id);
          await supabase.from("bid_proposals").update({
            proposal_doc_status: "pending", proposal_doc_progress: null,
          }).eq("id", selectedProposal.id);
          setDocStatus("pending");
          setDocProgress(null);
          fetchProposalDetails(selectedProposal.id);
          return;
        }

        setDocProgress(`正在编写: ${sec.section_number || ""} ${sec.title} (${i + 1}/${total})`);
        await supabase.from("bid_proposals").update({
          proposal_doc_progress: `正在编写: ${sec.section_number || ""} ${sec.title} (${i + 1}/${total})`,
        }).eq("id", selectedProposal.id);

        const { data: rawResult, error: secError } = await supabase.functions.invoke("generate-proposal", {
          body: { proposalId: selectedProposal.id, sectionId: sec.id },
        });

        if (secError) {
          console.error(`Section ${sec.section_number} failed:`, secError);
          continue;
        }

        const result = typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;

        if (result?.status === "paused") {
          setDocStatus("paused");
          setDocProgress(`已暂停 (已完成 ${i}/${total} 个章节)`);
          return;
        }
        if (result?.status === "cancelled") {
          setDocStatus("pending");
          setDocProgress(null);
          fetchProposalDetails(selectedProposal.id);
          return;
        }

        // Brief delay between sections to avoid rate limiting
        if (i < total - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      // All done
      await supabase.from("bid_proposals").update({
        proposal_doc_status: "completed",
        proposal_doc_progress: null,
      }).eq("id", selectedProposal.id);
      setDocStatus("completed");
      setDocProgress(null);
      fetchProposalDetails(selectedProposal.id);
      toast({ title: "编写完成", description: "标书文档已全部生成" });
    } catch (e: any) {
      toast({ title: "生成失败", description: e.message, variant: "destructive" });
      setDocStatus("failed");
      setDocProgress(e.message);
      await supabase.from("bid_proposals").update({
        proposal_doc_status: "failed",
        proposal_doc_progress: e.message,
      }).eq("id", selectedProposal.id);
    } finally {
      setGeneratingDoc(false);
    }
  };

  const handlePauseProposal = async () => {
    if (!selectedProposal) return;
    await supabase.from("bid_proposals").update({
      proposal_doc_status: "paused",
    }).eq("id", selectedProposal.id);
    setDocStatus("paused");
    toast({ title: "已暂停", description: "标书编写已暂停，可随时继续" });
  };

  const handleCancelProposal = async () => {
    if (!selectedProposal) return;
    // Set to cancelled so background function detects and clears content
    await supabase.from("bid_proposals").update({
      proposal_doc_status: "cancelled",
    }).eq("id", selectedProposal.id);
    // Also clear section contents immediately on client side
    await supabase.from("proposal_sections")
      .update({ content: null })
      .eq("proposal_id", selectedProposal.id);
    await supabase.from("bid_proposals").update({
      proposal_doc_status: "pending",
      proposal_doc_progress: null,
    }).eq("id", selectedProposal.id);
    setDocStatus("pending");
    setDocProgress(null);
    fetchProposalDetails(selectedProposal.id);
    toast({ title: "已撤销", description: "标书编写已撤销，已生成的内容已清除" });
  };

  const handleCreate = async () => {
    if (!user || !selectedBidId) return;
    setGenerating(true);
    try {
      const bid = analyses.find((a) => a.id === selectedBidId);
      const name = projectName.trim() || bid?.project_name || "未命名标书";

      const { data: proposal, error } = await supabase
        .from("bid_proposals")
        .insert({
          user_id: user.id,
          bid_analysis_id: selectedBidId,
          project_name: name,
          custom_prompt: customPrompt.trim() || null,
          ai_status: "processing",
          ai_progress: "正在准备数据...",
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
      setTocSections([]);
      setTocEntries([]);
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
    try {
      // Delete all child records first to avoid FK constraint errors
      await Promise.all([
        supabase.from("proposal_toc_entries").delete().eq("proposal_id", id),
        supabase.from("proposal_materials").delete().eq("proposal_id", id),
        supabase.from("proposal_sections").delete().eq("proposal_id", id),
        supabase.from("bid_collaborators").delete().eq("proposal_id", id),
        supabase.from("audit_reports").delete().eq("proposal_id", id),
      ]);
      const { error } = await supabase.from("bid_proposals").delete().eq("id", id);
      if (error) throw error;
      if (selectedProposal?.id === id) {
        setSelectedProposal(null);
        setSections([]);
        setTocSections([]);
        setTocEntries([]);
        setMaterials([]);
      }
      fetchProposals();
    } catch (err: any) {
      toast({ title: "删除失败", description: err.message, variant: "destructive" });
    }
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
    const bodySize = ts?.body?.size || parseInt(formatSpec.font_size_body) || 24;
    const bodyLineSpacing = ts?.body?.lineSpacing || Math.round((parseFloat(formatSpec.line_spacing) || 1.5) * 240);
    const bodySpaceBefore = ts?.body?.spaceBefore || 0;
    const bodySpaceAfter = ts?.body?.spaceAfter || 0;
    const bodyColor = ts?.body?.color || undefined;

    const titleFont = ts?.title?.font || formatSpec.font_name || "黑体";
    const titleSize = ts?.title?.size || parseInt(formatSpec.font_size_heading) || 44;
    const titleBold = ts?.title?.bold !== false;
    const titleSpaceBefore = ts?.title?.spaceBefore || 0;
    const titleSpaceAfter = ts?.title?.spaceAfter || 120;
    const titleLineSpacing = ts?.title?.lineSpacing || bodyLineSpacing;
    const titleColor = ts?.title?.color || undefined;

    const h1Font = ts?.heading1?.font || formatSpec.font_name || "黑体";
    const h1Size = ts?.heading1?.size || parseInt(formatSpec.font_size_heading) || 36;
    const h1Bold = ts?.heading1?.bold !== false;
    const h1SpaceBefore = ts?.heading1?.spaceBefore || 240;
    const h1SpaceAfter = ts?.heading1?.spaceAfter || 120;
    const h1LineSpacing = ts?.heading1?.lineSpacing || bodyLineSpacing;
    const h1Color = ts?.heading1?.color || undefined;

    const h2Font = ts?.heading2?.font || h1Font;
    const h2Size = ts?.heading2?.size || 28;
    const h2Bold = ts?.heading2?.bold !== false;
    const h2SpaceBefore = ts?.heading2?.spaceBefore || 200;
    const h2SpaceAfter = ts?.heading2?.spaceAfter || 100;
    const h2LineSpacing = ts?.heading2?.lineSpacing || bodyLineSpacing;
    const h2Color = ts?.heading2?.color || undefined;

    const h3Font = ts?.heading3?.font || h2Font;
    const h3Size = ts?.heading3?.size || 26;
    const h3Bold = ts?.heading3?.bold !== false;
    const h3SpaceBefore = ts?.heading3?.spaceBefore || 160;
    const h3SpaceAfter = ts?.heading3?.spaceAfter || 80;
    const h3LineSpacing = ts?.heading3?.lineSpacing || bodyLineSpacing;
    const h3Color = ts?.heading3?.color || undefined;

    const h4Font = ts?.heading4?.font || h3Font;
    const h4Size = ts?.heading4?.size || bodySize;
    const h4Bold = ts?.heading4?.bold !== false;
    const h4SpaceBefore = ts?.heading4?.spaceBefore || 120;
    const h4SpaceAfter = ts?.heading4?.spaceAfter || 60;
    const h4LineSpacing = ts?.heading4?.lineSpacing || bodyLineSpacing;
    const h4Color = ts?.heading4?.color || undefined;

    // Page margins from template
    const margins = ts?.pageMargin || {};
    const pgTop = margins.top || 1440;
    const pgBottom = margins.bottom || 1440;
    const pgLeft = margins.left || 1440;
    const pgRight = margins.right || 1440;

    // Multi-level numbering reference ID
    const NUMBERING_REF = "outline-numbering";

    // Helper to create a heading paragraph with full style + multi-level numbering
    const makeHeading = (text: string, level: "title" | 0 | 1 | 2 | 3, useNumbering = true) => {
      const config = level === "title"
        ? { font: titleFont, size: titleSize, bold: titleBold, color: titleColor, before: titleSpaceBefore, after: titleSpaceAfter, line: titleLineSpacing, heading: undefined as any, numLevel: -1 }
        : level === 0
        ? { font: h1Font, size: h1Size, bold: h1Bold, color: h1Color, before: h1SpaceBefore, after: h1SpaceAfter, line: h1LineSpacing, heading: HeadingLevel.HEADING_1, numLevel: 0 }
        : level === 1
        ? { font: h2Font, size: h2Size, bold: h2Bold, color: h2Color, before: h2SpaceBefore, after: h2SpaceAfter, line: h2LineSpacing, heading: HeadingLevel.HEADING_2, numLevel: 1 }
        : level === 2
        ? { font: h3Font, size: h3Size, bold: h3Bold, color: h3Color, before: h3SpaceBefore, after: h3SpaceAfter, line: h3LineSpacing, heading: HeadingLevel.HEADING_3, numLevel: 2 }
        : { font: h4Font, size: h4Size, bold: h4Bold, color: h4Color, before: h4SpaceBefore, after: h4SpaceAfter, line: h4LineSpacing, heading: HeadingLevel.HEADING_4, numLevel: 3 };
      return new Paragraph({
        children: [new TextRun({ text, font: config.font, size: config.size, bold: config.bold, color: config.color })],
        heading: config.heading,
        spacing: { before: config.before, after: config.after, line: config.line },
        alignment: level === "title" ? AlignmentType.CENTER : undefined,
        numbering: (useNumbering && config.numLevel >= 0) ? { reference: NUMBERING_REF, level: config.numLevel } : undefined,
      });
    };

    const makeBody = (text: string) => new Paragraph({
      children: [new TextRun({ text, font: bodyFont, size: bodySize, color: bodyColor })],
      spacing: { before: bodySpaceBefore, after: bodySpaceAfter, line: bodyLineSpacing },
    });

    const children: Paragraph[] = [
      makeHeading(projectTitle, "title"),
      new Paragraph({ text: "" }),
    ];

    if (parsedOutline?.overall_strategy) {
      children.push(
        makeHeading("投标策略建议", 0, false),
        makeBody(parsedOutline.overall_strategy),
        new Paragraph({ text: "" }),
      );
    }

    children.push(makeHeading("投标文件提纲", 0, false));

    for (const { section, depth } of flatSections) {
      const level = Math.min(depth, 3) as 0 | 1 | 2 | 3;
      // Don't include section_number prefix since multi-level numbering auto-generates it
      children.push(makeHeading(section.title, level));
      if (section.content) {
        children.push(makeBody(section.content));
      }
    }

    if (parsedOutline?.personnel_plan?.length > 0) {
      children.push(new Paragraph({ text: "" }));
      children.push(makeHeading("人员配置建议", 0, false));
      for (const p of parsedOutline.personnel_plan) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${p.role}`, bold: true, font: bodyFont, size: bodySize }),
            new TextRun({ text: ` — ${p.requirements || ""}`, font: bodyFont, size: bodySize }),
          ],
          spacing: { before: bodySpaceBefore, after: bodySpaceAfter, line: bodyLineSpacing },
        }));
        if (p.suggested_candidate) {
          children.push(makeBody(`  建议人选: ${p.suggested_candidate}`));
        }
      }
    }

    const doc = new Document({
      numbering: {
        config: [{
          reference: NUMBERING_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "第%1章",
              alignment: AlignmentType.START,
              suffix: LevelSuffix.NOTHING,
              style: {
                paragraph: { indent: { left: 0, hanging: 0 } },
                run: { font: h1Font, size: h1Size, bold: h1Bold, color: h1Color },
              },
            },
            {
              level: 1,
              format: LevelFormat.DECIMAL,
              text: "%1.%2",
              alignment: AlignmentType.START,
              suffix: LevelSuffix.SPACE,
              style: {
                paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.3) } },
                run: { font: h2Font, size: h2Size, bold: h2Bold, color: h2Color },
              },
            },
            {
              level: 2,
              format: LevelFormat.DECIMAL,
              text: "%1.%2.%3",
              alignment: AlignmentType.START,
              suffix: LevelSuffix.SPACE,
              style: {
                paragraph: { indent: { left: convertInchesToTwip(0.6), hanging: convertInchesToTwip(0.4) } },
                run: { font: h3Font, size: h3Size, bold: h3Bold, color: h3Color },
              },
            },
            {
              level: 3,
              format: LevelFormat.DECIMAL,
              text: "%1.%2.%3.%4",
              alignment: AlignmentType.START,
              suffix: LevelSuffix.SPACE,
              style: {
                paragraph: { indent: { left: convertInchesToTwip(0.9), hanging: convertInchesToTwip(0.5) } },
                run: { font: h4Font, size: h4Size, bold: h4Bold, color: h4Color },
              },
            },
          ],
        }],
      },
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
    toast({ title: "导出成功", description: "标书已导出为Word格式" });
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

  const [reuseMode, setReuseMode] = useState(false);
  const [reuseSourceId, setReuseSourceId] = useState("");

  const handleReuseCreate = async () => {
    if (!user || !reuseSourceId) return;
    setGenerating(true);
    try {
      const source = proposals.find(p => p.id === reuseSourceId);
      if (!source) throw new Error("找不到源标书");
      const name = projectName.trim() || `${source.project_name} (复用)`;

      // Create new proposal
      const { data: newProposal, error } = await supabase
        .from("bid_proposals")
        .insert({
          user_id: user.id,
          bid_analysis_id: source.bid_analysis_id,
          project_name: name,
          custom_prompt: source.custom_prompt,
          outline_content: source.outline_content,
          ai_status: "completed",
          status: "draft",
        } as any)
        .select()
        .single();
      if (error || !newProposal) throw error || new Error("创建失败");

      // Copy sections
      const { data: sourceSections } = await supabase
        .from("proposal_sections")
        .select("*")
        .eq("proposal_id", source.id)
        .order("sort_order");
      if (sourceSections && sourceSections.length > 0) {
        const idMap = new Map<string, string>();
        for (const s of sourceSections) {
          const newId = crypto.randomUUID();
          idMap.set(s.id, newId);
        }
        const newSections = sourceSections.map((s: any) => ({
          id: idMap.get(s.id),
          proposal_id: (newProposal as any).id,
          title: s.title,
          content: s.content,
          section_number: s.section_number,
          sort_order: s.sort_order,
          parent_id: s.parent_id ? idMap.get(s.parent_id) || null : null,
          source_type: s.source_type,
          source_id: s.source_id,
        }));
        await supabase.from("proposal_sections").insert(newSections as any);
      }

      toast({ title: "复用成功", description: `已创建新标书: ${name}` });
      setReuseMode(false);
      setReuseSourceId("");
      setProjectName("");
      fetchProposals();
      setSelectedProposal(newProposal as any);
    } catch (e: any) {
      toast({ title: "复用失败", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  // ---- RENDER ----

  // Detail view - when a proposal is selected
  if (selectedProposal) {
    // ---- WORKSPACE MODE: Three-panel layout ----
    if (workspaceMode) {
      const allFlat = flattenSections(sections);
      const selectedSection = selectedSectionId
        ? allFlat.find(f => f.section.id === selectedSectionId)?.section || null
        : null;

      const handleChatSend = async () => {
        if (!chatInput.trim() || chatLoading) return;
        const userMsg = chatInput.trim();
        setChatInput("");
        const hasHighlight = !!highlightedText && !!highlightedSectionId;
        const displayMsg = hasHighlight
          ? `✏️ 修改高亮内容：${userMsg}`
          : userMsg;
        setChatMessages(prev => [...prev, { role: "user", content: displayMsg }]);
        setChatLoading(true);
        try {
          const context = selectedSection
            ? `当前选中章节: ${selectedSection.section_number || ""} ${selectedSection.title}\n内容: ${selectedSection.content || "（暂无内容）"}`
            : "用户未选中具体章节";

          // Build outline summary for AI tool calling
          const buildOutlineSummary = (list: ProposalSection[], depth = 0): string => {
            return list.map(s => {
              const indent = "  ".repeat(depth);
              const line = `${indent}- [${s.id}] ${s.title}`;
              const childLines = s.children ? buildOutlineSummary(s.children, depth + 1) : "";
              return childLines ? `${line}\n${childLines}` : line;
            }).join("\n");
          };
          const outlineSummary = buildOutlineSummary(sections);

          const { data, error } = await supabase.functions.invoke("bidding-assistant", {
            body: {
              action: hasHighlight ? "rewrite" : "chat",
              proposalId: selectedProposal.id,
              message: userMsg,
              context,
              outlineSummary,
              ...(hasHighlight ? {
                highlightedText,
                sectionId: highlightedSectionId,
              } : {}),
            },
          });
          if (error) throw error;

          const reply = data?.reply || "抱歉，暂时无法回复";
          setChatMessages(prev => [...prev, { role: "assistant", content: reply }]);

          // If outline was changed by AI, refresh sections
          if (data?.outlineChanged) {
            fetchProposalDetails(selectedProposal.id);
          }

          // If rewrite succeeded, apply the new content to the section
          if (hasHighlight && data?.newContent && highlightedSectionId) {
            const targetId = highlightedSectionId;
            const updateInTree = (list: ProposalSection[]): ProposalSection[] =>
              list.map(s => ({
                ...s,
                content: s.id === targetId ? (s.content || "").replace(highlightedText!, data.newContent) : s.content,
                children: s.children ? updateInTree(s.children) : undefined,
              }));
            setSections(updateInTree(sections));
            // Save to DB
            const flatAll = flattenSections(sections);
            const targetSection = flatAll.find(f => f.section.id === targetId)?.section;
            if (targetSection) {
              const updatedContent = (targetSection.content || "").replace(highlightedText!, data.newContent);
              await supabase.from("proposal_sections").update({ content: updatedContent }).eq("id", targetId);
            }
            setHighlightedText(null);
            setHighlightedSectionId(null);
          }
        } catch (e: any) {
          setChatMessages(prev => [...prev, { role: "assistant", content: `错误: ${e.message}` }]);
        } finally {
          setChatLoading(false);
          setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
        }
      };

      // Handle text selection in center panel
      const handleTextSelection = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
        const text = selection.toString().trim();
        // Find which section this selection belongs to
        let node = selection.anchorNode as HTMLElement | null;
        while (node && !node?.dataset?.sectionId) {
          node = node.parentElement;
        }
        if (node?.dataset?.sectionId) {
          setHighlightedText(text);
          setHighlightedSectionId(node.dataset.sectionId);
          setSelectedSectionId(node.dataset.sectionId);
        }
      };

      const handleSaveSection = async (sectionId: string) => {
        try {
          await supabase.from("proposal_sections").update({ content: editingContent }).eq("id", sectionId);
          // Update local state
          const updateInTree = (list: ProposalSection[]): ProposalSection[] =>
            list.map(s => ({
              ...s,
              content: s.id === sectionId ? editingContent : s.content,
              children: s.children ? updateInTree(s.children) : undefined,
            }));
          setSections(updateInTree(sections));
          setEditingSectionId(null);
          toast({ title: "已保存", description: "章节内容已更新" });
        } catch (e: any) {
          toast({ title: "保存失败", description: e.message, variant: "destructive" });
        }
      };

      // Render a line with inline source annotations highlighted
      const renderAnnotatedLine = (text: string, idx: number, sectionId?: string) => {
        const parts: { type: "text" | "kb" | "ai"; content: string; fileName?: string; detail?: string }[] = [];
        let lastIndex = 0;
        const combinedPattern = /【来源[：:](知识库\s*[-–—]\s*(.+?)(?:\s*[-–—]\s*(.+?))?|AI智能生成)】/g;
        let match;
        while ((match = combinedPattern.exec(text)) !== null) {
          if (match.index > lastIndex) parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
          parts.push(match[1].startsWith("AI")
            ? { type: "ai", content: match[0] }
            : { type: "kb", content: match[0], fileName: match[2]?.trim(), detail: match[3]?.trim() });
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) parts.push({ type: "text", content: text.slice(lastIndex) });

        const plainText = parts.filter(p => p.type === "text").map(p => p.content).join("").trim();
        const isHighlighted = !!(highlightedText && plainText && plainText.includes(highlightedText));
        const handleTagClick = () => {
          if (sectionId && plainText) {
            setHighlightedText(plainText);
            setHighlightedSectionId(sectionId);
            setSelectedSectionId(sectionId);
          }
        };

        if (parts.length === 1 && parts[0].type === "text") {
          return <p key={idx} className={`text-sm leading-relaxed transition-colors ${isHighlighted ? "bg-yellow-200/50 dark:bg-yellow-500/20 rounded px-1 -mx-1 text-foreground" : "text-foreground/80"}`}>{text}</p>;
        }

        return (
          <p key={idx} className={`text-sm leading-relaxed transition-colors ${isHighlighted ? "bg-yellow-200/50 dark:bg-yellow-500/20 rounded px-1 -mx-1 text-foreground" : "text-foreground/80"}`}>
            {parts.map((part, pi) => {
              if (part.type === "kb") return (
                <span key={pi} onClick={handleTagClick} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20 mx-0.5 whitespace-nowrap cursor-pointer hover:bg-blue-500/20 transition-colors">
                  <FileText className="w-3 h-3" />知识库: {part.fileName}{part.detail ? ` - ${part.detail}` : ""}
                </span>
              );
              if (part.type === "ai") return (
                <span key={pi} onClick={handleTagClick} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20 mx-0.5 whitespace-nowrap cursor-pointer hover:bg-purple-500/20 transition-colors">
                  <Sparkles className="w-3 h-3" />AI智能生成
                </span>
              );
              return <span key={pi}>{part.content}</span>;
            })}
          </p>
        );
      };

      const renderEditableContent = (section: { id: string; content: string | null }) => {
        if (editingSectionId === section.id) {
          return (
            <div className="mb-3">
              <Textarea
                className="min-h-[200px] text-sm leading-relaxed font-mono"
                value={editingContent}
                onChange={(e) => setEditingContent(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <Button size="sm" onClick={() => handleSaveSection(section.id)}>
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />保存
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingSectionId(null)}>
                  取消
                </Button>
              </div>
            </div>
          );
        }
        if (!section.content) return null;
        return (
          <div
            className="group relative cursor-text"
            onDoubleClick={() => {
              setEditingSectionId(section.id);
              setEditingContent(section.content || "");
            }}
          >
            <div className="absolute -right-1 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px] text-muted-foreground"
                onClick={() => {
                  setEditingSectionId(section.id);
                  setEditingContent(section.content || "");
                }}
              >
                ✏️ 编辑
              </Button>
            </div>
            {renderSectionContent(section.content, section.id)}
          </div>
        );
      };

      // Helper to render section content with source annotations, requirement hints, images
      const renderSectionContent = (content: string, sectionId?: string) => {
        const lines = content.split("\n");
        const requirementPatterns = [
          /^需要材料[:：]/,
          /^建议模板[:：]/,
          /^评分分值[:：]/,
          /^格式要求[:：]/,
          /^招标要求[:：]/,
          /^资格要求[:：]/,
          /^【.*?】$/,
        ];
        const imageUrlPattern = /(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp))/gi;

        return (
          <div className="space-y-1.5 mb-3">
            {lines.map((line, idx) => {
              const trimmed = line.trim();
              if (!trimmed) return null;

              const imageMatches = trimmed.match(imageUrlPattern);
              const isRequirement = requirementPatterns.some(p => p.test(trimmed));

              if (imageMatches) {
                return (
                  <div key={idx}>
                    {isRequirement ? (
                      <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                        <span className="text-xs text-amber-700 dark:text-amber-400">{trimmed.replace(imageUrlPattern, "").trim()}</span>
                      </div>
                    ) : (
                      renderAnnotatedLine(trimmed.replace(imageUrlPattern, "").trim(), idx, sectionId)
                    )}
                    {imageMatches.map((url, imgIdx) => (
                      <div key={imgIdx} className="my-2 rounded-lg border border-border overflow-hidden bg-muted/20 p-1">
                        <img src={url} alt="标书附图" className="max-w-full h-auto rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      </div>
                    ))}
                  </div>
                );
              }

              if (isRequirement) {
                return (
                  <div key={idx} className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <span className="text-xs text-amber-700 dark:text-amber-400">{trimmed}</span>
                  </div>
                );
              }

              return renderAnnotatedLine(trimmed, idx, sectionId);
            })}
          </div>
        );
      };

      return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setWorkspaceMode(false)}>
                <PanelLeftClose className="w-4 h-4 mr-1" />退出工作台
              </Button>
              <span className="text-sm font-bold text-foreground">{selectedProposal.project_name}</span>
              {docStatus === "processing" && <Badge variant="secondary" className="text-[10px]">生成中...</Badge>}
              {docStatus === "completed" && <Badge variant="default" className="text-[10px]">已生成</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportWord} disabled={sections.length === 0}>
                <Download className="w-4 h-4 mr-1" />导出Word
              </Button>
            </div>
          </div>

          {/* Three-panel resizable layout */}
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
            {/* Left panel: Outline */}
            <ResizablePanel defaultSize={22} minSize={15} maxSize={35}>
              <div className="flex flex-col h-full border-r border-border">
                <div className="px-3 py-2 border-b border-border bg-muted/30 shrink-0 flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">📋 提纲目录</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => { setOutlineAddParentId("root"); setOutlineAddTitle(""); setOutlineAddNumber(""); }}
                    title="添加一级章节"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-0.5">
                    {/* Add root section form */}
                    {outlineAddParentId === "root" && (
                      <div className="p-2 mb-1 rounded-md border border-border bg-muted/30 space-y-1.5">
                        <Input
                          className="h-7 text-xs"
                          placeholder="章节标题"
                          value={outlineAddTitle}
                          onChange={(e) => setOutlineAddTitle(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") handleOutlineAdd(null); if (e.key === "Escape") setOutlineAddParentId(null); }}
                        />
                        <div className="flex gap-1">
                          <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => handleOutlineAdd(null)} disabled={!outlineAddTitle.trim()}>
                            确认
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setOutlineAddParentId(null)}>
                            取消
                          </Button>
                        </div>
                      </div>
                    )}

                    {allFlat.map(({ section: s, depth: d }) => (
                      <div key={s.id}>
                        {/* Editing title inline */}
                        {outlineEditId === s.id ? (
                          <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: `${8 + d * 12}px` }}>
                            <Input
                              className="h-6 text-xs flex-1"
                              value={outlineEditTitle}
                              onChange={(e) => setOutlineEditTitle(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleOutlineRename(s.id); if (e.key === "Escape") setOutlineEditId(null); }}
                              autoFocus
                            />
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleOutlineRename(s.id)}>
                              <CheckCircle className="w-3 h-3 text-green-500" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setOutlineEditId(null)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="group flex items-center">
                            <button
                              onClick={() => {
                                setSelectedSectionId(s.id === selectedSectionId ? null : s.id);
                                const el = document.getElementById(`section-${s.id}`);
                                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                              }}
                              className={`flex-1 text-left px-2 py-1.5 rounded-l text-xs transition-colors truncate ${
                                s.id === selectedSectionId
                                  ? "bg-accent text-accent-foreground font-medium"
                                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                              }`}
                              style={{ paddingLeft: `${8 + d * 12}px` }}
                            >
                              {s.section_number && <span className="mr-1 opacity-60">{s.section_number}</span>}
                              {s.title}
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-secondary shrink-0">
                                  <MoreVertical className="w-3 h-3 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-36">
                                <DropdownMenuItem onClick={() => { setOutlineEditId(s.id); setOutlineEditTitle(s.title); }}>
                                  <Pencil className="w-3.5 h-3.5 mr-2" />重命名
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setOutlineAddParentId(s.id); setOutlineAddTitle(""); setOutlineAddNumber(""); }}>
                                  <FolderPlus className="w-3.5 h-3.5 mr-2" />添加子章节
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleOutlineMove(s.id, "up")}>
                                  <ChevronUp className="w-3.5 h-3.5 mr-2" />上移
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleOutlineMove(s.id, "down")}>
                                  <ChevronDown className="w-3.5 h-3.5 mr-2" />下移
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleOutlineDelete(s.id)}>
                                  <Trash2 className="w-3.5 h-3.5 mr-2" />删除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}

                        {/* Add child section form */}
                        {outlineAddParentId === s.id && (
                          <div className="ml-4 p-2 my-1 rounded-md border border-border bg-muted/30 space-y-1.5" style={{ marginLeft: `${8 + (d + 1) * 12}px` }}>
                            <Input
                              className="h-7 text-xs"
                              placeholder="子章节标题"
                              value={outlineAddTitle}
                              onChange={(e) => setOutlineAddTitle(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") handleOutlineAdd(s.id); if (e.key === "Escape") setOutlineAddParentId(null); }}
                            />
                            <div className="flex gap-1">
                              <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => handleOutlineAdd(s.id)} disabled={!outlineAddTitle.trim()}>
                                确认
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setOutlineAddParentId(null)}>
                                取消
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Center panel: Document content */}
            <ResizablePanel defaultSize={50} minSize={30}>
              <div className="flex flex-col h-full">
                <div className="px-4 py-2 border-b border-border bg-muted/30 shrink-0 flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">📄 标书正文</p>
                  {docStatus === "processing" && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />{docProgress || "生成中..."}
                    </span>
                  )}
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-6 space-y-6 max-w-none" onMouseUp={handleTextSelection}>
                    {sections.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-20">暂无标书内容</p>
                    ) : (
                      sections.map((section) => (
                        <div key={section.id} id={`section-${section.id}`} data-section-id={section.id}>
                          <h2
                            className={`text-base font-bold text-foreground mb-2 cursor-pointer rounded px-1 -mx-1 transition-colors ${
                              section.id === selectedSectionId ? "bg-accent/20" : "hover:bg-secondary/50"
                            }`}
                            onClick={() => setSelectedSectionId(section.id)}
                          >
                            {section.section_number && <span className="text-muted-foreground mr-1.5">{section.section_number}</span>}
                            {section.title}
                          </h2>
                          {renderEditableContent(section)}
                          {section.children?.map((child) => (
                            <div key={child.id} className="ml-4 mt-3" id={`section-${child.id}`} data-section-id={child.id}>
                              <h3
                                className={`text-sm font-semibold text-foreground mb-1 cursor-pointer rounded px-1 -mx-1 transition-colors ${
                                  child.id === selectedSectionId ? "bg-accent/20" : "hover:bg-secondary/50"
                                }`}
                                onClick={() => setSelectedSectionId(child.id)}
                              >
                                {child.section_number && <span className="text-muted-foreground mr-1">{child.section_number}</span>}
                                {child.title}
                              </h3>
                              {renderEditableContent(child)}
                              {child.children?.map((sub) => (
                                <div key={sub.id} className="ml-4 mt-2" id={`section-${sub.id}`} data-section-id={sub.id}>
                                  <h4
                                    className={`text-xs font-medium text-foreground mb-0.5 cursor-pointer rounded px-1 -mx-1 transition-colors ${
                                      sub.id === selectedSectionId ? "bg-accent/20" : "hover:bg-secondary/50"
                                    }`}
                                    onClick={() => setSelectedSectionId(sub.id)}
                                  >
                                    {sub.section_number && <span className="text-muted-foreground mr-1">{sub.section_number}</span>}
                                    {sub.title}
                                  </h4>
                                  {renderEditableContent(sub)}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right panel: AI Chat */}
            <ResizablePanel defaultSize={28} minSize={20} maxSize={40}>
              <div className="flex flex-col h-full">
                <div className="px-3 py-2 border-b border-border bg-muted/30 shrink-0">
                  <p className="text-xs font-semibold text-foreground">💬 AI 助手</p>
                  {selectedSection && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      当前章节: {selectedSection.section_number} {selectedSection.title}
                    </p>
                  )}
                </div>
                {/* Highlighted text context */}
                {highlightedText && (
                  <div className="px-3 py-2 border-b border-border bg-yellow-500/5 shrink-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />已选中内容
                      </p>
                      <button onClick={() => { setHighlightedText(null); setHighlightedSectionId(null); }} className="text-muted-foreground hover:text-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-3 bg-yellow-200/30 dark:bg-yellow-500/10 rounded px-2 py-1">
                      {highlightedText.length > 150 ? highlightedText.slice(0, 150) + "..." : highlightedText}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">输入修改要求后发送，AI将重写此段内容</p>
                  </div>
                )}
                <ScrollArea className="flex-1">
                  <div className="p-3 space-y-3">
                    {chatMessages.length === 0 && !highlightedText && (
                      <div className="text-center py-12">
                        <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-xs text-muted-foreground">
                          点击来源标签或选中文字高亮内容，然后输入修改指令让AI重写
                        </p>
                        <div className="mt-4 space-y-1.5">
                          {["帮我扩充这个章节的内容", "检查这部分是否符合招标要求", "优化这段文字的专业性", "用更专业的语言改写"].map((hint) => (
                            <button
                              key={hint}
                              onClick={() => { setChatInput(hint); }}
                              className="block w-full text-left px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                            >
                              {hint}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${
                          msg.role === "user"
                            ? "bg-accent text-accent-foreground"
                            : "bg-secondary text-secondary-foreground"
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-secondary text-secondary-foreground rounded-lg px-3 py-2 text-xs flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" />思考中...
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                </ScrollArea>
                <div className="p-3 border-t border-border shrink-0">
                  <div className="flex gap-2">
                    <Textarea
                      className="flex-1 min-h-[36px] max-h-[100px] text-xs resize-none"
                      rows={1}
                      placeholder={highlightedText ? "输入修改要求，AI将重写高亮内容..." : selectedSection ? `关于「${selectedSection.title}」提问...` : "选择章节后提问..."}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                    />
                    <Button size="sm" onClick={handleChatSend} disabled={!chatInput.trim() || chatLoading} className="shrink-0 h-9">
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedProposal(null); setSections([]); setTocSections([]); setTocEntries([]); setMaterials([]); setShowCollabDialog(false); }}>
            ← 返回列表
          </Button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-foreground">{selectedProposal.project_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={selectedProposal.ai_status === "completed" ? "default" : selectedProposal.ai_status === "processing" ? "secondary" : "outline"} className="text-xs">
                {selectedProposal.ai_status === "completed" ? "提纲已完成" : selectedProposal.ai_status === "processing" ? "生成中" : selectedProposal.ai_status === "failed" ? "失败" : "待处理"}
              </Badge>
              <span className="text-xs text-muted-foreground">{new Date(selectedProposal.created_at).toLocaleDateString()}</span>
              {selectedProposal.user_id !== user?.id && (
                <Badge variant="secondary" className="text-xs">协作</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowCollabDialog(!showCollabDialog); if (!showCollabDialog) fetchPlatformUsers(); }}>
              <UserPlus className="w-4 h-4 mr-1" /> 协作者 {collaborators.length > 0 && `(${collaborators.length})`}
            </Button>
            {selectedProposal.user_id === user?.id && (
              <Button variant="outline" size="sm" onClick={() => handleDelete(selectedProposal.id)}>
                <Trash2 className="w-4 h-4 mr-1" /> 删除
              </Button>
            )}
          </div>
        </div>

        {/* Collaborator panel */}
        {showCollabDialog && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">协作者管理</p>
                <Button variant="ghost" size="sm" onClick={() => setShowCollabDialog(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Current collaborators */}
              {collaborators.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">当前协作者</p>
                  {collaborators.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/50">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-foreground">{c.full_name || "未知用户"}</span>
                      </div>
                      {selectedProposal.user_id === user?.id && (
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveCollaborator(c.id)} className="text-destructive hover:text-destructive h-7 px-2">
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add collaborator */}
              {selectedProposal.user_id === user?.id && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">添加协作者</p>
                  <Input
                    placeholder="搜索用户姓名..."
                    value={collabSearch}
                    onChange={(e) => setCollabSearch(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <ScrollArea className="max-h-[200px]">
                    <div className="space-y-1">
                      {platformUsers
                        .filter((u) => {
                          const alreadyAdded = collaborators.some((c) => c.user_id === u.user_id);
                          const isOwner = u.user_id === selectedProposal.user_id;
                          const matchesSearch = !collabSearch || (u.full_name || "").toLowerCase().includes(collabSearch.toLowerCase());
                          return !alreadyAdded && !isOwner && matchesSearch;
                        })
                        .map((u) => (
                          <div key={u.user_id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-secondary/50">
                            <span className="text-sm text-foreground">{u.full_name || "未命名用户"}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={addingCollab}
                              onClick={() => handleAddCollaborator(u.user_id)}
                            >
                              {addingCollab ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Plus className="w-3 h-3 mr-1" />添加</>}
                            </Button>
                          </div>
                        ))}
                      {platformUsers.filter((u) => {
                        const alreadyAdded = collaborators.some((c) => c.user_id === u.user_id);
                        const isOwner = u.user_id === selectedProposal.user_id;
                        const matchesSearch = !collabSearch || (u.full_name || "").toLowerCase().includes(collabSearch.toLowerCase());
                        return !alreadyAdded && !isOwner && matchesSearch;
                      }).length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-4">无可添加的用户</p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {collaborators.length === 0 && selectedProposal.user_id !== user?.id && (
                <p className="text-xs text-muted-foreground text-center py-4">暂无其他协作者</p>
              )}
            </CardContent>
          </Card>
        )}

        {selectedProposal.ai_status === "processing" ? (
            <Card className="py-12 px-8">
              <div className="max-w-md mx-auto space-y-6">
                <div className="text-center space-y-2">
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-accent" />
                  <p className="text-sm font-medium text-foreground">正在生成投标提纲</p>
                </div>
                {(() => {
                  const steps = [
                    { key: "prepare", label: "准备数据", match: "准备数据" },
                    { key: "ai", label: "AI 生成提纲", match: "调用AI" },
                    { key: "parse", label: "解析结果", match: "解析结果" },
                    { key: "save_outline", label: "保存提纲结构", match: "保存提纲" },
                    { key: "save_sections", label: "保存章节", match: "保存章节" },
                  ];
                  const progress = selectedProposal.ai_progress || "";
                  let currentIdx = steps.findIndex(s => progress.includes(s.match));
                  if (currentIdx === -1) currentIdx = 0;
                  const percent = Math.round(((currentIdx + 1) / steps.length) * 100);
                  return (
                    <div className="space-y-4">
                      <Progress value={percent} className="h-2" />
                      <div className="space-y-1.5">
                        {steps.map((step, i) => {
                          const isDone = i < currentIdx;
                          const isCurrent = i === currentIdx;
                          return (
                            <div key={step.key} className={`flex items-center gap-2 text-xs transition-all ${isDone ? "text-muted-foreground" : isCurrent ? "text-foreground font-medium" : "text-muted-foreground/50"}`}>
                              {isDone ? (
                                <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              ) : isCurrent ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                              ) : (
                                <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
                              )}
                              <span>{step.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground text-center">{progress}</p>
                      {selectedProposal.token_usage && (
                        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                          <span>Prompt: {formatTokenCount(selectedProposal.token_usage.prompt_tokens)}</span>
                          <span>Completion: {formatTokenCount(selectedProposal.token_usage.completion_tokens)}</span>
                          <span className="font-medium text-foreground">Total: {formatTokenCount(selectedProposal.token_usage.total_tokens)}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
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
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList>
                <TabsTrigger value="outline"><FileText className="w-4 h-4 mr-1" />应答提纲</TabsTrigger>
                <TabsTrigger value="toc">
                  <BookOpen className="w-4 h-4 mr-1" />
                  标书目录
                  {tocStatus === "processing" && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">生成中</Badge>}
                  {tocStatus === "completed" && <Badge variant="default" className="ml-1.5 text-[10px] px-1.5 py-0">已生成</Badge>}
                </TabsTrigger>
                <TabsTrigger value="proposal">
                  <Sparkles className="w-4 h-4 mr-1" />
                  标书编写
                  {docStatus === "completed" && <Badge variant="default" className="ml-1.5 text-[10px] px-1.5 py-0">已生成</Badge>}
                  {docStatus === "processing" && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">生成中</Badge>}
                </TabsTrigger>
                <TabsTrigger value="materials">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  证明材料
                  {hardMissing.length > 0 && <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">{hardMissing.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="personnel"><Users className="w-4 h-4 mr-1" />人员配置</TabsTrigger>
                <TabsTrigger value="assembly"><Package className="w-4 h-4 mr-1" />标书组装</TabsTrigger>
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
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm">投标文件提纲</CardTitle>
                      <div className="flex gap-2">
                        {sections.length > 0 && tocStatus !== "processing" && tocStatus !== "completed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { handleGenerateToc(); setActiveTab("toc"); }}
                            disabled={generatingToc || tocStatus === "processing"}
                          >
                            {generatingToc ? (
                              <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />提交中...</>
                            ) : (
                              <><BookOpen className="w-3.5 h-3.5 mr-1" />生成标书目录</>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div>
                      {selectedProposal.ai_status === "processing" ? (
                        <div className="py-8 space-y-4">
                          <div className="flex items-center gap-3 justify-center">
                            <Loader2 className="w-6 h-6 animate-spin text-accent" />
                            <p className="text-sm font-medium text-foreground">正在生成投标提纲</p>
                          </div>
                          {(() => {
                            const steps = [
                              { key: "prepare", label: "准备数据", match: "准备数据" },
                              { key: "ai", label: "AI 生成提纲", match: "调用AI" },
                              { key: "parse", label: "解析结果", match: "解析结果" },
                              { key: "save_outline", label: "保存提纲结构", match: "保存提纲" },
                              { key: "save_sections", label: "保存章节", match: "保存章节" },
                            ];
                            const progress = selectedProposal.ai_progress || "";
                            let currentIdx = steps.findIndex(s => progress.includes(s.match));
                            if (currentIdx === -1) currentIdx = 0;
                            const percent = Math.round(((currentIdx + 1) / steps.length) * 100);
                            return (
                              <div className="max-w-sm mx-auto space-y-3">
                                <Progress value={percent} className="h-2" />
                                <div className="space-y-1.5">
                                  {steps.map((step, i) => {
                                    const isDone = i < currentIdx;
                                    const isCurrent = i === currentIdx;
                                    return (
                                      <div key={step.key} className={`flex items-center gap-2 text-xs transition-all ${isDone ? "text-muted-foreground" : isCurrent ? "text-foreground font-medium" : "text-muted-foreground/50"}`}>
                                        {isDone ? (
                                          <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                                        ) : isCurrent ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                                        ) : (
                                          <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
                                        )}
                                        <span>{step.label}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                <p className="text-xs text-muted-foreground text-center">{selectedProposal.ai_progress || "处理中..."}</p>
                              </div>
                            );
                          })()}
                        </div>
                      ) : sections.length === 0 ? (
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

              {/* TOC (标书目录) tab */}
              <TabsContent value="toc" className="space-y-4">
                {tocStatus === "processing" && (
                  <Card className="border-accent/30">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3">
                        <Loader2 className="w-5 h-5 animate-spin text-accent shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">正在生成标书目录</p>
                          <p className="text-xs text-muted-foreground mt-1 truncate">{tocProgress || "处理中..."}</p>
                          {(() => {
                            const match = tocProgress?.match(/\((\d+)\/(\d+)\)/);
                            if (!match) return null;
                            const cur = parseInt(match[1]);
                            const tot = parseInt(match[2]);
                            const pct = Math.round((cur / tot) * 100);
                            return <Progress value={pct} className="h-1.5 mt-2" />;
                          })()}
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <Button size="sm" variant="outline" onClick={handlePauseToc}>
                            <Clock className="w-3.5 h-3.5 mr-1" />暂停
                          </Button>
                          <Button size="sm" variant="destructive" onClick={handleCancelToc}>
                            <X className="w-3.5 h-3.5 mr-1" />退出
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {tocStatus === "paused" && (
                  <Card className="border-yellow-500/30">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-yellow-500 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">标书目录生成已暂停</p>
                            <p className="text-xs text-muted-foreground">{tocProgress || ""}</p>
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => handleGenerateToc(true)} disabled={generatingToc}>
                            <RefreshCw className="w-3.5 h-3.5 mr-1" />继续
                          </Button>
                          <Button size="sm" variant="destructive" onClick={handleCancelToc}>
                            <X className="w-3.5 h-3.5 mr-1" />退出
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {tocStatus === "cancelled" && (
                  <Card className="border-muted-foreground/30">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">标书目录生成已取消</p>
                            <p className="text-xs text-muted-foreground">{tocProgress || ""}</p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleGenerateToc()} disabled={generatingToc}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />重新生成
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {tocStatus === "failed" && (
                  <Card className="border-destructive/30">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-destructive shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">标书目录生成失败</p>
                            <p className="text-xs text-muted-foreground">{tocProgress || "未知错误"}</p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleGenerateToc()} disabled={generatingToc}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />重试
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {tocStatus === "pending" && (
                  <Card className="flex flex-col items-center justify-center py-16">
                    <BookOpen className="w-10 h-10 text-accent opacity-50 mb-4" />
                    <p className="text-sm font-medium text-foreground mb-2">尚未生成标书目录</p>
                    <p className="text-xs text-muted-foreground mb-6 max-w-md text-center">
                      基于应答提纲，AI将为每个章节生成详细的撰写要求、格式规范和注意事项
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={handleFetchTocSources}>
                        <Download className="w-4 h-4 mr-1" />导入目录
                      </Button>
                      <Button onClick={() => handleGenerateToc()} disabled={generatingToc || sections.length === 0}>
                        {generatingToc ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" />提交中...</>
                        ) : (
                          <><BookOpen className="w-4 h-4 mr-1" />生成标书目录</>
                        )}
                      </Button>
                    </div>
                  </Card>
                )}

                {(tocStatus === "completed" || tocStatus === "processing" || tocStatus === "paused" || tocStatus === "cancelled") && sections.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">标书目录详情</CardTitle>
                        {tocStatus !== "completed" && (
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="ghost" onClick={handleFetchTocSources}>
                              <Download className="w-3.5 h-3.5 mr-1" />导入目录
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleGenerateToc(tocStatus === "paused")} disabled={generatingToc}>
                              <RefreshCw className="w-3.5 h-3.5 mr-1" />
                              {tocStatus === "paused" ? "继续生成" : "重新生成"}
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {tocStatus === "completed" ? (
                        <TocDragEditor
                          sections={tocSections}
                          tocEntries={tocEntries}
                          expandedSections={expandedSections}
                          onToggle={toggleSection}
                          onReorder={async (items) => {
                            try {
                              const sectionItems = items.filter(i => i.type === "section");
                              const tocItems = items.filter(i => i.type === "toc");
                              
                              for (const item of sectionItems) {
                                await supabase.from("proposal_sections").update({
                                  sort_order: item.sort_order,
                                  parent_id: item.parent_id,
                                } as any).eq("id", item.id);
                              }
                              
                              for (const item of tocItems) {
                                await supabase.from("proposal_toc_entries").update({
                                  sort_order: item.sort_order,
                                  parent_section_id: item.parent_id,
                                } as any).eq("id", item.id);
                              }
                              
                              if (selectedProposal) await fetchProposalDetails(selectedProposal.id);
                              toast({ title: "排序已更新" });
                            } catch (e: any) {
                              toast({ title: "排序更新失败", description: e.message, variant: "destructive" });
                            }
                          }}
                          onRenameEntry={async (id, title, type) => {
                            try {
                              const table = type === "toc" ? "proposal_toc_entries" : "proposal_sections";
                              await supabase.from(table).update({ title } as any).eq("id", id);
                              if (selectedProposal) await fetchProposalDetails(selectedProposal.id);
                              toast({ title: "已重命名" });
                            } catch (e: any) {
                              toast({ title: "重命名失败", description: e.message, variant: "destructive" });
                            }
                          }}
                          onDeleteEntry={async (id, type) => {
                            try {
                              const table = type === "toc" ? "proposal_toc_entries" : "proposal_sections";
                              await supabase.from(table).delete().eq("id", id);
                              if (selectedProposal) await fetchProposalDetails(selectedProposal.id);
                              toast({ title: "已删除" });
                            } catch (e: any) {
                              toast({ title: "删除失败", description: e.message, variant: "destructive" });
                            }
                          }}
                          onAutoNumber={async (items) => {
                            try {
                              const sectionItems = items.filter(i => i.type === "section");
                              const tocItems = items.filter(i => i.type === "toc");
                              for (const item of sectionItems) {
                                await supabase.from("proposal_sections").update({
                                  section_number: item.section_number,
                                } as any).eq("id", item.id);
                              }
                              for (const item of tocItems) {
                                await supabase.from("proposal_toc_entries").update({
                                  section_number: item.section_number,
                                } as any).eq("id", item.id);
                              }
                              if (selectedProposal) await fetchProposalDetails(selectedProposal.id);
                              toast({ title: "章节编号已更新" });
                            } catch (e: any) {
                              toast({ title: "编号更新失败", description: e.message, variant: "destructive" });
                            }
                          }}
                          onLevelChange={async (id, type, direction) => {
                            try {
                              if (type === "section") {
                                // Find the section in the tree
                                const findSection = (nodes: ProposalSection[], parent: ProposalSection | null): { node: ProposalSection; parent: ProposalSection | null; siblings: ProposalSection[] } | null => {
                                  for (const n of nodes) {
                                    if (n.id === id) return { node: n, parent, siblings: nodes };
                                    if (n.children) {
                                      const found = findSection(n.children, n);
                                      if (found) return found;
                                    }
                                  }
                                  return null;
                                };
                                const found = findSection(sections, null);
                                if (!found) return;

                                if (direction === "promote") {
                                  // Move to grandparent level (sibling of current parent)
                                  if (!found.parent) { toast({ title: "已是顶级，无法提升" }); return; }
                                  const newParentId = found.parent.parent_id || null;
                                  const parentSiblings = newParentId
                                    ? (findSection(sections, null) && sections.flatMap(function collect(s: ProposalSection): ProposalSection[] {
                                        if (s.id === newParentId) return s.children || [];
                                        return (s.children || []).flatMap(collect);
                                      }))
                                    : sections;
                                  const maxOrder = (parentSiblings || []).reduce((m, s) => Math.max(m, s.sort_order), -1);
                                  await supabase.from("proposal_sections").update({
                                    parent_id: newParentId,
                                    sort_order: maxOrder + 1,
                                  } as any).eq("id", id);
                                } else {
                                  // Demote: become child of previous sibling
                                  const sortedSiblings = [...found.siblings].sort((a, b) => a.sort_order - b.sort_order);
                                  const idx = sortedSiblings.findIndex(s => s.id === id);
                                  if (idx <= 0) { toast({ title: "没有前一个兄弟节点，无法降级" }); return; }
                                  const prevSibling = sortedSiblings[idx - 1];
                                  const prevChildren = prevSibling.children || [];
                                  const maxOrder = prevChildren.reduce((m, s) => Math.max(m, s.sort_order), -1);
                                  await supabase.from("proposal_sections").update({
                                    parent_id: prevSibling.id,
                                    sort_order: maxOrder + 1,
                                  } as any).eq("id", id);
                                }
                              } else {
                                // TOC entry: change parent_section_id
                                const entry = tocEntries.find(e => e.id === id);
                                if (!entry) return;
                                const currentParent = entry.parent_section_id;

                                if (direction === "promote") {
                                  if (!currentParent) { toast({ title: "已是顶级，无法提升" }); return; }
                                  // Find parent section's parent
                                  const findSectionParent = (nodes: ProposalSection[]): string | null => {
                                    for (const n of nodes) {
                                      if (n.id === currentParent) return n.parent_id || null;
                                      if (n.children) {
                                        const r = findSectionParent(n.children);
                                        if (r !== undefined) return r;
                                      }
                                    }
                                    return undefined as any;
                                  };
                                  const grandParentId = findSectionParent(sections);
                                  await supabase.from("proposal_toc_entries").update({
                                    parent_section_id: grandParentId,
                                  } as any).eq("id", id);
                                } else {
                                  // Demote: find a section under the current parent to become the new parent
                                  const sibSections = currentParent
                                    ? (sections.flatMap(function collect(s: ProposalSection): ProposalSection[] {
                                        if (s.id === currentParent) return s.children || [];
                                        return (s.children || []).flatMap(collect);
                                      }))
                                    : sections;
                                  if (!sibSections || sibSections.length === 0) { toast({ title: "没有可用的子章节，无法降级" }); return; }
                                  // Pick the last section as new parent
                                  const sorted = [...sibSections].sort((a, b) => a.sort_order - b.sort_order);
                                  const newParent = sorted[sorted.length - 1];
                                  await supabase.from("proposal_toc_entries").update({
                                    parent_section_id: newParent.id,
                                  } as any).eq("id", id);
                                }
                              }
                              if (selectedProposal) await fetchProposalDetails(selectedProposal.id);
                              toast({ title: direction === "promote" ? "层级已提升" : "层级已降低" });
                            } catch (e: any) {
                              toast({ title: "层级调整失败", description: e.message, variant: "destructive" });
                            }
                          }}
                          onAutoOrganize={async () => {
                            if (!selectedProposal) return;
                            setOrganizingToc(true);
                            try {
                              // Use original outline sections as the target structure
                              const flattenSections = (nodes: ProposalSection[]): any[] =>
                                nodes.map(n => ({
                                  id: n.id,
                                  title: n.title,
                                  section_number: n.section_number,
                                  sort_order: n.sort_order,
                                  parent_id: n.parent_id,
                                  children: n.children ? flattenSections(n.children) : [],
                                }));

                              // Collect imported chapters (toc_imported sections) from tocSections
                              const collectImported = (nodes: ProposalSection[]): any[] => {
                                const result: any[] = [];
                                for (const n of nodes) {
                                  if ((n as any).source_type === "toc_imported") {
                                    result.push({ id: n.id, title: n.title, section_number: n.section_number, sort_order: n.sort_order });
                                  }
                                  if (n.children) result.push(...collectImported(n.children));
                                }
                                return result;
                              };
                              const importedChapters = collectImported(tocSections);

                              const { data, error } = await supabase.functions.invoke("organize-toc", {
                                body: {
                                  outlineSections: flattenSections(sections),
                                  importedChapters,
                                  tocEntries: tocEntries.map(e => ({
                                    id: e.id,
                                    title: e.title,
                                    section_number: e.section_number,
                                    sort_order: e.sort_order,
                                  })),
                                },
                              });

                              if (error) throw error;
                              if (data?.error) throw new Error(data.error);

                              const assignments = data?.assignments;
                              const duplicates = data?.duplicates || [];
                              if (!assignments || !Array.isArray(assignments)) {
                                throw new Error("AI未返回有效的整理结果");
                              }

                              // Delete duplicates first
                              for (const d of duplicates) {
                                if (d.item_type === "section") {
                                  await supabase.from("proposal_sections").delete().eq("id", d.item_id);
                                } else {
                                  await supabase.from("proposal_toc_entries").delete().eq("id", d.item_id);
                                }
                              }

                              // Apply assignments
                              for (const a of assignments) {
                                if (a.item_type === "section") {
                                  await supabase.from("proposal_sections").update({
                                    parent_id: a.parent_section_id,
                                    sort_order: a.sort_order,
                                  } as any).eq("id", a.item_id);
                                } else {
                                  await supabase.from("proposal_toc_entries").update({
                                    parent_section_id: a.parent_section_id,
                                    sort_order: a.sort_order,
                                  } as any).eq("id", a.item_id);
                                }
                              }

                              await fetchProposalDetails(selectedProposal.id);
                              const msg = duplicates.length > 0
                                ? `已归类 ${assignments.length} 个条目，合并删除 ${duplicates.length} 个重复项`
                                : `已重新归类 ${assignments.length} 个目录条目`;
                              toast({ title: "目录整理完成", description: msg });
                            } catch (e: any) {
                              toast({ title: "目录整理失败", description: e.message, variant: "destructive" });
                            } finally {
                              setOrganizingToc(false);
                            }
                          }}
                          isOrganizing={organizingToc}
                        />
                      ) : (
                        <div className="space-y-1">
                          {(() => {
                            const tocByParent = new Map<string, TocEntry[]>();
                            tocEntries.forEach(e => {
                              const pid = e.parent_section_id || "__root__";
                              if (!tocByParent.has(pid)) tocByParent.set(pid, []);
                              tocByParent.get(pid)!.push(e);
                            });
                            const renderSectionWithToc = (section: ProposalSection, depth = 0): React.ReactNode => {
                              const tocChildren = tocByParent.get(section.id) || [];
                              const hasChildren = (section.children && section.children.length > 0) || tocChildren.length > 0;
                              const isExpanded = expandedSections.has(section.id);
                              return (
                                <div key={section.id}>
                                  <button
                                    className="flex items-center gap-1.5 w-full text-left py-1.5 px-2 rounded hover:bg-muted/50 text-sm"
                                    style={{ paddingLeft: depth * 16 + 8 }}
                                    onClick={() => toggleSection(section.id)}
                                  >
                                    {hasChildren ? (
                                      isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    ) : (
                                      <span className="w-3.5 shrink-0" />
                                    )}
                                    {section.section_number && (
                                      <span className="text-muted-foreground text-xs font-mono shrink-0">{section.section_number}</span>
                                    )}
                                    <span className="truncate font-medium">{section.title}</span>
                                    {tocChildren.length > 0 && !isExpanded && (
                                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 shrink-0">{tocChildren.length}项</Badge>
                                    )}
                                  </button>
                                  {isExpanded && (
                                    <>
                                      {section.children?.map(child => renderSectionWithToc(child, depth + 1))}
                                      {tocChildren.map(toc => (
                                        <div key={toc.id}>
                                          <button
                                            className="flex items-center gap-1.5 w-full text-left py-1.5 px-2 rounded hover:bg-muted/50 text-sm"
                                            style={{ paddingLeft: (depth + 1) * 16 + 8 }}
                                            onClick={() => toggleSection(toc.id)}
                                          >
                                            {toc.content ? (
                                              expandedSections.has(toc.id) ? <ChevronDown className="w-3.5 h-3.5 text-accent shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-accent shrink-0" />
                                            ) : (
                                              <span className="w-3.5 shrink-0" />
                                            )}
                                            {toc.section_number && (
                                              <span className="text-accent text-xs font-mono shrink-0">{toc.section_number}</span>
                                            )}
                                            <span className="truncate text-foreground/80">{toc.title}</span>
                                            {toc.content && !expandedSections.has(toc.id) && (
                                              <span className="ml-2 text-xs text-accent">●</span>
                                            )}
                                          </button>
                                          {expandedSections.has(toc.id) && toc.content && (
                                            <div style={{ paddingLeft: (depth + 2) * 16 + 8 }} className="mb-2 pr-2">
                                              <div className="border rounded-md p-3 bg-muted/30 text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                                                {toc.content}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </>
                                  )}
                                </div>
                              );
                            };
                            return sections.map(s => renderSectionWithToc(s));
                          })()}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Proposal document tab */}
              <TabsContent value="proposal" className="space-y-4">
                {docStatus === "pending" && (
                  <Card className="flex flex-col items-center justify-center py-16">
                    <Sparkles className="w-10 h-10 text-accent opacity-50 mb-4" />
                    <p className="text-sm font-medium text-foreground mb-2">尚未开始标书编写</p>
                    <p className="text-xs text-muted-foreground mb-6 max-w-md text-center">
                      根据标书目录和公司材料库，AI将自动匹配最相关的材料填入对应章节。未匹配的章节由AI智能生成内容。
                    </p>
                    <Button onClick={() => { handleGenerateProposal(); setWorkspaceMode(true); }} disabled={generatingDoc || sections.length === 0 || tocStatus !== "completed"}>
                      {generatingDoc ? (
                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" />提交中...</>
                      ) : (
                        <><Sparkles className="w-4 h-4 mr-1" />开始标书编写</>
                      )}
                    </Button>
                    {sections.length === 0 ? (
                      <p className="text-xs text-destructive mt-3">请先生成应答提纲</p>
                    ) : tocStatus !== "completed" ? (
                      <p className="text-xs text-destructive mt-3">请先生成标书目录后再开始编写</p>
                    ) : null}
                  </Card>
                )}

                {docStatus === "processing" && (
                  <Card className="flex items-center justify-center py-20">
                    <div className="text-center space-y-4 max-w-lg">
                      <Loader2 className="w-8 h-8 mx-auto animate-spin text-accent" />
                      <p className="text-sm font-medium text-foreground">
                        {docProgress || "正在编写标书..."}
                      </p>
                      {docProgress && (() => {
                        const match = docProgress.match(/(\d+)\/(\d+)/);
                        if (match) {
                          const current = parseInt(match[1]);
                          const total = parseInt(match[2]);
                          const pct = Math.round((current / total) * 100);
                          return (
                            <div className="space-y-2 w-full">
                              <Progress value={pct} className="h-2" />
                              <p className="text-xs text-muted-foreground">{pct}% 完成</p>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>AI正在逐章节编写，优先匹配公司材料库内容</p>
                        <p>未匹配的章节将由AI智能生成</p>
                      </div>
                      <div className="flex gap-2 justify-center pt-2">
                        <Button variant="outline" size="sm" onClick={handlePauseProposal}>
                          <Pause className="w-4 h-4 mr-1" />暂停
                        </Button>
                        <Button variant="destructive" size="sm" onClick={handleCancelProposal}>
                          <XCircle className="w-4 h-4 mr-1" />撤销
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {docStatus === "paused" && (
                  <Card className="flex items-center justify-center py-16">
                    <div className="text-center space-y-4">
                      <Pause className="w-10 h-10 mx-auto text-accent opacity-60" />
                      <div>
                        <p className="text-sm font-medium text-foreground">标书编写已暂停</p>
                        <p className="text-xs text-muted-foreground mt-1">{docProgress || "已保存当前进度"}</p>
                      </div>
                      <div className="flex gap-2 justify-center">
                        <Button onClick={() => handleGenerateProposal(true)} disabled={generatingDoc}>
                          {generatingDoc ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />恢复中...</> : <><Play className="w-4 h-4 mr-1" />继续编写</>}
                        </Button>
                        <Button variant="destructive" onClick={handleCancelProposal}>
                          <XCircle className="w-4 h-4 mr-1" />撤销
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {docStatus === "failed" && (
                  <Card className="flex items-center justify-center py-16">
                    <div className="text-center space-y-4">
                      <XCircle className="w-10 h-10 mx-auto text-destructive opacity-60" />
                      <div>
                        <p className="text-sm font-medium text-foreground">标书生成失败</p>
                        <p className="text-xs text-muted-foreground mt-1">{docProgress || "未知错误"}</p>
                      </div>
                      <Button onClick={() => handleGenerateProposal()} disabled={generatingDoc}>
                        {generatingDoc ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />重试中...</> : <><RefreshCw className="w-4 h-4 mr-1" />重新生成</>}
                      </Button>
                    </div>
                  </Card>
                )}

                {docStatus === "completed" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">标书已生成完毕</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setWorkspaceMode(true)}>
                          <MessageSquare className="w-4 h-4 mr-1" />进入编写工作台
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleGenerateProposal()} disabled={generatingDoc}>
                          <RefreshCw className="w-4 h-4 mr-1" />重新生成
                        </Button>
                        <Button size="sm" onClick={handleExportWord}>
                          <Download className="w-4 h-4 mr-1" />下载标书
                        </Button>
                      </div>
                    </div>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">标书内容预览</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="max-h-[600px]">
                          <div className="space-y-4">
                            {sections.map((section) => (
                              <div key={section.id}>
                                <h3 className="text-sm font-semibold text-foreground mb-1">
                                  {section.section_number && <span className="text-muted-foreground mr-1">{section.section_number}</span>}
                                  {section.title}
                                </h3>
                                {section.content && (
                                  <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                    {section.content.length > 500 ? section.content.slice(0, 500) + "..." : section.content}
                                  </p>
                                )}
                                {section.children?.map((child) => (
                                  <div key={child.id} className="ml-4 mt-2">
                                    <h4 className="text-xs font-medium text-foreground mb-0.5">
                                      {child.section_number && <span className="text-muted-foreground mr-1">{child.section_number}</span>}
                                      {child.title}
                                    </h4>
                                    {child.content && (
                                      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                        {child.content.length > 300 ? child.content.slice(0, 300) + "..." : child.content}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </div>
                )}
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
      {/* TOC Content Viewer Dialog (detail view) */}
      <Dialog open={!!viewingTocSection} onOpenChange={(open) => !open && setViewingTocSection(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-base">
              {viewingTocSection?.section_number && (
                <span className="text-muted-foreground mr-2">{viewingTocSection.section_number}</span>
              )}
              {viewingTocSection?.title}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed pr-4">
              {viewingTocSection?.content || "暂无内容"}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* TOC Import Dialog (detail view) */}
      <Dialog open={showTocImportDialog} onOpenChange={(open) => {
        if (!open) {
          setSelectedImportSource(null);
          setSelectedImportChapters(new Set());
        }
        setShowTocImportDialog(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              {selectedImportSource ? `选择要导入的章节 — ${selectedImportSource.name}` : "从公司材料库导入目录"}
            </DialogTitle>
            <DialogDescription className="sr-only">选择要导入的标书目录结构</DialogDescription>
          </DialogHeader>

          {tocImportSources.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">暂无可导入的目录结构</p>
              <p className="text-xs mt-1">请先在公司材料库中通过"材料提取"功能提取标书目录</p>
            </div>
          ) : !selectedImportSource ? (
            /* Step 1: Select project */
            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              <p className="text-sm text-muted-foreground">选择要导入的标书目录：</p>
              {tocImportSources.map((src) => (
                <Card
                  key={src.id}
                  className="cursor-pointer hover:border-accent/50 transition-colors"
                  onClick={() => {
                    setSelectedImportSource(src);
                    setSelectedImportChapters(new Set(src.toc.map((_: any, i: number) => i)));
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{src.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">{src.toc.length} 个章节</span>
                          {src.category && (
                            <Badge className={`text-[10px] ${src.category === "技术交付类" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"}`}>
                              {src.category}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
                      {src.toc.slice(0, 5).map((ch: any, idx: number) => (
                        <div key={idx} style={{ paddingLeft: `${((ch.level || 1) - 1) * 12}px` }}>
                          <span className="text-foreground/50 mr-1">{ch.section_number}</span>
                          {ch.title}
                        </div>
                      ))}
                      {src.toc.length > 5 && <p className="text-muted-foreground/50">...还有 {src.toc.length - 5} 个章节</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            /* Step 2: Select chapters */
            <>
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => { setSelectedImportSource(null); setSelectedImportChapters(new Set()); }}>
                  <ChevronLeft className="w-4 h-4 mr-1" />返回选择项目
                </Button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    已选 {selectedImportChapters.size}/{selectedImportSource.toc.length} 个章节
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      if (selectedImportChapters.size === selectedImportSource.toc.length) {
                        setSelectedImportChapters(new Set());
                      } else {
                        setSelectedImportChapters(new Set(selectedImportSource.toc.map((_: any, i: number) => i)));
                      }
                    }}
                  >
                    {selectedImportChapters.size === selectedImportSource.toc.length ? "取消全选" : "全选"}
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 max-h-[50vh] border rounded-md p-2">
                <div className="space-y-0.5">
                  {selectedImportSource.toc.map((ch: any, idx: number) => {
                    const checked = selectedImportChapters.has(idx);
                    return (
                      <label
                        key={idx}
                        className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                        style={{ paddingLeft: `${((ch.level || 1) - 1) * 16 + 8}px` }}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            const next = new Set(selectedImportChapters);
                            if (v) next.add(idx); else next.delete(idx);
                            setSelectedImportChapters(next);
                          }}
                          className="mt-0.5"
                        />
                        <span className="text-sm">
                          {ch.section_number && <span className="text-muted-foreground mr-1 font-mono text-xs">{ch.section_number}</span>}
                          <span className={ch.level === 1 ? "font-medium" : ""}>{ch.title}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setShowTocImportDialog(false)}>取消</Button>
                <Button
                  disabled={importingToc || selectedImportChapters.size === 0}
                  onClick={() => handleImportToc(selectedImportSource, selectedImportChapters)}
                >
                  {importingToc ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" />导入中...</>
                  ) : (
                    <>确认导入 ({selectedImportChapters.size} 个章节)</>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      </div>
    );
  }

  // ---- LIST VIEW ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">智能投标助手</h2>
          <p className="text-sm text-muted-foreground mt-1">管理所有投标标书，跟踪标书状态与进度</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setReuseMode(true)} disabled={reuseMode || creating || proposals.length === 0}>
            <RefreshCw className="w-4 h-4 mr-1" /> 复用原有投标标书
          </Button>
          <Button onClick={() => setCreating(true)} disabled={creating || reuseMode}>
            <Plus className="w-4 h-4 mr-1" /> 新建投标标书
          </Button>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <Card>
          <CardHeader><CardTitle className="text-base">新建投标标书</CardTitle></CardHeader>
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
              <label className="text-sm font-medium text-foreground">标书名称</label>
              <Input className="mt-1" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="可选，默认使用招标项目名" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">自定义提纲生成要求</label>
              <Textarea className="mt-1" rows={8} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="提纲生成的自定义要求..." />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Word模板（可选）</label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">上传.docx模板文件，导出时将按模板的字体、字号、行间距格式生成。</p>
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
                      try {
                        const parsed = await parseTemplateStyles(file);
                        setTemplateStyles(parsed);
                      } catch (err) { console.warn("Failed to parse template styles:", err); }
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
              {/* Display parsed template styles */}
              {templateStyles && (
                <div className="mt-3 p-3 rounded-lg bg-secondary/50 border border-border">
                  <p className="text-xs font-medium text-foreground mb-2">📋 模板样式解析结果</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    {([
                      ["正文", templateStyles.body],
                      ["标题", templateStyles.title],
                      ["一级标题", templateStyles.heading1],
                      ["二级标题", templateStyles.heading2],
                      ["三级标题", templateStyles.heading3],
                      ["四级标题", templateStyles.heading4],
                    ] as [string, HeadingStyle][]).filter(([, s]) => s.font || s.size).map(([label, s]) => (
                      <div key={label} className="flex items-baseline gap-1">
                        <span className="font-medium text-foreground">{label}:</span>
                        <span>
                          {s.font && s.font}
                          {s.size ? ` ${s.size / 2}pt` : ""}
                          {(s as HeadingStyle).bold ? " 加粗" : ""}
                          {(s as HeadingStyle).spaceBefore ? ` 段前${(s as HeadingStyle).spaceBefore! / 20}pt` : ""}
                          {(s as HeadingStyle).spaceAfter ? ` 段后${(s as HeadingStyle).spaceAfter! / 20}pt` : ""}
                          {(s as any).lineSpacing ? ` 行距${((s as any).lineSpacing / 240).toFixed(1)}倍` : ""}
                          {s.color ? <>{" "}<span className="inline-flex items-center gap-0.5"><span className="inline-block w-3 h-3 rounded-sm border border-border" style={{ backgroundColor: `#${s.color}` }} />#{s.color}</span></> : ""}
                        </span>
                      </div>
                    ))}
                    {templateStyles.pageMargin && (
                      <div className="col-span-2 flex items-baseline gap-1">
                        <span className="font-medium text-foreground">页边距:</span>
                        <span>
                          上{((templateStyles.pageMargin.top || 0) / 567).toFixed(1)}cm
                          {" "}下{((templateStyles.pageMargin.bottom || 0) / 567).toFixed(1)}cm
                          {" "}左{((templateStyles.pageMargin.left || 0) / 567).toFixed(1)}cm
                          {" "}右{((templateStyles.pageMargin.right || 0) / 567).toFixed(1)}cm
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
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

      {/* Reuse form */}
      {reuseMode && (
        <Card>
          <CardHeader><CardTitle className="text-base">复用原有投标标书</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">选择要复用的标书 *</label>
              <Select value={reuseSourceId} onValueChange={setReuseSourceId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="选择一个已有标书" /></SelectTrigger>
                <SelectContent>
                  {proposals.filter(p => p.ai_status === "completed").map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.project_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">新标书名称</label>
              <Input className="mt-1" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="可选，默认在原名后加 (复用)" />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleReuseCreate} disabled={!reuseSourceId || generating}>
                {generating ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />复用中...</> : <><RefreshCw className="w-4 h-4 mr-1" />确认复用</>}
              </Button>
              <Button variant="outline" onClick={() => { setReuseMode(false); setReuseSourceId(""); setProjectName(""); }} disabled={generating}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bid list table */}
      <Card>
        <CardContent className="p-0">
          {proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <ClipboardCheck className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">暂无投标标书，点击右上角新建</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[50%]">标书名称</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">提纲状态</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">方案状态</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">创建日期</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border/50 hover:bg-secondary/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedProposal(p)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground line-clamp-2">{p.project_name}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <Badge variant={p.ai_status === "completed" ? "default" : p.ai_status === "processing" ? "secondary" : p.ai_status === "failed" ? "destructive" : "outline"} className="text-xs">
                          {p.ai_status === "completed" ? "提纲完成" : p.ai_status === "processing" ? "生成中" : p.ai_status === "failed" ? "失败" : "待处理"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <Badge variant={
                          (p as any).proposal_doc_status === "completed" ? "default" :
                          (p as any).proposal_doc_status === "processing" ? "secondary" :
                          (p as any).proposal_doc_status === "failed" ? "destructive" : "outline"
                        } className="text-xs">
                          {(p as any).proposal_doc_status === "completed" ? "方案完成" :
                           (p as any).proposal_doc_status === "processing" ? "生成中" :
                           (p as any).proposal_doc_status === "failed" ? "失败" : "待生成"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-right whitespace-nowrap">
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedProposal(p); }}>
                            <ChevronRight className="w-4 h-4" /> 查看
                          </Button>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} className="text-destructive hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {/* TOC Content Viewer Dialog */}
      <Dialog open={!!viewingTocSection} onOpenChange={(open) => !open && setViewingTocSection(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-base">
              {viewingTocSection?.section_number && (
                <span className="text-muted-foreground mr-2">{viewingTocSection.section_number}</span>
              )}
              {viewingTocSection?.title}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed pr-4">
              {viewingTocSection?.content || "暂无内容"}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* TOC Import Dialog */}
      <Dialog open={showTocImportDialog} onOpenChange={(open) => {
        if (!open) {
          setSelectedImportSource(null);
          setSelectedImportChapters(new Set());
        }
        setShowTocImportDialog(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              {selectedImportSource ? `选择要导入的章节 — ${selectedImportSource.name}` : "从公司材料库导入目录"}
            </DialogTitle>
            <DialogDescription className="sr-only">选择要导入的标书目录结构</DialogDescription>
          </DialogHeader>

          {tocImportSources.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">暂无可导入的目录结构</p>
              <p className="text-xs mt-1">请先在公司材料库中通过"材料提取"功能提取标书目录</p>
            </div>
          ) : !selectedImportSource ? (
            /* Step 1: Select project */
            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              <p className="text-sm text-muted-foreground">选择要导入的标书目录：</p>
              {tocImportSources.map((src) => (
                <Card
                  key={src.id}
                  className="cursor-pointer hover:border-accent/50 transition-colors"
                  onClick={() => {
                    setSelectedImportSource(src);
                    setSelectedImportChapters(new Set(src.toc.map((_: any, i: number) => i)));
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{src.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">{src.toc.length} 个章节</span>
                          {src.category && (
                            <Badge className={`text-[10px] ${src.category === "技术交付类" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"}`}>
                              {src.category}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
                      {src.toc.slice(0, 5).map((ch: any, idx: number) => (
                        <div key={idx} style={{ paddingLeft: `${((ch.level || 1) - 1) * 12}px` }}>
                          <span className="text-foreground/50 mr-1">{ch.section_number}</span>
                          {ch.title}
                        </div>
                      ))}
                      {src.toc.length > 5 && <p className="text-muted-foreground/50">...还有 {src.toc.length - 5} 个章节</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            /* Step 2: Select chapters */
            <>
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => { setSelectedImportSource(null); setSelectedImportChapters(new Set()); }}>
                  <ChevronLeft className="w-4 h-4 mr-1" />返回选择项目
                </Button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    已选 {selectedImportChapters.size}/{selectedImportSource.toc.length} 个章节
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      if (selectedImportChapters.size === selectedImportSource.toc.length) {
                        setSelectedImportChapters(new Set());
                      } else {
                        setSelectedImportChapters(new Set(selectedImportSource.toc.map((_: any, i: number) => i)));
                      }
                    }}
                  >
                    {selectedImportChapters.size === selectedImportSource.toc.length ? "取消全选" : "全选"}
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 max-h-[50vh] border rounded-md p-2">
                <div className="space-y-0.5">
                  {selectedImportSource.toc.map((ch: any, idx: number) => {
                    const checked = selectedImportChapters.has(idx);
                    return (
                      <label
                        key={idx}
                        className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                        style={{ paddingLeft: `${((ch.level || 1) - 1) * 16 + 8}px` }}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            const next = new Set(selectedImportChapters);
                            if (v) next.add(idx); else next.delete(idx);
                            setSelectedImportChapters(next);
                          }}
                          className="mt-0.5"
                        />
                        <span className="text-sm">
                          {ch.section_number && <span className="text-muted-foreground mr-1 font-mono text-xs">{ch.section_number}</span>}
                          <span className={ch.level === 1 ? "font-medium" : ""}>{ch.title}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setShowTocImportDialog(false)}>取消</Button>
                <Button
                  disabled={importingToc || selectedImportChapters.size === 0}
                  onClick={() => handleImportToc(selectedImportSource, selectedImportChapters)}
                >
                  {importingToc ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" />导入中...</>
                  ) : (
                    <>确认导入 ({selectedImportChapters.size} 个章节)</>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionNode({
  section,
  expanded,
  onToggle,
  depth = 0,
  onViewContent,
  showContentInline = false,
}: {
  section: ProposalSection;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  depth?: number;
  onViewContent?: (section: ProposalSection) => void;
  showContentInline?: boolean;
}) {
  const hasChildren = section.children && section.children.length > 0;
  const isExpanded = expanded.has(section.id);
  const hasContent = !!section.content && section.content.trim().length > 0;

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <div className="flex items-start gap-1 group">
        <button
          onClick={() => onToggle(section.id)}
          className="flex-1 text-left flex items-start gap-1.5 px-2 py-1.5 rounded hover:bg-secondary transition-colors min-w-0"
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground">
              {section.section_number && <span className="text-muted-foreground mr-1">{section.section_number}</span>}
              {section.title}
            </span>
            {showContentInline && hasContent && !isExpanded && (
              <span className="ml-2 text-xs text-accent">●</span>
            )}
          </div>
        </button>
        {showContentInline && hasContent && onViewContent && (
          <button
            onClick={() => onViewContent(section)}
            className="opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 px-1.5 py-0.5 rounded text-xs text-accent hover:bg-accent/10 shrink-0"
          >
            查看
          </button>
        )}
      </div>
      {showContentInline && isExpanded && hasContent && (
        <div style={{ paddingLeft: depth > 0 ? 16 : 24 }} className="mb-2">
          <div className="border rounded-md p-3 bg-muted/30 text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
            {section.content}
          </div>
        </div>
      )}
      {isExpanded && hasChildren && (
        <div>
          {section.children!.map((child) => (
            <SectionNode key={child.id} section={child} expanded={expanded} onToggle={onToggle} depth={depth + 1} onViewContent={onViewContent} showContentInline={showContentInline} />
          ))}
        </div>
      )}
    </div>
  );
}
