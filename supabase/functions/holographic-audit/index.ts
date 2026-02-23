import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

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

    const { proposalId, filePath, fileType, auditType = "full" } = await req.json();
    if (!proposalId) throw new Error("proposalId is required");
    if (!filePath) throw new Error("请上传终版标书文件");

    // Fetch proposal + bid analysis
    const { data: proposal } = await supabase
      .from("bid_proposals")
      .select("*, bid_analyses(*)")
      .eq("id", proposalId)
      .single();
    if (!proposal) throw new Error("投标方案不存在");

    const bid = (proposal as any).bid_analyses;

    // Fetch proposal sections, materials, employees, resumes in parallel
    const [
      { data: sections },
      { data: materials },
      { data: employees },
      { data: resumes },
    ] = await Promise.all([
      supabase.from("proposal_sections").select("*").eq("proposal_id", proposalId).order("sort_order"),
      supabase.from("proposal_materials").select("*").eq("proposal_id", proposalId),
      supabase.from("employees").select("*").eq("user_id", proposal.user_id),
      supabase.from("resume_versions").select("*").eq("user_id", proposal.user_id).eq("ai_status", "completed"),
    ]);

    let outlineData: any = null;
    try {
      outlineData = proposal.outline_content ? JSON.parse(proposal.outline_content) : null;
    } catch { /* ignore */ }

    // Download the uploaded bid document
    const { data: fileData, error: dlError } = await supabase.storage
      .from("knowledge-base")
      .download(filePath);
    if (dlError || !fileData) throw new Error(`文件下载失败: ${dlError?.message || "unknown"}`);

    // Create audit report record
    const { data: report, error: insertErr } = await supabase
      .from("audit_reports")
      .insert({
        proposal_id: proposalId,
        user_id: proposal.user_id,
        ai_status: "processing",
        audit_type: auditType,
        file_path: filePath,
      })
      .select("id")
      .single();
    if (insertErr || !report) throw insertErr || new Error("创建审查报告失败");

    const systemPrompt = `你是资深投标评审专家，以甲方评委的严苛视角对投标文件进行全面审查。

你将收到：
1. 终版投标文件（完整标书）
2. 招标文件的解析数据（评分标准、废标条件等）
3. 投标提纲和证明材料清单
4. 人员和简历信息

请按以下维度进行逐项检查：

## 1. 响应性检查
逐条对照招标文件的评分标准和废标条件，检查终版标书中是否有实质性应答。
- 不仅检查星号项，还要检查每一个评分细则
- 标注漏项风险和应答不充分的章节

## 2. 逻辑一致性校验
- 人员逻辑：方案中提到的人数与实际人员清单/简历数量是否一致
- 证书逻辑：简历中声称的证书与实际附件证明材料是否匹配
- 报价逻辑：如有报价信息，检查分项累加是否一致
- 数据一致性：各章节引用的数据、数字是否前后一致

## 3. 语义连贯性审查
- 检查各章节之间的过渡是否自然
- 检测是否存在"硬拼接"（前后章节主题突然跳变、行业术语不一致）
- 检查是否存在上下文语义漂移（如前文讲智慧校园后文却提智慧医疗）
- 检查是否有明显的复制粘贴痕迹（如项目名称不一致）

请严格输出纯JSON：
{
  "findings": [
    {
      "category": "response|logic|semantic",
      "severity": "error|warning|info",
      "title": "问题标题（简洁）",
      "description": "问题描述",
      "location": "问题所在章节或页码",
      "suggestion": "修改建议"
    }
  ],
  "summary": "整体审查总结（200字以内）",
  "score": 85
}

其中 score 为投标文件质量评分（0-100），评分参考：
- 90-100：优秀，几乎无问题
- 70-89：良好，存在少量可改进项
- 50-69：合格，存在若干需要修复的问题
- 0-49：不合格，存在严重问题需立即修复`;

    // Build context text for supplementary data
    const contextText = `【招标项目】${bid?.project_name || proposal.project_name || "未命名"}

【招标文件评分标准】
${JSON.stringify(bid?.scoring_table || [])}

【废标红线】
${JSON.stringify(bid?.disqualification_items || [])}

【人员配置要求】
${JSON.stringify(bid?.personnel_requirements || [])}

【技术关键词】${JSON.stringify(bid?.technical_keywords || [])}
【业务关键词】${JSON.stringify(bid?.business_keywords || [])}

【投标提纲】
${(sections || []).map((s: any) => `${s.section_number || ""} ${s.title}`).join("\n")}

【证明材料清单】
${(materials || []).map((m: any) => `- ${m.material_name || "未知"} [${m.requirement_type}/${m.status}] ${m.requirement_text}`).join("\n")}

【人员配置计划】
${outlineData?.personnel_plan ? JSON.stringify(outlineData.personnel_plan) : "无"}

【实际可用人员】
${(employees || []).map((e: any) => `- ${e.name}: ${e.current_position || "未知"}, 证书: ${(e.certifications || []).join(",")}`).join("\n")}

【已有简历】
${(resumes || []).map((r: any) => `- 员工ID:${r.employee_id}, 版本:${r.version_name}, 岗位:${r.target_role || "未知"}`).join("\n")}

【招标摘要】${bid?.summary || "无"}`;

    // Build messages - send PDF as multimodal, others as text
    const messages: any[] = [{ role: "system", content: systemPrompt }];
    const isPdf = filePath.endsWith(".pdf") || fileType?.includes("pdf");

    if (isPdf) {
      const arrayBuffer = await fileData.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const b64 = base64Encode(uint8Array);

      messages.push({
        role: "user",
        content: [
          {
            type: "file",
            file: {
              filename: filePath.split("/").pop() || "bid-document.pdf",
              file_data: `data:application/pdf;base64,${b64}`,
            },
          },
          {
            type: "text",
            text: `以上是终版投标文件，请结合以下招标要求和辅助数据进行全面审查：\n\n${contextText}`,
          },
        ],
      });
    } else {
      const textContent = await fileData.text();
      messages.push({
        role: "user",
        content: `以下是终版投标文件内容：\n\n${textContent}\n\n---\n\n请结合以下招标要求和辅助数据进行全面审查：\n\n${contextText}`,
      });
    }

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModel,
        messages,
      }),
    });

    if (!response.ok) {
      await supabase.from("audit_reports").update({ ai_status: "failed" }).eq("id", report.id);
      const status = response.status;
      if (status === 429) return new Response(JSON.stringify({ error: "AI服务请求过于频繁" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI服务额度不足" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error: ${status}`);
    }

    const data = await response.json();
    let resultText = data.choices?.[0]?.message?.content || "";
    resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result;
    try {
      result = JSON.parse(resultText);
    } catch {
      console.error("Failed to parse AI response:", resultText);
      await supabase.from("audit_reports").update({ ai_status: "failed" }).eq("id", report.id);
      throw new Error("AI返回格式异常");
    }

    await supabase.from("audit_reports").update({
      findings: result.findings || [],
      summary: result.summary || "",
      score: result.score || 0,
      ai_status: "completed",
    }).eq("id", report.id);

    return new Response(JSON.stringify({ success: true, reportId: report.id, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("holographic-audit error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
