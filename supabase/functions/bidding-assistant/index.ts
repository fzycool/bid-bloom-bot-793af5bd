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

  let systemContent = `你是资深投标专家，擅长根据招标文件编制高质量投标文件。请根据以下招标解析结果，生成完整的投标文件应答提纲。

【信息来源（必须全部覆盖）】
1. 投标人须知——投标文件构成
2. 投标人须知前附表/前附表——投标文件构成/组成/投标文件应包括但不限于
3. 投标文件格式
4. 资格要求
5. 评分标准/评分表

【提纲编写规则】
A) 顺序：招标文件有明确要求的，严格按照招标文件要求的顺序执行；没有明确要求的，按结构清晰、逻辑合理的方式组织
B) 内容：提纲结构必须完整包含上述所有信息来源的全部内容，不允许遗漏任何一项；如果"投标文件格式"中有对应内容模板，必须在提纲中标注匹配关系
C) 每个章节标注需要的证明材料
D) 识别硬性要求（资质证书、业绩证明等）和软性要求（方案描述等）
E) 标注每个章节对应的评分分值
F) 建议可关联的知识库模板
G) 对于有字体、字号、行间距等格式要求的，在章节描述中明确标注这些格式要求

【极其重要】material_checklist 的生成规则：
- 每一项证书、资质、证明文件都必须作为独立的一条记录，绝不允许合并
- 例如：如果招标文件要求"CMMI L5级、ISO 27001、ISO 9001三项认证"，你必须生成3条独立记录
- 每条记录的 material_name 必须是一个具体的、可独立上传的文件名称
- 绝对禁止出现"XX等N项证书"、"多项认证复印件"这样的合并描述

【极其重要】material_format 字段必须填写，使用以下标准分类名称：
- "资质认证证书" | "企业基本资料" | "财务证明材料" | "人员资质证明" | "业绩证明材料" | "技术能力证明" | "声明承诺文件" | "投标文件组成"

请输出JSON格式：
{
  "outline": [{ "section_number": "1", "title": "章节标题", "description": "说明（含格式要求）", "score_weight": "分值", "format_requirements": "字体字号行间距要求（如有）", "children": [{ "section_number": "1.1", "title": "子章节", "description": "内容要求", "required_materials": ["材料"], "suggested_template": "模板类型", "format_template_ref": "对应的投标文件格式名称（如有）" }] }],
  "material_checklist": [{ "requirement_text": "要求原文", "requirement_type": "hard|soft", "material_name": "单项材料名称", "material_format": "分类", "severity": "error|warning|info" }],
  "personnel_plan": [{ "role": "岗位", "requirements": "要求", "suggested_candidate": "人选", "match_reason": "理由" }],
  "overall_strategy": "策略建议（200字以内）",
  "format_spec": { "font_name": "招标要求的字体（如有）", "font_size_body": "正文字号（如有）", "font_size_heading": "标题字号（如有）", "line_spacing": "行间距（如有）", "page_header": "页眉内容要求（如有）" }
}`;

  if (customPrompt) systemContent += `\n\n【用户自定义要求】\n${customPrompt}`;
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
  requestBody.max_tokens = maxTokens;

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
