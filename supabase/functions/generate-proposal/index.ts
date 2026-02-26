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
    const aiModel = modelConfig?.model_name || "openai/gpt-5.2";
    const aiKey = modelConfig?.api_key || LOVABLE_API_KEY;
    const isLovable = !modelConfig || modelConfig.provider === "lovable";
    const configMaxTokens = modelConfig?.max_tokens || (isLovable ? 32000 : 8192);

    const { proposalId } = await req.json();
    if (!proposalId) throw new Error("proposalId is required");

    // Update status
    await supabase.from("bid_proposals").update({
      proposal_doc_status: "processing",
      proposal_doc_progress: "正在准备数据...",
    }).eq("id", proposalId);

    // Do heavy work in background
    EdgeRuntime.waitUntil(
      generateProposalDoc(supabase, {
        proposalId, aiUrl, aiModel, aiKey, isLovable, maxTokens: configMaxTokens,
      }).catch(async (error) => {
        console.error("generate-proposal background error:", error);
        await supabase.from("bid_proposals").update({
          proposal_doc_status: "failed",
          proposal_doc_progress: error.message || "生成失败",
        }).eq("id", proposalId);
      })
    );

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

async function generateProposalDoc(supabase: any, opts: {
  proposalId: string; aiUrl: string; aiModel: string; aiKey: string;
  isLovable: boolean; maxTokens: number;
}) {
  const { proposalId, aiUrl, aiModel, aiKey, isLovable, maxTokens } = opts;

  try {
    // Fetch proposal + analysis
    const { data: proposal } = await supabase.from("bid_proposals")
      .select("*, bid_analyses(*)")
      .eq("id", proposalId).single();
    if (!proposal) throw new Error("投标方案不存在");

    const bid = proposal.bid_analyses;

    // Fetch sections, materials, knowledge docs, employees
    const [{ data: sections }, { data: materials }, { data: docs }, { data: employees }] = await Promise.all([
      supabase.from("proposal_sections").select("*").eq("proposal_id", proposalId).order("sort_order"),
      supabase.from("proposal_materials").select("*").eq("proposal_id", proposalId),
      supabase.from("documents")
        .select("id, file_name, doc_category, industry, ai_summary, tags")
        .eq("user_id", proposal.user_id).limit(50),
      supabase.from("employees")
        .select("id, name, current_position, skills, certifications, years_of_experience, education, major")
        .eq("user_id", proposal.user_id),
    ]);

    const allSections = (sections || []) as any[];
    // Build flat list with parent-child relationship
    const roots = allSections.filter((s: any) => !s.parent_id);
    const childMap = new Map<string, any[]>();
    for (const s of allSections) {
      if (s.parent_id) {
        if (!childMap.has(s.parent_id)) childMap.set(s.parent_id, []);
        childMap.get(s.parent_id)!.push(s);
      }
    }

    // Build outline text for context
    let outlineText = "";
    for (const root of roots) {
      outlineText += `${root.section_number || ""} ${root.title}\n`;
      const children = childMap.get(root.id) || [];
      for (const child of children) {
        outlineText += `  ${child.section_number || ""} ${child.title}: ${child.content || ""}\n`;
      }
    }

    // Materials summary
    const materialsSummary = (materials || []).map((m: any) =>
      `- ${m.material_name || "未知"} [${m.requirement_type}] 状态:${m.status}`
    ).join("\n");

    // Knowledge base detailed summary with IDs for citation
    const kbSummary = (docs || []).map((d: any, idx: number) =>
      `[KB-${idx + 1}] 文件名:${d.file_name} | 分类:${d.doc_category || "未分类"} | 行业:${d.industry || "未知"} | 摘要:${d.ai_summary || "无"} | 标签:${(d.tags || []).join(",") || "无"}`
    ).join("\n");

    // Personnel summary
    const personnelSummary = (employees || []).map((e: any) =>
      `- ${e.name}: ${e.current_position || ""}, 学历:${e.education || "未知"}, 专业:${e.major || "未知"}, 技能:${(e.skills || []).join(",")}, 证书:${(e.certifications || []).join(",")}, ${e.years_of_experience || "?"}年经验`
    ).join("\n");

    // Parse existing outline for strategy, personnel plan
    let parsedOutline: any = null;
    if (proposal.outline_content) {
      try { parsedOutline = JSON.parse(proposal.outline_content); } catch { /* ignore */ }
    }

    const totalSectionsToGenerate = roots.length;
    let completedSections = 0;

    // Generate content for each top-level section
    for (const root of roots) {
      const children = childMap.get(root.id) || [];
      const childTitles = children.map((c: any) => `${c.section_number || ""} ${c.title}`).join(", ");

      await supabase.from("bid_proposals").update({
        proposal_doc_progress: `正在生成: ${root.section_number || ""} ${root.title} (${completedSections + 1}/${totalSectionsToGenerate})`,
      }).eq("id", proposalId);

      const systemPrompt = `你是资深投标文件撰写专家。请根据以下投标提纲和参考资料，为指定章节撰写详细的投标方案正文内容。

核心要求：
1. **优先引用知识库**：撰写每段内容时，必须优先从提供的知识库资料中查找相关信息。如果知识库中有相关资料，必须基于该资料撰写，并在该段落末尾用以下格式标注来源：
   【来源：知识库 - {文件名} - {相关章节/主题}】
2. **AI补充标注**：如果知识库中没有相关资料，则由你根据专业知识撰写，并在该段落末尾标注：
   【来源：AI智能生成】
3. 每个段落都必须有来源标注，不得遗漏
4. 内容专业、严谨，符合招投标行业标准
5. 对于需要证明材料的部分，注明"（详见附件：XXX）"
6. 如果章节包含子章节，请按子章节结构分别撰写
7. 每个子章节内容充实，字数不少于200字
8. 使用规范的公文语言，避免口语化表达
9. 直接输出正文内容，不要输出JSON格式

来源标注示例：
"本项目拟采用XX技术方案，通过三级质量管控体系确保交付质量。【来源：知识库 - 2024年XX项目技术方案.pdf - 第三章 质量管理】"
"针对本项目特殊需求，建议增设专项安全巡检机制。【来源：AI智能生成】"`;

      const userPrompt = `【项目名称】${proposal.project_name}
【当前章节】${root.section_number || ""} ${root.title}
${children.length > 0 ? `【子章节】${childTitles}` : ""}
【章节描述】${root.content || "无"}
${bid ? `【项目摘要】${bid.summary || "无"}` : ""}
【完整提纲】
${outlineText}
【证明材料清单】
${materialsSummary || "无"}
【知识库参考资料（请优先引用，并在内容中标注来源编号和文件名）】
${kbSummary || "无"}
【可用人员信息】
${personnelSummary || "无"}
${parsedOutline?.overall_strategy ? `【投标策略】${parsedOutline.overall_strategy}` : ""}

请为"${root.section_number || ""} ${root.title}"章节${children.length > 0 ? "及其所有子章节" : ""}撰写完整的投标方案正文。
重要提醒：每段内容必须标注来源（知识库文件名+章节 或 AI智能生成），不得遗漏。`;

      const requestBody: any = {
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: Math.min(maxTokens, 8192),
      };

      const response = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) {
          // Rate limited - wait and retry once
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
          const content = retryData.choices?.[0]?.message?.content || "";
          await supabase.from("proposal_sections").update({ content }).eq("id", root.id);
        } else {
          const errMsg = status === 402 ? "AI服务额度不足" : `AI错误: ${status}`;
          throw new Error(errMsg);
        }
      } else {
        const data = await response.json();
        const generatedContent = data.choices?.[0]?.message?.content || "";

        // Update the root section content
        await supabase.from("proposal_sections").update({ content: generatedContent }).eq("id", root.id);
      }

      completedSections++;

      // Small delay between sections to avoid rate limiting
      if (completedSections < totalSectionsToGenerate) {
        await new Promise(r => setTimeout(r, 1000));
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
