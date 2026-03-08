import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: modelConfig } = await supabase.from("model_config").select("*").eq("is_active", true).maybeSingle();
    const aiUrl = modelConfig?.base_url || "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiModel = modelConfig?.model_name || "google/gemini-3-flash-preview";
    const aiKey = modelConfig?.api_key || LOVABLE_API_KEY;
    const isLovable = !modelConfig || modelConfig.provider === "lovable";
    const configMaxTokens = modelConfig?.max_tokens || (isLovable ? 32000 : 8192);

    const { proposalId, resume } = await req.json();
    if (!proposalId) throw new Error("proposalId is required");

    // Update status
    await supabase.from("bid_proposals").update({
      proposal_doc_status: "processing",
      proposal_doc_progress: resume ? "正在继续编写..." : "正在准备数据...",
    }).eq("id", proposalId);

    // Do heavy work in background
    const backgroundTask = generateProposalDoc(supabase, {
      proposalId, aiUrl, aiModel, aiKey, isLovable, maxTokens: configMaxTokens, resume: !!resume,
    }).catch(async (error: any) => {
      console.error("generate-proposal background error:", error);
      await supabase.from("bid_proposals").update({
        proposal_doc_status: "failed",
        proposal_doc_progress: error.message || "生成失败",
      }).eq("id", proposalId);
    });

    if ((globalThis as any).EdgeRuntime?.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(backgroundTask);
    } else {
      await backgroundTask;
    }

    return new Response(JSON.stringify({ success: true, processing: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-proposal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function computeMatchScore(tocTitle: string, tocContent: string | null, material: any): number {
  const tocText = `${tocTitle} ${tocContent || ""}`.toLowerCase();
  const matText = `${material.file_name || ""} ${material.content_description || ""} ${material.material_type || ""} ${(material.ai_extracted_info as any)?.summary || ""}`.toLowerCase();
  const keywords = tocText.split(/[\s,，、。；;：:（）()\-—·]+/).filter((w: string) => w.length >= 2);
  if (keywords.length === 0) return 0;
  let matchCount = 0;
  for (const kw of keywords) {
    if (matText.includes(kw)) matchCount++;
  }
  const certPatterns = ["iso", "cmmi", "tmmi", "gb/t", "gb ", "营业执照", "资质证书", "许可证", "安全生产", "质量管理", "环境管理", "信息安全", "软件著作权", "专利", "税务", "财务报表", "审计报告", "社保", "业绩"];
  for (const pat of certPatterns) {
    if (tocText.includes(pat) && matText.includes(pat)) matchCount += 3;
  }
  return matchCount / Math.max(keywords.length, 1);
}

// Helper: check if the task should stop (paused or cancelled)
async function checkShouldStop(supabase: any, proposalId: string): Promise<"ok" | "paused" | "cancelled"> {
  const { data } = await supabase.from("bid_proposals")
    .select("proposal_doc_status")
    .eq("id", proposalId).single();
  if (!data) return "cancelled";
  const st = data.proposal_doc_status;
  if (st === "paused") return "paused";
  if (st === "cancelled" || st === "pending") return "cancelled";
  return "ok";
}

async function generateProposalDoc(supabase: any, opts: {
  proposalId: string; aiUrl: string; aiModel: string; aiKey: string;
  isLovable: boolean; maxTokens: number; resume: boolean;
}) {
  const { proposalId, aiUrl, aiModel, aiKey, isLovable, maxTokens, resume } = opts;

  try {
    await supabase.from("bid_proposals").update({
      proposal_doc_progress: "正在加载项目数据...",
    }).eq("id", proposalId);

    const { data: proposal } = await supabase.from("bid_proposals")
      .select("*, bid_analyses(*)")
      .eq("id", proposalId).single();
    if (!proposal) throw new Error("投标方案不存在");

    const bid = proposal.bid_analyses;

    await supabase.from("bid_proposals").update({
      proposal_doc_progress: "正在加载提纲和材料数据...",
    }).eq("id", proposalId);

    const [{ data: sections }, { data: tocEntries }, { data: materials }, { data: companyMaterials }, { data: docs }, { data: employees }] = await Promise.all([
      supabase.from("proposal_sections").select("*").eq("proposal_id", proposalId).order("sort_order"),
      supabase.from("proposal_toc_entries").select("*").eq("proposal_id", proposalId).order("sort_order"),
      supabase.from("proposal_materials").select("*").eq("proposal_id", proposalId),
      supabase.from("company_materials")
        .select("id, file_name, file_path, material_type, content_description, ai_extracted_info, ai_status, bid_analysis_id")
        .eq("user_id", proposal.user_id),
      supabase.from("documents")
        .select("id, file_name, doc_category, industry, ai_summary, tags")
        .eq("user_id", proposal.user_id).limit(50),
      supabase.from("employees")
        .select("id, name, current_position, skills, certifications, years_of_experience, education, major")
        .eq("user_id", proposal.user_id),
    ]);

    const allSections = (sections || []) as any[];
    const allTocEntries = (tocEntries || []) as any[];
    const allCompanyMaterials = (companyMaterials || []) as any[];

    const roots = allSections.filter((s: any) => !s.parent_id);
    const childMap = new Map<string, any[]>();
    for (const s of allSections) {
      if (s.parent_id) {
        if (!childMap.has(s.parent_id)) childMap.set(s.parent_id, []);
        childMap.get(s.parent_id)!.push(s);
      }
    }

    const tocBySection = new Map<string, any[]>();
    for (const t of allTocEntries) {
      const pid = t.parent_section_id || "__root__";
      if (!tocBySection.has(pid)) tocBySection.set(pid, []);
      tocBySection.get(pid)!.push(t);
    }

    let outlineText = "";
    for (const root of roots) {
      outlineText += `${root.section_number || ""} ${root.title}\n`;
      const children = childMap.get(root.id) || [];
      for (const child of children) {
        outlineText += `  ${child.section_number || ""} ${child.title}: ${child.content || ""}\n`;
      }
    }

    const materialsSummary = (materials || []).map((m: any) =>
      `- ${m.material_name || "未知"} [${m.requirement_type}] 状态:${m.status}`
    ).join("\n");

    const kbSummary = (docs || []).map((d: any, idx: number) =>
      `[KB-${idx + 1}] 文件名:${d.file_name} | 分类:${d.doc_category || "未分类"} | 行业:${d.industry || "未知"} | 摘要:${d.ai_summary || "无"} | 标签:${(d.tags || []).join(",") || "无"}`
    ).join("\n");

    const personnelSummary = (employees || []).map((e: any) =>
      `- ${e.name}: ${e.current_position || ""}, 学历:${e.education || "未知"}, 专业:${e.major || "未知"}, 技能:${(e.skills || []).join(",")}, 证书:${(e.certifications || []).join(",")}, ${e.years_of_experience || "?"}年经验`
    ).join("\n");

    let parsedOutline: any = null;
    if (proposal.outline_content) {
      try { parsedOutline = JSON.parse(proposal.outline_content); } catch { /* ignore */ }
    }

    // Match materials
    await supabase.from("bid_proposals").update({
      proposal_doc_progress: "正在匹配公司材料库...",
    }).eq("id", proposalId);

    const sectionMaterialMap = new Map<string, { material: any; score: number }[]>();
    for (const section of allSections) {
      const matches: { material: any; score: number }[] = [];
      const tocForSection = tocBySection.get(section.id) || [];
      const tocTexts = tocForSection.map((t: any) => `${t.title} ${t.content || ""}`).join(" ");
      const fullSearchText = `${section.title} ${section.content || ""} ${tocTexts}`;
      for (const mat of allCompanyMaterials) {
        const score = computeMatchScore(fullSearchText, null, mat);
        if (score > 0.15) matches.push({ material: mat, score });
      }
      matches.sort((a, b) => b.score - a.score);
      if (matches.length > 0) sectionMaterialMap.set(section.id, matches.slice(0, 3));
    }

    const totalSectionsToGenerate = roots.length;
    let completedSections = 0;

    // Generate content section by section
    for (const root of roots) {
      // Check pause/cancel before each section
      const stopStatus = await checkShouldStop(supabase, proposalId);
      if (stopStatus === "cancelled") {
        // Cancelled: clear all generated content
        for (const sec of allSections) {
          await supabase.from("proposal_sections").update({ content: null }).eq("id", sec.id);
        }
        await supabase.from("bid_proposals").update({
          proposal_doc_status: "pending",
          proposal_doc_progress: null,
        }).eq("id", proposalId);
        console.log("Proposal generation cancelled for:", proposalId);
        return;
      }
      if (stopStatus === "paused") {
        await supabase.from("bid_proposals").update({
          proposal_doc_progress: `已暂停 (已完成 ${completedSections}/${totalSectionsToGenerate} 个章节)`,
        }).eq("id", proposalId);
        console.log("Proposal generation paused for:", proposalId);
        return;
      }

      // Skip sections that already have content (for resume)
      if (resume && root.content && root.content.trim().length > 50) {
        completedSections++;
        continue;
      }

      const children = childMap.get(root.id) || [];
      const tocForRoot = tocBySection.get(root.id) || [];

      const matchedMats = sectionMaterialMap.get(root.id) || [];
      for (const child of children) {
        const childMats = sectionMaterialMap.get(child.id) || [];
        for (const cm of childMats) {
          if (!matchedMats.find(m => m.material.id === cm.material.id)) matchedMats.push(cm);
        }
      }

      const matchedMaterialsInfo = matchedMats.length > 0
        ? matchedMats.map((m, i) => `[材料${i + 1}] 文件名:${m.material.file_name} | 类型:${m.material.material_type || "未分类"} | 描述:${m.material.content_description || "无"} | AI提取:${JSON.stringify((m.material.ai_extracted_info as any)?.summary || "无")} | 匹配度:${(m.score * 100).toFixed(0)}%`).join("\n")
        : "无匹配材料";

      const tocDetail = tocForRoot.length > 0
        ? tocForRoot.map((t: any) => `  ${t.section_number || ""} ${t.title}: ${t.content || "无要求"}`).join("\n")
        : "";

      await supabase.from("bid_proposals").update({
        proposal_doc_progress: `正在编写: ${root.section_number || ""} ${root.title} (${completedSections + 1}/${totalSectionsToGenerate})${matchedMats.length > 0 ? ` [匹配${matchedMats.length}份材料]` : " [AI生成]"}`,
      }).eq("id", proposalId);

      const childDetails = children.map((c: any) => `  ${c.section_number || ""} ${c.title}: ${c.content || "无描述"}`).join("\n");

      const systemPrompt = `你是资深投标文件撰写专家。请根据以下投标提纲、标书目录要求和参考资料，为指定章节撰写详细的投标方案正文内容。

最高优先级要求——严格遵循应答提纲结构：
1. **必须严格按照提供的章节编号和标题结构撰写**，不得自行增删、合并或调整章节顺序
2. 如果当前章节包含子章节，必须逐一按照子章节编号和标题分别撰写，不得遗漏任何子章节
3. 每个子章节的标题必须与提纲中的标题完全一致，不得擅自修改
4. 即使某个子章节找不到任何参考资料，也必须按照提纲要求撰写该子章节内容（由AI根据专业知识补充）
5. 输出格式：每个子章节以其编号和标题作为小标题，然后撰写正文内容

公司材料引用规则：
6. **最优先引用公司材料库中的匹配材料**：如果提供了匹配的公司材料信息，优先基于这些材料的内容描述和AI提取信息来撰写，确保与公司实际资质和能力一致
7. 引用公司材料时在段落末尾标注：【来源：公司材料库 - {文件名}】

知识库引用规则：
8. **其次引用知识库**：如果公司材料库无匹配，从知识库资料中查找相关信息撰写
9. 引用知识库时在段落末尾标注：【来源：知识库 - {文件名} - {相关章节/主题}】

AI补充规则：
10. 如果以上两者都没有相关资料，由你根据专业知识撰写，标注：【来源：AI智能生成】
11. 每个段落都必须有来源标注

标书目录要求：
12. 如果提供了标书目录的详细要求，必须严格按照目录中的书写要求和格式规范来撰写对应内容

其他要求：
13. 内容专业、严谨，符合招投标行业标准
14. 对于需要证明材料的部分，注明"（详见附件：XXX）"
15. 每个子章节内容充实，字数不少于200字
16. 使用规范的公文语言，避免口语化表达
17. 直接输出正文内容，不要输出JSON格式`;

      const userPrompt = `【项目名称】${proposal.project_name}
【当前章节】${root.section_number || ""} ${root.title}
${children.length > 0 ? `【子章节结构（必须严格按此结构逐一撰写，不得遗漏）】\n${childDetails}` : ""}
【章节描述】${root.content || "无"}
${tocDetail ? `【标书目录详细要求（请严格遵循）】\n${tocDetail}` : ""}
${bid ? `【项目摘要】${bid.summary || "无"}` : ""}
【完整提纲】
${outlineText}
【公司材料库匹配结果（优先引用）】
${matchedMaterialsInfo}
【证明材料清单】
${materialsSummary || "无"}
【知识库参考资料（次优先引用）】
${kbSummary || "无"}
【可用人员信息】
${personnelSummary || "无"}
${parsedOutline?.overall_strategy ? `【投标策略】${parsedOutline.overall_strategy}` : ""}

请严格按照上述子章节结构，为"${root.section_number || ""} ${root.title}"章节${children.length > 0 ? "的每一个子章节逐一" : ""}撰写完整的投标方案正文。
重要：不得跳过任何子章节，即使没有参考资料也必须撰写。每段内容必须标注来源。优先使用公司材料库中的内容。`;

      const requestBody: any = {
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: Math.min(maxTokens, 8192),
      };

      let generatedContent = "";

      try {
        const response = await fetch(aiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const status = response.status;
          if (status === 429) {
            await new Promise(r => setTimeout(r, 5000));
            const retry = await fetch(aiUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            });
            if (!retry.ok) {
              const errMsg = status === 429 ? "AI服务请求过于频繁" : status === 402 ? "AI服务额度不足" : `AI错误: ${status}`;
              throw new Error(errMsg);
            }
            const retryData = await retry.json();
            generatedContent = retryData.choices?.[0]?.message?.content || "";
          } else {
            const errMsg = status === 402 ? "AI服务额度不足" : `AI错误: ${status}`;
            throw new Error(errMsg);
          }
        } else {
          const data = await response.json();
          generatedContent = data.choices?.[0]?.message?.content || "";
        }
      } catch (fetchErr: any) {
        console.error(`Section ${root.section_number} AI call failed:`, fetchErr);
        generatedContent = `[本章节生成失败: ${fetchErr.message}]\n\n请手动编写或重试。`;
      }

      // Save content immediately after each section
      await supabase.from("proposal_sections").update({ content: generatedContent }).eq("id", root.id);

      completedSections++;

      await supabase.from("bid_proposals").update({
        proposal_doc_progress: `已完成 ${completedSections}/${totalSectionsToGenerate} 个章节`,
      }).eq("id", proposalId);

      if (completedSections < totalSectionsToGenerate) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    await supabase.from("bid_proposals").update({
      proposal_doc_status: "completed",
      proposal_doc_progress: null,
    }).eq("id", proposalId);

    console.log("Proposal document generation completed for:", proposalId);
  } catch (err) {
    console.error("generateProposalDoc fatal error:", err);
    await supabase.from("bid_proposals").update({
      proposal_doc_status: "failed",
      proposal_doc_progress: `生成异常: ${err instanceof Error ? err.message : "未知错误"}`,
    }).eq("id", proposalId);
  }
}
