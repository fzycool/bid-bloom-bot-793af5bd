import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, ChevronRight, ChevronDown, Download, Loader2,
  GripVertical, Trash2, FolderOpen, ArrowRight, Package,
  ChevronLeft, Search, Zap, Star, Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import JSZip from "jszip";
import { saveAs } from "file-saver";

// ─── Types ─────────────────────────────────────────────────────────

interface ProposalSection {
  id: string;
  section_number: string | null;
  title: string;
  content: string | null;
  sort_order: number;
  parent_id: string | null;
  children?: ProposalSection[];
}

interface MaterialItem {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  material_type: string | null;
  content_description: string | null;
  bid_analysis_id: string | null;
  project_name?: string;
}

interface AssemblyMapping {
  [sectionId: string]: MaterialItem[];
}

interface Props {
  proposalId: string;
  sections: ProposalSection[];
  onEnterWorkspace?: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────

function flattenTree(nodes: ProposalSection[], depth = 0): { section: ProposalSection; depth: number }[] {
  const result: { section: ProposalSection; depth: number }[] = [];
  for (const n of nodes) {
    result.push({ section: n, depth });
    if (n.children?.length) result.push(...flattenTree(n.children, depth + 1));
  }
  return result;
}

// ─── Component ─────────────────────────────────────────────────────

export default function ProposalAssembler({ proposalId, sections, onEnterWorkspace }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [assembly, setAssembly] = useState<AssemblyMapping>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [draggedMaterial, setDraggedMaterial] = useState<MaterialItem | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // For reordering assigned materials within sections
  const [reorderDrag, setReorderDrag] = useState<{ sectionId: string; matId: string } | null>(null);
  const [reorderDropIndex, setReorderDropIndex] = useState<{ sectionId: string; index: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | "all">("all");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAssemblyRef = useRef<string>("");

  // Fetch extracted DOCX materials
  const fetchMaterials = useCallback(async () => {
    if (!user) return;
    setLoadingMaterials(true);

    // Get all completed DOCX materials (extracted chapters)
    const { data: mats, error } = await supabase
      .from("company_materials")
      .select("id, file_name, file_path, file_size, material_type, content_description, bid_analysis_id")
      .eq("user_id", user.id)
      .eq("ai_status", "completed")
      .eq("file_type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("fetch materials error:", error);
      setLoadingMaterials(false);
      return;
    }

    // Fetch project names for bid_analysis_ids
    const analysisIds = [...new Set((mats || []).map(m => m.bid_analysis_id).filter(Boolean))];
    let projectMap = new Map<string, string>();
    if (analysisIds.length > 0) {
      const { data: analyses } = await supabase
        .from("bid_analyses")
        .select("id, project_name")
        .in("id", analysisIds as string[]);
      if (analyses) {
        for (const a of analyses) {
          projectMap.set(a.id, a.project_name || "未命名项目");
        }
      }
    }

    const items: MaterialItem[] = (mats || []).map(m => ({
      ...m,
      project_name: m.bid_analysis_id ? projectMap.get(m.bid_analysis_id) || "未命名项目" : "通用材料",
    }));

    setMaterials(items);
    setLoadingMaterials(false);
  }, [user]);

  useEffect(() => { fetchMaterials(); }, [fetchMaterials]);

  const decodeXmlText = (text: string) => text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');

  const extractDocxParagraphs = (docXml: string) => {
    const cleanedXml = docXml
      .replace(/<w:fldChar[^>]*w:fldCharType="begin"[^>]*\/>[\s\S]*?<w:fldChar[^>]*w:fldCharType="end"[^>]*\/>/g, "")
      .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "")
      .replace(/<w:fldSimple[^>]*>([\s\S]*?)<\/w:fldSimple>/g, "$1");

    const paragraphs: string[] = [];
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pRe.exec(cleanedXml)) !== null) {
      const pContent = pMatch[1];
      if (/<w:pStyle[^>]*w:val="TOC/.test(pContent)) continue;

      const textParts: string[] = [];
      const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRe.exec(pContent)) !== null) {
        textParts.push(decodeXmlText(tMatch[1]));
      }

      const text = textParts.join(/<w:tab\/>/.test(pContent) ? "\t" : "").trim();
      if (!text) continue;
      if (/^PAGEREF\b/i.test(text)) continue;
      paragraphs.push(text);
    }

    return paragraphs;
  };

  const buildWorkspaceContent = useCallback(async (mats: MaterialItem[]) => {
    const blocks: string[] = [];

    for (const mat of mats) {
      const { data } = await supabase.storage.from("company-materials").download(mat.file_path);
      if (!data) continue;
      const zip = await JSZip.loadAsync(data);
      const docXml = await zip.file("word/document.xml")?.async("string");
      if (!docXml) continue;

      const bodyText = extractDocxParagraphs(docXml).join("\n").trim();
      if (bodyText) {
        blocks.push(`【来源：公司材料库（原样移植） - ${mat.file_name}】\n${bodyText}`);
      }
    }

    return blocks.join("\n\n").trim();
  }, []);

  // Expand all sections by default
  useEffect(() => {
    const allIds = new Set<string>();
    const collect = (nodes: ProposalSection[]) => {
      for (const n of nodes) {
        allIds.add(n.id);
        if (n.children) collect(n.children);
      }
    };
    collect(sections);
    setExpandedSections(allIds);
  }, [sections]);

  // ─── Auto-save assembly to proposal_sections ───────────────────
  useEffect(() => {
    const serialized = JSON.stringify(assembly);
    if (serialized === prevAssemblyRef.current) return;
    // Skip initial empty state
    if (serialized === "{}" && prevAssemblyRef.current === "") {
      prevAssemblyRef.current = serialized;
      return;
    }
    prevAssemblyRef.current = serialized;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const entries = Object.entries(assembly);
      if (entries.length === 0) return;

      setAutoSaving(true);
      try {
        for (const [sectionId, mats] of entries) {
          const materialRefs = mats.map((m) => ({ file_path: m.file_path, file_name: m.file_name }));
          const content = await buildWorkspaceContent(mats);
          await supabase.from("proposal_sections").update({
            content,
            source_type: "material_assembly",
            source_id: JSON.stringify(materialRefs),
          }).eq("id", sectionId);
        }
        console.log("[AutoSave] Assembly saved to proposal_sections");
      } catch (err: any) {
        console.error("[AutoSave] Error:", err);
      } finally {
        setAutoSaving(false);
      }
    }, 2000); // 2 second debounce

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [assembly, buildWorkspaceContent]);



  const handleDragStart = (mat: MaterialItem) => {
    setDraggedMaterial(mat);
  };

  const handleDragOver = (e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropTargetId(sectionId);
  };

  const handleDragLeave = () => {
    setDropTargetId(null);
  };

  const handleDrop = (e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    setDropTargetId(null);
    if (!draggedMaterial) return;

    // Avoid duplicates in the same section
    setAssembly(prev => {
      const existing = prev[sectionId] || [];
      if (existing.some(m => m.id === draggedMaterial.id)) return prev;
      return { ...prev, [sectionId]: [...existing, draggedMaterial] };
    });
    setDraggedMaterial(null);
  };

  const handleRemoveMaterial = (sectionId: string, materialId: string) => {
    setAssembly(prev => {
      const existing = prev[sectionId] || [];
      const updated = existing.filter(m => m.id !== materialId);
      if (updated.length === 0) {
        const next = { ...prev };
        delete next[sectionId];
        return next;
      }
      return { ...prev, [sectionId]: updated };
    });
  };

  // ─── Reorder assigned materials via drag ───────────────────────
  const handleAssignedDragStart = (sectionId: string, matId: string) => {
    setReorderDrag({ sectionId, matId });
  };

  const handleAssignedDragOver = (e: React.DragEvent, sectionId: string, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setReorderDropIndex({ sectionId, index });
  };

  const handleAssignedDrop = (e: React.DragEvent, targetSectionId: string, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setReorderDropIndex(null);
    if (!reorderDrag) return;

    const { sectionId: srcSectionId, matId } = reorderDrag;
    setReorderDrag(null);

    setAssembly(prev => {
      const next = { ...prev };
      // Find the material
      const srcList = [...(next[srcSectionId] || [])];
      const matIndex = srcList.findIndex(m => m.id === matId);
      if (matIndex < 0) return prev;
      const [mat] = srcList.splice(matIndex, 1);

      if (srcSectionId === targetSectionId) {
        // Reorder within same section
        srcList.splice(targetIndex, 0, mat);
        next[srcSectionId] = srcList;
      } else {
        // Move to different section
        if (srcList.length === 0) delete next[srcSectionId];
        else next[srcSectionId] = srcList;
        const dstList = [...(next[targetSectionId] || [])];
        if (dstList.some(m => m.id === matId)) return prev; // already there
        dstList.splice(targetIndex, 0, mat);
        next[targetSectionId] = dstList;
      }
      return next;
    });
  };

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── DOCX Merge & Download ─────────────────────────────────────

  const handleDownload = async () => {
    const totalMats = Object.values(assembly).flat();
    if (totalMats.length === 0) {
      toast({ title: "请先拖入材料", description: "将右侧材料拖到左侧章节中", variant: "destructive" });
      return;
    }

    setDownloading(true);
    try {
      // Flatten sections in order
      const flat = flattenTree(sections);

      // Collect sections that have materials
      const orderedMats: { section: ProposalSection; depth: number; materials: MaterialItem[] }[] = [];
      for (const { section, depth } of flat) {
        const mats = assembly[section.id];
        if (mats && mats.length > 0) {
          orderedMats.push({ section, depth, materials: mats });
        }
      }

      if (orderedMats.length === 0) {
        toast({ title: "没有可组装的内容", variant: "destructive" });
        setDownloading(false);
        return;
      }

      // Use the first material's DOCX as template for styles, headers, etc.
      const firstMat = orderedMats[0].materials[0];
      const { data: templateData } = await supabase.storage
        .from("company-materials")
        .download(firstMat.file_path);
      if (!templateData) throw new Error("无法下载模板文件");

      const templateZip = await JSZip.loadAsync(templateData);
      const templateDocXml = await templateZip.file("word/document.xml")?.async("string");
      if (!templateDocXml) throw new Error("模板文件格式错误");

      // Extract template structure
      const bodyTag = templateDocXml.match(/<w:body[^>]*>/);
      if (!bodyTag) throw new Error("无法解析模板结构");
      const bodyStart = bodyTag.index! + bodyTag[0].length;
      const bodyEnd = templateDocXml.lastIndexOf("</w:body>");
      if (bodyEnd < 0) throw new Error("无法找到 body 结束标签");
      const body = templateDocXml.substring(bodyStart, bodyEnd);
      const sectMatch = body.match(/<w:sectPr\b[\s\S]*<\/w:sectPr>\s*$/);
      const sectPr = sectMatch ? sectMatch[0] : "";
      let docPrefix = templateDocXml.substring(0, bodyStart);
      const docSuffix = templateDocXml.substring(bodyEnd);

      // Collect all namespace declarations we might need
      const nsSet = new Set<string>();
      const nsRe = /xmlns:\w+="[^"]+"/g;
      let nsm: RegExpExecArray | null;
      while ((nsm = nsRe.exec(docPrefix)) !== null) nsSet.add(nsm[0]);

      // Build output zip starting from template (copy everything except document.xml)
      const outZip = new JSZip();
      const copyJobs: Promise<void>[] = [];
      templateZip.forEach((path, entry) => {
        if (entry.dir || path === "word/document.xml") return;
        copyJobs.push(entry.async("uint8array").then(d => { outZip.file(path, d); }));
      });
      await Promise.all(copyJobs);

      // Detect available heading style IDs from template styles.xml
      let headingStyleIds = ["Heading1", "Heading2", "Heading3", "Heading4"];
      try {
        const stylesFile = templateZip.file("word/styles.xml");
        if (stylesFile) {
          const stylesXml = await stylesFile.async("string");
          const foundIds: string[] = [];
          const styleIdRe = /<w:style[^>]*w:styleId="([^"]*[Hh]eading\d+|[^"]*标题\s*\d+)[^"]*"/g;
          let sm: RegExpExecArray | null;
          while ((sm = styleIdRe.exec(stylesXml)) !== null) {
            foundIds.push(sm[1]);
          }
          if (foundIds.length === 0) {
            const builtinRe = /<w:style[^>]*w:type="paragraph"[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name\s+w:val="heading\s*(\d+)"[^\/]*\/>[\s\S]*?<\/w:style>/gi;
            while ((sm = builtinRe.exec(stylesXml)) !== null) {
              const level = parseInt(sm[2]);
              if (level >= 1 && level <= 4) {
                foundIds[level - 1] = sm[1];
              }
            }
          }
          if (foundIds.length > 0) {
            headingStyleIds = foundIds.slice(0, 4);
            while (headingStyleIds.length < 4) headingStyleIds.push(headingStyleIds[headingStyleIds.length - 1]);
          }
        }
      } catch { /* use defaults */ }

      // Collect all body content and media from each material
      let combinedBody = "";
      let mediaCounter = 0;
      const relEntries: string[] = [];
      const newMediaExtensions = new Set<string>();
      let existingRels = "";
      try {
        const relsFile = templateZip.file("word/_rels/document.xml.rels");
        if (relsFile) existingRels = await relsFile.async("string");
      } catch { /* ignore */ }

      // Process each section's materials
      const processedPaths = new Set<string>();
      processedPaths.add(firstMat.file_path);
      let isFirstSection = true;

      for (const { section, depth, materials: sectionMats } of orderedMats) {
        // Add page break before each section (except the first)
        if (!isFirstSection) {
          combinedBody += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
        }
        isFirstSection = false;

        // Add section heading using inline formatting (bold, larger font) to avoid style dependency issues
        const sectionTitle = `${section.section_number ? section.section_number + " " : ""}${section.title}`;
        const level = Math.min(depth, 3);
        const fontSize = level === 0 ? "32" : level === 1 ? "28" : level === 2 ? "24" : "22"; // half-points
        combinedBody += `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/></w:rPr><w:t xml:space="preserve">${escapeXml(sectionTitle)}</w:t></w:r></w:p>`;

        for (const mat of sectionMats) {
          let matZip: JSZip;
          let matDocXml: string;

          if (processedPaths.has(mat.file_path) && mat.file_path === firstMat.file_path) {
            matZip = templateZip;
            matDocXml = templateDocXml;
          } else {
            const { data: matData } = await supabase.storage
              .from("company-materials")
              .download(mat.file_path);
            if (!matData) {
              console.warn(`Skip material ${mat.file_name}: download failed`);
              continue;
            }
            matZip = await JSZip.loadAsync(matData);
            const docFile = matZip.file("word/document.xml");
            if (!docFile) continue;
            matDocXml = await docFile.async("string");

            // Collect namespaces from this material's document root
            const matDocTag = matDocXml.match(/<w:document[^>]*>/);
            if (matDocTag) {
              let nsmm: RegExpExecArray | null;
              const matNsRe = /xmlns:\w+="[^"]+"/g;
              while ((nsmm = matNsRe.exec(matDocTag[0])) !== null) nsSet.add(nsmm[0]);
            }
          }

          // Extract body content
          const matBodyTag = matDocXml.match(/<w:body[^>]*>/);
          if (!matBodyTag) continue;
          const matBodyStart = matBodyTag.index! + matBodyTag[0].length;
          const matBodyEnd = matDocXml.lastIndexOf("</w:body>");
          let matBody = matDocXml.substring(matBodyStart, matBodyEnd);
          // Remove sectPr from material body
          const matSectMatch = matBody.match(/<w:sectPr\b[\s\S]*<\/w:sectPr>\s*$/);
          if (matSectMatch) matBody = matBody.substring(0, matSectMatch.index!);

          // Copy media files and remap relationships
          let matRelsXml: string | null = null;
          try {
            const relsFile = matZip.file("word/_rels/document.xml.rels");
            if (relsFile) matRelsXml = await relsFile.async("string");
          } catch { /* ignore */ }

          if (matRelsXml && mat.file_path !== firstMat.file_path) {
            // Find all rIds referenced in the body
            const ridRe = /r:(?:id|embed|link)="(rId\d+)"/g;
            const rids = new Set<string>();
            let rm: RegExpExecArray | null;
            while ((rm = ridRe.exec(matBody)) !== null) rids.add(rm[1]);

            // Parse relationships
            const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*Type="([^"]+)"[^>]*\/?>/g;
            let relMatch: RegExpExecArray | null;
            while ((relMatch = relRe.exec(matRelsXml)) !== null) {
              const [, relId, relTarget, relType] = relMatch;
              if (!rids.has(relId)) continue;

              // Copy media/embedding files
              const targetPath = relTarget.startsWith("/")
                ? relTarget.substring(1)
                : `word/${relTarget}`;

              if (relType.includes("image") || relType.includes("oleObject") || relType.includes("chart")) {
                mediaCounter++;
                const ext = targetPath.split(".").pop() || "bin";
                newMediaExtensions.add(ext);
                const newMediaName = `media/merged_${mediaCounter}.${ext}`;
                const newMediaPath = `word/${newMediaName}`;
                const newRelId = `rMerge${mediaCounter}`;

                // Copy media file
                const mediaFile = matZip.file(targetPath);
                if (mediaFile) {
                  const mediaData = await mediaFile.async("uint8array");
                  outZip.file(newMediaPath, mediaData);
                }

                // Remap rId in body
                const ridPattern = new RegExp(`(r:(?:id|embed|link)=")${relId}"`, "g");
                matBody = matBody.replace(ridPattern, `$1${newRelId}"`);

                // Add relationship entry
                relEntries.push(`<Relationship Id="${newRelId}" Target="${newMediaName}" Type="${relType}"/>`);
              }
            }
          }

          combinedBody += matBody;
          processedPaths.add(mat.file_path);
        }
      }

      // Merge all collected namespaces into the document root element
      const docTagMatch = docPrefix.match(/<w:document([^>]*)>/);
      if (docTagMatch) {
        let docAttrs = docTagMatch[1];
        for (const ns of nsSet) {
          if (!docAttrs.includes(ns)) {
            docAttrs += ` ${ns}`;
          }
        }
        docPrefix = docPrefix.replace(/<w:document[^>]*>/, `<w:document${docAttrs}>`);
      }

      // Build final document.xml
      const finalDocXml = docPrefix + combinedBody + sectPr + docSuffix;
      outZip.file("word/document.xml", finalDocXml);

      // Update relationships file with new entries
      if (relEntries.length > 0 && existingRels) {
        const updatedRels = existingRels.replace(
          "</Relationships>",
          relEntries.join("") + "</Relationships>"
        );
        outZip.file("word/_rels/document.xml.rels", updatedRels);
      }

      // Update [Content_Types].xml with any new media extensions
      if (newMediaExtensions.size > 0) {
        const ctFile = outZip.file("[Content_Types].xml");
        if (ctFile) {
          let ctXml = await ctFile.async("string");
          const extMimeMap: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            bmp: "image/bmp",
            tiff: "image/tiff",
            tif: "image/tiff",
            emf: "image/x-emf",
            wmf: "image/x-wmf",
            svg: "image/svg+xml",
            bin: "application/octet-stream",
          };
          for (const ext of newMediaExtensions) {
            // Only add if not already present
            if (!ctXml.includes(`Extension="${ext}"`)) {
              const mime = extMimeMap[ext.toLowerCase()] || "application/octet-stream";
              ctXml = ctXml.replace(
                "</Types>",
                `<Default Extension="${ext}" ContentType="${mime}"/></Types>`
              );
            }
          }
          outZip.file("[Content_Types].xml", ctXml);
        }
      }

      // Generate and download
      const blob = await outZip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      const proposalName = sections.length > 0
        ? sections[0].title.replace(/[^\w\u4e00-\u9fa5]/g, "").substring(0, 30)
        : "标书";
      saveAs(blob, `${proposalName}_组装标书.docx`);

      toast({ title: "下载成功", description: "组装标书已下载" });
    } catch (err: any) {
      console.error("Download error:", err);
      toast({ title: "下载失败", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  // Save assembled content to proposal sections for workspace editing
  const handleSendToWorkspace = async () => {
    const totalMats = Object.values(assembly).flat();
    if (totalMats.length === 0) {
      toast({ title: "请先拖入材料", variant: "destructive" });
      return;
    }

    setDownloading(true);
    try {
      // For each section with assigned materials, save actual content + source metadata
      for (const [sectionId, mats] of Object.entries(assembly)) {
        const materialRefs = mats.map((m) => ({ file_path: m.file_path, file_name: m.file_name }));
        const content = await buildWorkspaceContent(mats);
        await supabase.from("proposal_sections").update({
          content,
          source_type: "material_assembly",
          source_id: JSON.stringify(materialRefs),
        }).eq("id", sectionId);
      }

      toast({ title: "已同步到工作台", description: "拼凑内容已写入各章节，可进入编写工作台修改" });
      onEnterWorkspace?.();
    } catch (err: any) {
      toast({ title: "同步失败", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  // ─── Filtered materials ─────────────────────────────────────────

  const projects = Array.from(new Set(materials.map(m => m.project_name || "通用材料")));

  const filteredMaterials = materials.filter(m => {
    const matchesSearch = !searchQuery ||
      m.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.content_description || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProject = selectedProject === "all" ||
      (m.project_name || "通用材料") === selectedProject;
    return matchesSearch && matchesProject;
  });

  // Group by project (used when no section selected)
  const groupedMaterials = new Map<string, MaterialItem[]>();
  for (const m of filteredMaterials) {
    const key = m.project_name || "通用材料";
    if (!groupedMaterials.has(key)) groupedMaterials.set(key, []);
    groupedMaterials.get(key)!.push(m);
  }

  // ─── Similarity scoring ─────────────────────────────────────────

  const extractKeywords = (text: string): string[] => {
    if (!text) return [];
    return (text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]{2,}/gi) || []).filter(t => t.length >= 2);
  };

  const computeScore = useCallback((sectionTitle: string, mat: MaterialItem): number => {
    const sectionKw = extractKeywords(sectionTitle);
    if (sectionKw.length === 0) return 0;
    const matText = `${mat.file_name} ${mat.content_description || ""} ${mat.material_type || ""}`.toLowerCase();
    const matKw = extractKeywords(matText);
    let score = 0;
    for (const kw of sectionKw) {
      if (matText.includes(kw)) score += 3;
      for (const mk of matKw) {
        if (mk === kw) { score += 5; break; }
        if (mk.includes(kw) || kw.includes(mk)) { score += 2; break; }
      }
    }
    const cleanTitle = sectionTitle.replace(/[\d.、\s]/g, "").toLowerCase();
    const cleanFileName = mat.file_name.replace(/\.\w+$/, "").replace(/[\d._\s]/g, "").toLowerCase();
    if (cleanFileName && cleanTitle && (cleanFileName.includes(cleanTitle) || cleanTitle.includes(cleanFileName))) {
      score += 10;
    }
    return score;
  }, []);

  const getSelectedSectionTitle = (): string => {
    if (!selectedSectionId) return "";
    const find = (nodes: ProposalSection[]): ProposalSection | null => {
      for (const n of nodes) {
        if (n.id === selectedSectionId) return n;
        if (n.children) { const f = find(n.children); if (f) return f; }
      }
      return null;
    };
    const s = find(sections);
    return s ? `${s.section_number || ""} ${s.title}` : "";
  };

  const selectedTitle = getSelectedSectionTitle();

  const scoredMaterials = filteredMaterials.map(mat => ({
    mat,
    score: selectedSectionId ? computeScore(selectedTitle, mat) : 0,
  }));

  if (selectedSectionId) {
    scoredMaterials.sort((a, b) => b.score - a.score);
  }

  const matchedCount = scoredMaterials.filter(s => s.score > 0).length;

  // ─── Auto-assemble: match materials to sections by title similarity ──
  const handleAutoAssemble = useCallback(() => {
    const flat = flattenTree(sections);
    const usedMatIds = new Set<string>();
    const newAssembly: AssemblyMapping = { ...assembly };

    // For each section, find the best matching material(s) not yet used
    const MIN_SCORE = 5;
    for (const { section } of flat) {
      const sectionTitle = `${section.section_number || ""} ${section.title}`;
      // Score all unused materials
      const scored = materials
        .filter(m => !usedMatIds.has(m.id))
        .map(m => ({ mat: m, score: computeScore(sectionTitle, m) }))
        .filter(s => s.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) continue;

      // Take the best match (only top 1 to avoid over-filling)
      const best = scored[0];
      const existing = newAssembly[section.id] || [];
      if (!existing.some(m => m.id === best.mat.id)) {
        newAssembly[section.id] = [...existing, best.mat];
        usedMatIds.add(best.mat.id);
      }
    }

    const newCount = Object.values(newAssembly).flat().length;
    const prevCount = Object.values(assembly).flat().length;
    setAssembly(newAssembly);
    toast({
      title: "自动拼装完成",
      description: `已匹配 ${newCount - prevCount} 个材料到对应章节，可手动调整`,
    });
  }, [sections, materials, assembly, computeScore, toast]);

  const totalAssembled = Object.values(assembly).flat().length;

  // ─── Render section tree with drop zones ─────────────────────

  const renderSection = (section: ProposalSection, depth: number): React.ReactNode => {
    const hasChildren = section.children && section.children.length > 0;
    const isExpanded = expandedSections.has(section.id);
    const assignedMats = assembly[section.id] || [];
    const isDropTarget = dropTargetId === section.id;

    return (
      <div key={section.id}>
        <div
          className={`flex items-start gap-1 rounded-lg transition-all ${
            isDropTarget ? "bg-accent/15 ring-2 ring-accent ring-offset-1" : draggedMaterial ? "hover:bg-accent/10 hover:ring-1 hover:ring-accent/40" : ""
          }`}
          style={{ paddingLeft: depth * 16 }}
          onDragOver={(e) => handleDragOver(e, section.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, section.id)}
        >
          <button
            onClick={() => {
              toggleSection(section.id);
              setSelectedSectionId(section.id);
            }}
            className={`flex-1 text-left flex items-start gap-1.5 px-2 py-2 rounded transition-colors min-w-0 ${
              selectedSectionId === section.id ? "bg-accent/10 hover:bg-accent/15" : "hover:bg-secondary"
            }`}
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
              {assignedMats.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-[10px] px-1.5">{assignedMats.length}个材料</Badge>
              )}
            </div>
          </button>
        </div>

        {/* Assigned materials */}
        {assignedMats.length > 0 && (
          <div className="ml-8 mb-1" style={{ paddingLeft: depth * 16 }}>
            {assignedMats.map((mat, idx) => (
              <div key={mat.id}>
                {/* Drop indicator line above */}
                <div
                  className={`h-0.5 rounded transition-colors ${
                    reorderDropIndex?.sectionId === section.id && reorderDropIndex?.index === idx
                      ? "bg-accent my-0.5"
                      : "bg-transparent"
                  }`}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); handleAssignedDragOver(e, section.id, idx); }}
                  onDrop={(e) => handleAssignedDrop(e, section.id, idx)}
                />
                <div
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); handleAssignedDragStart(section.id, mat.id); }}
                  onDragEnd={() => { setReorderDrag(null); setReorderDropIndex(null); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); handleAssignedDragOver(e, section.id, idx); }}
                  onDrop={(e) => handleAssignedDrop(e, section.id, idx)}
                  className={`flex items-center gap-2 px-2 py-1 rounded bg-accent/10 border border-accent/20 text-xs group cursor-grab active:cursor-grabbing transition-all ${
                    reorderDrag?.matId === mat.id ? "opacity-40 scale-95" : ""
                  }`}
                >
                  <GripVertical className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  <span className="text-muted-foreground font-mono">{idx + 1}.</span>
                  <FileText className="w-3 h-3 text-accent shrink-0" />
                  <span className="truncate flex-1 text-foreground">{mat.file_name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                    onClick={() => handleRemoveMaterial(section.id, mat.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
            {/* Drop indicator at end */}
            <div
              className={`h-0.5 rounded transition-colors ${
                reorderDropIndex?.sectionId === section.id && reorderDropIndex?.index === assignedMats.length
                  ? "bg-accent my-0.5"
                  : "bg-transparent"
              }`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); handleAssignedDragOver(e, section.id, assignedMats.length); }}
              onDrop={(e) => handleAssignedDrop(e, section.id, assignedMats.length)}
            />
          </div>
        )}

        {/* Drop hint only visible while actively dragging over this section */}
        {draggedMaterial && (
          <div
            className={`ml-8 mb-1 rounded-lg px-3 py-1.5 text-xs text-center transition-all ${
              isDropTarget
                ? "border-2 border-dashed border-accent bg-accent/10 text-accent"
                : "border border-dashed border-transparent text-transparent h-0 py-0 overflow-hidden"
            }`}
            style={{ paddingLeft: depth * 16 }}
            onDragOver={(e) => handleDragOver(e, section.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, section.id)}
          >
            松开以添加到此章节
          </div>
        )}

        {isExpanded && hasChildren && (
          <div>
            {section.children!.map(child => renderSection(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (sections.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center py-16">
        <Package className="w-10 h-10 text-accent opacity-50 mb-4" />
        <p className="text-sm font-medium text-foreground mb-2">请先生成应答提纲</p>
        <p className="text-xs text-muted-foreground">需要有投标文件提纲才能进行标书组装</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            已分配 {totalAssembled} 个材料到 {Object.keys(assembly).length} 个章节
          </Badge>
          {autoSaving && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />自动保存中...
            </span>
          )}
          {!autoSaving && totalAssembled > 0 && (
            <span className="text-[10px] text-muted-foreground">✓ 已自动保存</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoAssemble}
            disabled={downloading || materials.length === 0}
          >
            <Zap className="w-4 h-4 mr-1" />
            自动拼装
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendToWorkspace}
            disabled={downloading || totalAssembled === 0}
          >
            <ArrowRight className="w-4 h-4 mr-1" />
            送入工作台
          </Button>
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={downloading || totalAssembled === 0}
          >
            {downloading ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" />处理中...</>
            ) : (
              <><Download className="w-4 h-4 mr-1" />下载组装标书</>
            )}
          </Button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: "60vh" }}>
        {/* Left: Outline */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" />
              投标文件提纲
              <span className="text-muted-foreground font-normal text-xs">（拖入材料到章节）</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            <ScrollArea className="h-full max-h-[60vh] px-4 pb-4">
              <div className="space-y-0.5">
                {sections.map(s => renderSection(s, 0))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right: Materials */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              公司材料库
              {selectedSectionId && matchedCount > 0 ? (
                <Badge variant="default" className="text-[10px] gap-1">
                  <Zap className="w-3 h-3" />
                  {matchedCount} 个匹配
                </Badge>
              ) : (
                <span className="text-muted-foreground font-normal text-xs">（拖动到左侧章节）</span>
              )}
              {selectedSectionId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 text-[10px] text-muted-foreground"
                  onClick={() => setSelectedSectionId(null)}
                >
                  清除筛选
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0 flex flex-col">
            {/* Search & filter */}
            <div className="px-4 pb-2 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜索材料..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="h-8 text-xs pl-8"
                />
              </div>
              {projects.length > 1 && (
                <div className="flex gap-1 flex-wrap">
                  <Badge
                    variant={selectedProject === "all" ? "default" : "outline"}
                    className="cursor-pointer text-[10px]"
                    onClick={() => setSelectedProject("all")}
                  >
                    全部
                  </Badge>
                  {projects.map(p => (
                    <Badge
                      key={p}
                      variant={selectedProject === p ? "default" : "outline"}
                      className="cursor-pointer text-[10px]"
                      onClick={() => setSelectedProject(p)}
                    >
                      {p}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <ScrollArea className="flex-1 max-h-[55vh] px-4 pb-4">
              {loadingMaterials ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                </div>
              ) : filteredMaterials.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">暂无可用的DOCX材料</p>
                  <p className="text-[10px] mt-1">请先在公司材料库中通过"材料提取"功能提取章节</p>
                </div>
              ) : selectedSectionId ? (
                /* Scored view: flat list sorted by relevance */
                <div className="space-y-1">
                  {matchedCount > 0 && (
                    <p className="text-xs font-medium text-accent mb-2 px-1 flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      推荐匹配（点击章节自动筛选）
                    </p>
                  )}
                  {scoredMaterials.map(({ mat, score }) => {
                    const isAssignedToSelected = selectedSectionId ? (assembly[selectedSectionId] || []).some(m => m.id === mat.id) : false;
                    const isAssigned = Object.values(assembly).some(mats => mats.some(m => m.id === mat.id));
                    const isMatched = score > 0;
                    return (
                      <div
                        key={mat.id}
                        draggable
                        onDragStart={() => handleDragStart(mat)}
                        onDragEnd={() => setDraggedMaterial(null)}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all hover:border-accent/50 hover:shadow-sm ${
                          isMatched ? "bg-accent/10 border-accent/40 shadow-sm" : isAssigned ? "bg-accent/5 border-accent/30" : "border-border bg-card opacity-60"
                        } ${draggedMaterial?.id === mat.id ? "opacity-50 scale-95" : ""}`}
                      >
                        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                        {isMatched ? (
                          <Star className="w-3.5 h-3.5 text-accent shrink-0 fill-accent" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{mat.file_name}</p>
                          {mat.content_description && (
                            <p className="text-[10px] text-muted-foreground truncate">{mat.content_description}</p>
                          )}
                        </div>
                        {isMatched && (
                          <Badge variant="default" className="text-[10px] shrink-0 gap-0.5">
                            <Zap className="w-2.5 h-2.5" />{Math.min(score, 99)}
                          </Badge>
                        )}
                        {isAssignedToSelected ? (
                          <Badge variant="secondary" className="text-[10px] shrink-0">已添加</Badge>
                        ) : selectedSectionId ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px] shrink-0 gap-1 border-accent/40 text-accent hover:bg-accent hover:text-accent-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAssembly(prev => {
                                const existing = prev[selectedSectionId] || [];
                                if (existing.some(m => m.id === mat.id)) return prev;
                                return { ...prev, [selectedSectionId]: [...existing, mat] };
                              });
                            }}
                          >
                            <Plus className="w-3 h-3" />填入
                          </Button>
                        ) : isAssigned ? (
                          <Badge variant="secondary" className="text-[10px] shrink-0">已分配</Badge>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Grouped view: by project */
                <div className="space-y-3">
                  {Array.from(groupedMaterials.entries()).map(([projectName, items]) => (
                    <div key={projectName}>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">
                        {projectName}（{items.length}）
                      </p>
                      <div className="space-y-1">
                        {items.map(mat => {
                          const isAssigned = Object.values(assembly).some(mats => mats.some(m => m.id === mat.id));
                          return (
                            <div
                              key={mat.id}
                              draggable
                              onDragStart={() => handleDragStart(mat)}
                              onDragEnd={() => setDraggedMaterial(null)}
                              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all hover:border-accent/50 hover:shadow-sm ${
                                isAssigned ? "bg-accent/5 border-accent/30" : "border-border bg-card"
                              } ${draggedMaterial?.id === mat.id ? "opacity-50 scale-95" : ""}`}
                            >
                              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                              <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-foreground truncate">{mat.file_name}</p>
                                {mat.content_description && (
                                  <p className="text-[10px] text-muted-foreground truncate">{mat.content_description}</p>
                                )}
                              </div>
                              {isAssigned && (
                                <Badge variant="secondary" className="text-[10px] shrink-0">已分配</Badge>
                              )}
                              {mat.material_type && (
                                <Badge variant="outline" className="text-[10px] shrink-0">{mat.material_type}</Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
