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

    const { action, ...params } = await req.json();

    // ---- ACTION: generate-outline ----
    if (action === "generate-outline") {
      const { proposalId, bidAnalysisId, customPrompt } = params;

      // Update status immediately
      await supabase.from("bid_proposals").update({ ai_status: "processing", ai_progress: "正在准备数据...", token_usage: null } as any).eq("id", proposalId);

      // Do all heavy work in background
      EdgeRuntime.waitUntil(
        processOutline(supabase, { proposalId, bidAnalysisId, customPrompt, aiUrl, aiModel, aiKey, isLovable, maxTokens: configMaxTokens }).catch(async (error) => {
          console.error("Background processing error:", error);
          await supabase.from("bid_proposals").update({ ai_status: "failed", ai_progress: error.message || "处理失败" } as any).eq("id", proposalId);
        })
      );

      return new Response(JSON.stringify({ success: true, processing: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- ACTION: check-materials ----
    if (action === "check-materials") {
      const { proposalId } = params;

      const [{ data: proposal }, { data: materials }] = await Promise.all([
        supabase.from("bid_proposals").select("*, bid_analyses(*)").eq("id", proposalId).single(),
        supabase.from("proposal_materials").select("*").eq("proposal_id", proposalId),
      ]);

      if (!proposal) throw new Error("投标方案不存在");

      const { data: docs } = await supabase
        .from("documents")
        .select("id, file_name, doc_category, ai_summary, tags, file_path")
        .eq("user_id", proposal.user_id);

      let updatedCount = 0;
      for (const mat of (materials || [])) {
        if (mat.status === "matched") continue;

        const matched = (docs || []).find((d: any) =>
          d.file_name?.includes(mat.material_name || "") ||
          d.ai_summary?.includes(mat.material_name || "") ||
          d.ai_summary?.includes(mat.requirement_text || "") ||
          (d.tags || []).some((t: string) => (mat.material_name || "").includes(t))
        );

        if (matched) {
          await supabase.from("proposal_materials").update({
            status: "matched",
            matched_document_id: matched.id,
            matched_file_path: matched.file_path,
          }).eq("id", mat.id);
          updatedCount++;
        }
      }

      return new Response(JSON.stringify({ success: true, updatedCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- ACTION: rewrite ----
    if (action === "rewrite") {
      const { proposalId, message, context, highlightedText, sectionId } = params;

      const { data: modelConfig } = await supabase.from("model_config").select("*").eq("is_active", true).maybeSingle();
      const rewriteUrl = modelConfig?.base_url || aiUrl;
      const rewriteModel = modelConfig?.model_name || aiModel;
      const rewriteKey = modelConfig?.api_key || aiKey;

      const systemPrompt = `你是资深投标文件撰写专家。用户选中了标书中的一段内容，并给出了修改要求。请根据要求重写这段内容。

要求：
1. 只输出重写后的文本内容，不要包含任何解释、前缀或JSON格式
2. 保持专业严谨的投标文件语言风格
3. 保留原文中的来源标注格式（如【来源：知识库 - xxx】或【来源：AI智能生成】）
4. 如果原文没有来源标注，在末尾添加【来源：AI智能生成】
5. 确保重写内容在上下文中连贯自然`;

      const userPrompt = `${context}\n\n【选中的原文】\n${highlightedText}\n\n【修改要求】\n${message}`;

      const response = await fetch(rewriteUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${rewriteKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: rewriteModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          ...(rewriteModel.startsWith("openai/") || rewriteModel.includes("gpt-") ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }),
        }),
      });

      if (!response.ok) throw new Error(`AI错误: ${response.status}`);
      const data = await response.json();
      const newContent = data.choices?.[0]?.message?.content?.trim() || "";

      if (newContent && sectionId) {
        // Update the section in DB
        const { data: section } = await supabase.from("proposal_sections").select("content").eq("id", sectionId).single();
        if (section) {
          const updatedContent = (section.content || "").replace(highlightedText, newContent);
          await supabase.from("proposal_sections").update({ content: updatedContent }).eq("id", sectionId);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        reply: `✅ 已重写内容：\n\n${newContent}`,
        newContent,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- ACTION: chat ----
    if (action === "chat") {
      const { proposalId, message, context, outlineSummary } = params;

      const { data: modelConfig } = await supabase.from("model_config").select("*").eq("is_active", true).maybeSingle();
      const chatUrl = modelConfig?.base_url || aiUrl;
      const chatModel = modelConfig?.model_name || aiModel;
      const chatKey = modelConfig?.api_key || aiKey;

      const outlineTools = [
        {
          type: "function",
          function: {
            name: "add_section",
            description: "添加一个新的提纲章节。可以添加根级章节或子章节。",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "章节标题" },
                parent_id: { type: "string", description: "父章节ID，如果是根级章节则为null" },
              },
              required: ["title"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "rename_section",
            description: "重命名一个已有的提纲章节",
            parameters: {
              type: "object",
              properties: {
                section_id: { type: "string", description: "要重命名的章节ID" },
                new_title: { type: "string", description: "新的章节标题" },
              },
              required: ["section_id", "new_title"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "delete_section",
            description: "删除一个提纲章节及其所有子章节",
            parameters: {
              type: "object",
              properties: {
                section_id: { type: "string", description: "要删除的章节ID" },
              },
              required: ["section_id"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "move_section",
            description: "将一个章节在同级中上移或下移",
            parameters: {
              type: "object",
              properties: {
                section_id: { type: "string", description: "要移动的章节ID" },
                direction: { type: "string", enum: ["up", "down"], description: "移动方向" },
              },
              required: ["section_id", "direction"],
              additionalProperties: false,
            },
          },
        },
      ];

      const systemPrompt = `你是资深投标专家助手。你可以回答用户关于标书内容的问题，也可以帮用户编辑提纲目录结构。

当用户要求对提纲进行增加、删除、重命名、移动等操作时，请调用对应的工具函数来执行。你可以一次调用多个工具。

当前提纲结构：
${outlineSummary || "（暂无提纲）"}

注意：
- 添加章节时，如果用户要求添加到某个章节下面，请使用对应的parent_id
- 删除章节会同时删除所有子章节
- 移动只能在同级章节间进行`;

      const response = await fetch(chatUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${chatKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: chatModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `${context}\n\n用户问题: ${message}` },
          ],
          tools: outlineTools,
          ...(chatModel.startsWith("openai/") || chatModel.includes("gpt-") ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }),
        }),
      });

      if (!response.ok) throw new Error(`AI错误: ${response.status}`);
      const data = await response.json();
      const choice = data.choices?.[0];
      const toolCalls = choice?.message?.tool_calls;

      // If AI wants to call tools, execute them on the backend
      if (toolCalls && toolCalls.length > 0) {
        const results: string[] = [];
        for (const tc of toolCalls) {
          const fn = tc.function.name;
          const args = JSON.parse(tc.function.arguments || "{}");
          try {
            if (fn === "add_section") {
              const parentId = args.parent_id || null;
              // Get max sort_order among siblings
              let query = supabase.from("proposal_sections").select("sort_order").eq("proposal_id", proposalId);
              if (parentId) { query = query.eq("parent_id", parentId); } else { query = query.is("parent_id", null); }
              const { data: siblings } = await query;
              const maxOrder = siblings && siblings.length > 0 ? Math.max(...siblings.map((s: any) => s.sort_order)) : -1;
              const { error } = await supabase.from("proposal_sections").insert({
                proposal_id: proposalId,
                title: args.title,
                parent_id: parentId,
                sort_order: maxOrder + 1,
              });
              if (error) throw error;
              results.push(`✅ 已添加章节「${args.title}」`);
            } else if (fn === "rename_section") {
              const { error } = await supabase.from("proposal_sections").update({ title: args.new_title }).eq("id", args.section_id).eq("proposal_id", proposalId);
              if (error) throw error;
              results.push(`✅ 已将章节重命名为「${args.new_title}」`);
            } else if (fn === "delete_section") {
              // Collect all descendant IDs
              const collectIds = async (id: string): Promise<string[]> => {
                const ids = [id];
                const { data: children } = await supabase.from("proposal_sections").select("id").eq("parent_id", id);
                if (children) {
                  for (const c of children) {
                    ids.push(...await collectIds(c.id));
                  }
                }
                return ids;
              };
              const idsToDelete = await collectIds(args.section_id);
              const { error } = await supabase.from("proposal_sections").delete().in("id", idsToDelete);
              if (error) throw error;
              results.push(`✅ 已删除章节${idsToDelete.length > 1 ? `（含 ${idsToDelete.length - 1} 个子章节）` : ""}`);
            } else if (fn === "move_section") {
              const { data: target } = await supabase.from("proposal_sections").select("id, parent_id, sort_order").eq("id", args.section_id).single();
              if (!target) { results.push("❌ 未找到该章节"); continue; }
              let sibQuery = supabase.from("proposal_sections").select("id, sort_order").eq("proposal_id", proposalId);
              if (target.parent_id) { sibQuery = sibQuery.eq("parent_id", target.parent_id); } else { sibQuery = sibQuery.is("parent_id", null); }
              const { data: siblings } = await sibQuery.order("sort_order");
              if (!siblings) { results.push("❌ 查询失败"); continue; }
              const idx = siblings.findIndex((s: any) => s.id === args.section_id);
              const swapIdx = args.direction === "up" ? idx - 1 : idx + 1;
              if (swapIdx < 0 || swapIdx >= siblings.length) { results.push(`⚠️ 已在最${args.direction === "up" ? "上" : "下"}方，无法移动`); continue; }
              const a = siblings[idx], b = siblings[swapIdx];
              await Promise.all([
                supabase.from("proposal_sections").update({ sort_order: b.sort_order }).eq("id", a.id),
                supabase.from("proposal_sections").update({ sort_order: a.sort_order }).eq("id", b.id),
              ]);
              results.push(`✅ 已将章节${args.direction === "up" ? "上移" : "下移"}`);
            }
          } catch (toolErr: any) {
            results.push(`❌ ${fn} 失败: ${toolErr.message}`);
          }
        }

        const textReply = choice?.message?.content?.trim();
        const fullReply = (textReply ? textReply + "\n\n" : "") + results.join("\n");

        return new Response(JSON.stringify({ success: true, reply: fullReply, outlineChanged: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const reply = choice?.message?.content?.trim() || "抱歉，暂时无法回复";

      return new Response(JSON.stringify({ success: true, reply }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("bidding-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---- Background processing function ----
async function processOutline(supabase: any, opts: {
  proposalId: string; bidAnalysisId: string; customPrompt?: string;
  aiUrl: string; aiModel: string; aiKey: string; isLovable: boolean; maxTokens: number;
}) {
  const { proposalId, bidAnalysisId, customPrompt, aiUrl, aiModel, aiKey, isLovable, maxTokens } = opts;

  try {
  // Fetch bid analysis data
  const { data: bid } = await supabase
    .from("bid_analyses")
    .select("*")
    .eq("id", bidAnalysisId)
    .single();
  if (!bid) throw new Error("招标解析数据不存在");

  // Fetch knowledge base documents & employees in parallel
  const [{ data: docs }, { data: employees }] = await Promise.all([
    supabase.from("documents")
      .select("id, file_name, doc_category, industry, ai_summary, tags")
      .eq("user_id", bid.user_id).limit(50),
    supabase.from("employees")
      .select("id, name, current_position, skills, certifications, years_of_experience")
      .eq("user_id", bid.user_id),
  ]);

  // Build document structure text for the prompt
  const buildStructureText = (sections: any[], depth = 0): string => {
    if (!sections || !Array.isArray(sections)) return "";
    return sections.map((s: any) => {
      const indent = "  ".repeat(depth);
      const num = s.number || s.section_number || "";
      const title = s.title || "";
      const page = s.page_hint ? ` (${s.page_hint})` : "";
      const importance = s.importance === "critical" ? " ★关键" : s.importance === "high" ? " ▲重要" : "";
      const reason = s.importance_reason ? ` — ${s.importance_reason}` : "";
      const line = `${indent}${num} ${title}${page}${importance}${reason}`;
      const childLines = s.children?.length ? "\n" + buildStructureText(s.children, depth + 1) : "";
      return line + childLines;
    }).join("\n");
  };

  const docStructureText = bid.document_structure?.sections
    ? buildStructureText(bid.document_structure.sections)
    : "（无结构化章节数据）";

  const docTitle = bid.document_structure?.document_title || bid.project_name || "未命名项目";
  const totalPages = bid.document_structure?.total_pages || "未知";
  const docSummaryText = bid.document_structure?.summary || bid.summary || "无";

  let systemContent = `你是资深投标专家，擅长根据招标文件编制高质量投标文件。请根据以下招标文件的完整解析结果，生成投标文件应答提纲。

★★★ 核心原则：基于招标文件原文生成提纲 ★★★
你必须严格依据招标文件的实际内容和结构来生成投标文件提纲，而不是凭经验臆造。

【招标文件概览】
- 文件标题：${docTitle}
- 总页数：${totalPages}
- 摘要：${docSummaryText}

【招标文件章节结构】
${docStructureText}

【信息来源（必须全部覆盖）】
1. 投标人须知——投标文件构成
2. 投标人须知前附表/前附表——投标文件构成/组成/投标文件应包括但不限于
3. 投标文件格式
4. 资格要求
5. 评分标准/评分表

【提纲编写规则】
A) 章节结构：严格按照招标文件要求的投标文件组成顺序编排提纲章节号（如"第一章"、"1"、"1.1"等），章节号应与招标文件中规定的投标文件格式保持一致
B) 章节要求：每个章节的 description 中必须详细说明招标文件对该章节的具体要求，包括：
   - 该章节在招标文件中的原文要求摘要
   - 需要包含的具体内容清单
   - 对应的评分标准和分值
   - 格式要求（字体、字号、行间距等，如有）
   - 需要的证明材料和附件
C) 内容完整性：提纲结构必须完整包含上述所有信息来源的全部内容，不允许遗漏任何一项
D) 格式匹配：如果"投标文件格式"中有对应内容模板，必须在提纲中标注匹配关系
E) 每个章节标注需要的证明材料，识别硬性要求和软性要求
F) 标注每个章节对应的评分分值
G) 建议可关联的知识库模板

【极其重要】material_checklist 的生成规则：
- 每一项证书、资质、证明文件都必须作为独立的一条记录，绝不允许合并
- 例如：如果招标文件要求"CMMI L5级、ISO 27001、ISO 9001三项认证"，你必须生成3条独立记录
- 每条记录的 material_name 必须是一个具体的、可独立上传的文件名称
- 绝对禁止出现"XX等N项证书"、"多项认证复印件"这样的合并描述

【极其重要】material_format 字段必须填写，使用以下标准分类名称：
- "资质认证证书" | "企业基本资料" | "财务证明材料" | "人员资质证明" | "业绩证明材料" | "技术能力证明" | "声明承诺文件" | "投标文件组成"

请输出JSON格式：
{
  "outline": [{ "section_number": "1", "title": "章节标题", "description": "招标文件对该章节的要求说明（包含原文要求摘要、评分分值、格式要求等）", "score_weight": "分值", "format_requirements": "字体字号行间距要求（如有）", "children": [{ "section_number": "1.1", "title": "子章节", "description": "招标文件对该子章节的具体要求和内容清单", "required_materials": ["材料"], "suggested_template": "模板类型", "format_template_ref": "对应的投标文件格式名称（如有）" }] }],
  "material_checklist": [{ "requirement_text": "要求原文", "requirement_type": "hard|soft", "material_name": "单项材料名称", "material_format": "分类", "severity": "error|warning|info" }],
  "personnel_plan": [{ "role": "岗位", "requirements": "要求", "suggested_candidate": "人选", "match_reason": "理由" }],
  "overall_strategy": "策略建议（200字以内）",
  "format_spec": { "font_name": "招标要求的字体（如有）", "font_size_body": "正文字号（如有）", "font_size_heading": "标题字号（如有）", "line_spacing": "行间距（如有）", "page_header": "页眉内容要求（如有）" }
}`;

  // Always include default outline generation requirements
  const defaultOutlinePrompt = `【提纲获取来源（必须全部覆盖）】
1. 投标人须知——投标文件构成；
2. 投标人须知前附表/前附表——投标文件构成/组成/投标文件应包括但不限于；
3. 投标文件格式；
4. 资格要求；
5. 评分标准/评分表

【提纲编写要求】
a) 顺序：有明确要求的按要求执行，没有明确要求的按结构清晰的执行；
b) 内容：结构需包含来源的所有内容；如投标文件格式有对应内容，需匹配到文档中；
c) 字体：有明确要求的按要求执行，没有明确要求按文档模板执行，文档标题及页眉需匹配项目名称；`;

  systemContent += `\n\n${defaultOutlinePrompt}`;
  if (customPrompt) systemContent += `\n\n【用户额外自定义要求】\n${customPrompt}`;
  systemContent += `\n请严格输出纯JSON。`;

  const userContent = `【招标项目】${bid.project_name || "未命名"}
【评分标准】${JSON.stringify(bid.scoring_table)}
【废标红线】${JSON.stringify(bid.disqualification_items)}
【人员配置要求】${JSON.stringify(bid.personnel_requirements)}
【技术关键词】${JSON.stringify(bid.technical_keywords)}
【业务关键词】${JSON.stringify(bid.business_keywords)}
【职责关键词】${JSON.stringify(bid.responsibility_keywords)}
【项目摘要】${bid.summary || "无"}
【可用知识库文档】
${(docs || []).map((d: any) => `- ${d.file_name} [${d.doc_category || "未分类"}] ${d.ai_summary || ""}`).join("\n")}
【可用人员】
${(employees || []).map((e: any) => `- ${e.name}: ${e.current_position || "未知"}, 技能: ${(e.skills || []).join(",")}, 证书: ${(e.certifications || []).join(",")}, ${e.years_of_experience || "?"}年经验`).join("\n")}`;

  await supabase.from("bid_proposals").update({ ai_progress: "正在调用AI生成提纲..." } as any).eq("id", proposalId);

  const requestBody: any = {
    model: aiModel,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
  };
  if (aiModel.startsWith("openai/") || aiModel.includes("gpt-")) {
    requestBody.max_completion_tokens = maxTokens;
  } else {
    requestBody.max_tokens = maxTokens;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 3 min timeout
  let response;
  try {
    response = await fetch(aiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    clearTimeout(timeout);
    const msg = fetchErr?.name === "AbortError" ? "AI调用超时(3分钟)，请重试" : `AI调用失败: ${fetchErr?.message || "网络错误"}`;
    console.error("AI fetch error:", fetchErr);
    await supabase.from("bid_proposals").update({ ai_status: "failed", ai_progress: msg } as any).eq("id", proposalId);
    return;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const status = response.status;
    const errBody = await response.text();
    console.error("AI API error:", status, errBody);
    await supabase.from("bid_proposals").update({ ai_status: "failed", ai_progress: status === 429 ? "AI服务请求过于频繁" : status === 402 ? "AI服务额度不足" : `AI错误: ${status}` } as any).eq("id", proposalId);
    return;
  }

  const data = await response.json();

  // Save token usage
  const usage = data.usage;
  if (usage) {
    await supabase.from("bid_proposals").update({
      ai_progress: "AI生成完成，正在解析结果...",
      token_usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 },
    } as any).eq("id", proposalId);
  } else {
    await supabase.from("bid_proposals").update({ ai_progress: "AI生成完成，正在解析结果..." } as any).eq("id", proposalId);
  }

  // Detect truncated response
  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason === "length") {
    console.warn("AI response truncated (finish_reason=length), will attempt JSON repair");
  }

  let resultText = data.choices?.[0]?.message?.content || "";
  resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let result;
  try {
    result = JSON.parse(resultText);
  } catch {
    try {
      let repaired = resultText;
      let inString = false;
      for (let i = 0; i < repaired.length; i++) {
        if (repaired[i] === '\\' && inString) { i++; continue; }
        if (repaired[i] === '"') inString = !inString;
      }
      if (inString) repaired += '"';
      for (let attempt = 0; attempt < 10; attempt++) {
        const before = repaired;
        repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*"[^"]*"?\s*$/g, "");
        repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*$/g, "");
        repaired = repaired.replace(/,\s*"[^"]*"\s*$/g, "");
        repaired = repaired.replace(/,\s*\{\s*("[^"]*"\s*:\s*("[^"]*"|[^,}\]]*)\s*,?\s*)*$/g, "");
        repaired = repaired.replace(/,\s*$/g, "");
        if (repaired === before) break;
      }
      repaired = repaired.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      let braces = 0, brackets = 0;
      for (const c of repaired) {
        if (c === '{') braces++; else if (c === '}') braces--;
        else if (c === '[') brackets++; else if (c === ']') brackets--;
      }
      while (brackets > 0) { repaired += ']'; brackets--; }
      while (braces > 0) { repaired += '}'; braces--; }
      result = JSON.parse(repaired);
      console.log("Successfully repaired truncated AI JSON response");
    } catch (repairErr) {
      try {
        const outlineMatch = resultText.match(/"outline"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
        if (outlineMatch) {
          result = { outline: JSON.parse(outlineMatch[1]), material_checklist: [], personnel_plan: [] };
          console.log("Recovered outline from truncated response");
        } else { throw repairErr; }
      } catch {
        console.error("Failed to parse AI response:", resultText.slice(-300));
        await supabase.from("bid_proposals").update({ ai_status: "failed", ai_progress: "AI返回格式异常，请重试" } as any).eq("id", proposalId);
        return;
      }
    }
  }

  await supabase.from("bid_proposals").update({ ai_progress: "正在保存提纲结构..." } as any).eq("id", proposalId);

  // Save outline content
  await supabase.from("bid_proposals").update({
    outline_content: JSON.stringify(result),
    ai_progress: "正在保存章节...",
  } as any).eq("id", proposalId);

  // Batch insert sections
  if (result.outline) {
    for (let i = 0; i < result.outline.length; i++) {
      const section = result.outline[i];
      const { data: parent } = await supabase.from("proposal_sections").insert({
        proposal_id: proposalId,
        section_number: section.section_number,
        title: section.title,
        content: section.description || "",
        sort_order: i,
      }).select("id").single();

      if (parent && section.children?.length) {
        // Batch insert all children at once
        const childRows = section.children.map((child: any, j: number) => ({
          proposal_id: proposalId,
          parent_id: parent.id,
          section_number: child.section_number,
          title: child.title,
          content: `${child.description || ""}\n\n需要材料: ${(child.required_materials || []).join(", ")}\n建议模板: ${child.suggested_template || "无"}`,
          sort_order: j,
        }));
        await supabase.from("proposal_sections").insert(childRows);
      }
    }
  }

  // Batch insert materials
  if (result.material_checklist?.length) {
    const materialRows = result.material_checklist.map((mat: any) => {
      let matchedDocId = null;
      if (docs && mat.material_name) {
        const matched = (docs as any[]).find((d) =>
          d.file_name?.includes(mat.material_name) ||
          d.ai_summary?.includes(mat.material_name) ||
          (d.tags || []).some((t: string) => mat.material_name.includes(t))
        );
        if (matched) matchedDocId = matched.id;
      }
      return {
        proposal_id: proposalId,
        requirement_text: mat.requirement_text,
        requirement_type: mat.requirement_type || "hard",
        material_name: mat.material_name,
        material_format: mat.material_format || null,
        status: matchedDocId ? "matched" : "missing",
        matched_document_id: matchedDocId,
        severity: mat.severity || "warning",
      };
    });
    await supabase.from("proposal_materials").insert(materialRows);
  }

  await supabase.from("bid_proposals").update({
    ai_status: "completed",
    ai_progress: null,
  } as any).eq("id", proposalId);

  console.log("Outline generation completed for proposal:", proposalId);

  } catch (err) {
    console.error("processOutline fatal error:", err);
    await supabase.from("bid_proposals").update({
      ai_status: "failed",
      ai_progress: `处理异常: ${err instanceof Error ? err.message : "未知错误"}`,
    } as any).eq("id", proposalId);
  }
}
