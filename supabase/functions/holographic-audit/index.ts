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

    const { proposalId, auditType = "full" } = await req.json();
    if (!proposalId) throw new Error("proposalId is required");

    // Fetch proposal + bid analysis
    const { data: proposal } = await supabase
      .from("bid_proposals")
      .select("*, bid_analyses(*)")
      .eq("id", proposalId)
      .single();
    if (!proposal) throw new Error("投标方案不存在");

    const bid = (proposal as any).bid_analyses;

    // Fetch proposal sections
    const { data: sections } = await supabase
      .from("proposal_sections")
      .select("*")
      .eq("proposal_id", proposalId)
      .order("sort_order");

    // Fetch proposal materials
    const { data: materials } = await supabase
      .from("proposal_materials")
      .select("*")
      .eq("proposal_id", proposalId);

    // Fetch employees assigned via personnel_plan in outline
    let outlineData: any = null;
    try {
      outlineData = proposal.outline_content ? JSON.parse(proposal.outline_content) : null;
    } catch { /* ignore */ }

    // Fetch employee details if personnel plan exists
    const { data: employees } = await supabase
      .from("employees")
      .select("*")
      .eq("user_id", proposal.user_id);

    // Fetch resume versions for employees
    const { data: resumes } = await supabase
      .from("resume_versions")
      .select("*")
      .eq("user_id", proposal.user_id)
      .eq("ai_status", "completed");

    // Create audit report record
    const { data: report, error: insertErr } = await supabase
      .from("audit_reports")
      .insert({
        proposal_id: proposalId,
        user_id: proposal.user_id,
        ai_status: "processing",
        audit_type: auditType,
      })
      .select("id")
      .single();
    if (insertErr || !report) throw insertErr || new Error("创建审查报告失败");

    const systemPrompt = `你是资深投标评审专家，以甲方评委的严苛视角对投标文件进行全面审查。

请按以下维度进行逐项检查，输出JSON格式的审查报告：

## 1. 响应性检查
逐条对照招标文件要求（包括评分标准、废标条件、技术要求），检查投标文件是否有实质性应答。
- 对每个招标要求条款，判断投标文件中是否有对应的应答
- 标注漏项风险

## 2. 逻辑一致性校验
- 人员逻辑：方案中提到的人数与实际人员清单/简历数量是否一致
- 证书逻辑：简历中声称的证书与实际附件证明材料是否匹配
- 报价逻辑：如有报价信息，检查分项累加是否一致
- 数据一致性：各章节引用的数据、数字是否前后一致

## 3. 语义连贯性审查
- 检查各章节之间的过渡是否自然
- 检测是否存在"硬拼接"（前后章节主题突然跳变、行业术语不一致）
- 检查是否存在上下文语义漂移（如前文讲智慧校园后文却提智慧医疗）

请严格输出纯JSON：
{
  "findings": [
    {
      "category": "response|logic|semantic",
      "severity": "error|warning|info",
      "title": "问题标题（简洁）",
      "description": "问题描述",
      "location": "问题所在章节或位置",
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

    const userContent = `【招标项目】${bid?.project_name || proposal.project_name || "未命名"}

【招标文件评分标准】
${JSON.stringify(bid?.scoring_table || [])}

【废标红线】
${JSON.stringify(bid?.disqualification_items || [])}

【人员配置要求】
${JSON.stringify(bid?.personnel_requirements || [])}

【技术关键词】${JSON.stringify(bid?.technical_keywords || [])}
【业务关键词】${JSON.stringify(bid?.business_keywords || [])}
【职责关键词】${JSON.stringify(bid?.responsibility_keywords || [])}

【投标文件提纲与内容】
${(sections || []).map((s: any) => `${s.section_number || ""} ${s.title}: ${s.content || "（空）"}`).join("\n")}

【证明材料清单】
${(materials || []).map((m: any) => `- ${m.material_name || "未知"} [${m.requirement_type}/${m.status}] ${m.requirement_text}`).join("\n")}

【人员配置计划】
${outlineData?.personnel_plan ? JSON.stringify(outlineData.personnel_plan) : "无"}

【实际可用人员】
${(employees || []).map((e: any) => `- ${e.name}: ${e.current_position || "未知"}, 技能: ${(e.skills || []).join(",")}, 证书: ${(e.certifications || []).join(",")}`).join("\n")}

【已有简历版本】
${(resumes || []).map((r: any) => `- 员工ID:${r.employee_id}, 版本:${r.version_name}, 目标岗位:${r.target_role || "未知"}`).join("\n")}

【招标文件摘要】
${bid?.summary || "无"}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
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

    // Save audit results
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
