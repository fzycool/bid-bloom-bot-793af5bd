import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { analysisId, content, projectName } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from("bid_analyses").update({ ai_status: "processing" }).eq("id", analysisId);

    const systemPrompt = `你是一位资深招投标专家，拥有20年标书审查经验。你的任务是像最严格的标书专员一样"读题"并画出所有重点。

请仔细分析以下招标文件内容，提取以下信息：

1. **评分标准表 (scoring_table)**：识别所有评分项目，包括分类、权重/分值、评分细则、需要的佐证材料。

2. **废标项 (disqualification_items)**：找出所有可能导致废标的条款。特别关注带有"★"、"否决投标"、"如不满足则废标"、"强制要求"等标记的内容。severity分为: critical(必废标), high(极高风险), medium(较高风险)。

3. **陷阱项 (trap_items)**：识别逻辑上容易忽略但容易失分的条款。例如：
   - "需同时提供XX和YY，缺一不可"
   - "非本单位人员证明无效"
   - 隐含的时间限制、格式要求等
   risk_level: high/medium/low

4. **专业技能关键词 (technical_keywords)**：从人员要求中提取技术技能词汇，如"精通Spring Cloud"、"熟悉Kubernetes"等。

5. **业务技能关键词 (business_keywords)**：提取业务领域技能，如"具备政务云迁移经验"、"金融行业系统集成经验"等。

6. **工作职责关键词 (responsibility_keywords)**：提取职责描述关键词，如"负责系统架构容灾设计"、"主导项目全生命周期管理"等。

7. **人员配置要求 (personnel_requirements)**：每个角色的具体要求，包括资质、证书、年限等。

8. **总体分析摘要 (summary)**：200字以内的项目概况和投标建议。

9. **风险评分 (risk_score)**：0-100分，分数越高风险越大。

你必须使用提供的工具返回结构化结果。不要遗漏任何关键信息。`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `项目名称: ${projectName || "未知"}\n\n招标文件内容:\n${content}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "analyze_bid_document",
            description: "结构化提取招标文件的评分表、废标项、陷阱项和关键词",
            parameters: {
              type: "object",
              properties: {
                scoring_table: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string", description: "评分大类" },
                      item: { type: "string", description: "评分项" },
                      weight: { type: "string", description: "分值/权重" },
                      criteria: { type: "string", description: "评分细则" },
                      evidence_required: { type: "string", description: "佐证材料要求" },
                    },
                    required: ["category", "item", "weight", "criteria"],
                    additionalProperties: false,
                  },
                },
                disqualification_items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      item: { type: "string", description: "废标条款" },
                      source_text: { type: "string", description: "原文引用" },
                      severity: { type: "string", enum: ["critical", "high", "medium"], description: "严重程度" },
                    },
                    required: ["item", "source_text", "severity"],
                    additionalProperties: false,
                  },
                },
                trap_items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      item: { type: "string", description: "陷阱条款" },
                      risk_level: { type: "string", enum: ["high", "medium", "low"] },
                      description: { type: "string", description: "风险说明" },
                      suggestion: { type: "string", description: "应对建议" },
                    },
                    required: ["item", "risk_level", "description", "suggestion"],
                    additionalProperties: false,
                  },
                },
                technical_keywords: {
                  type: "array",
                  items: { type: "string" },
                  description: "专业技能关键词列表",
                },
                business_keywords: {
                  type: "array",
                  items: { type: "string" },
                  description: "业务技能关键词列表",
                },
                responsibility_keywords: {
                  type: "array",
                  items: { type: "string" },
                  description: "工作职责关键词列表",
                },
                personnel_requirements: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      role: { type: "string", description: "角色名称" },
                      count: { type: "integer", description: "人数" },
                      qualifications: { type: "string", description: "学历/资质要求" },
                      certifications: { type: "array", items: { type: "string" }, description: "所需证书" },
                      experience_years: { type: "integer", description: "经验年限" },
                      specific_requirements: { type: "string", description: "其他特殊要求" },
                    },
                    required: ["role"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string", description: "总体分析摘要" },
                risk_score: { type: "integer", description: "风险评分0-100" },
              },
              required: ["scoring_table", "disqualification_items", "trap_items", "technical_keywords", "business_keywords", "responsibility_keywords", "personnel_requirements", "summary", "risk_score"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "analyze_bid_document" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
      if (status === 429) {
        return new Response(JSON.stringify({ error: "AI服务请求过于频繁，请稍后重试" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI服务额度不足" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", status, t);
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);

      await supabase.from("bid_analyses").update({
        scoring_table: result.scoring_table || [],
        disqualification_items: result.disqualification_items || [],
        trap_items: result.trap_items || [],
        technical_keywords: result.technical_keywords || [],
        business_keywords: result.business_keywords || [],
        responsibility_keywords: result.responsibility_keywords || [],
        personnel_requirements: result.personnel_requirements || [],
        summary: result.summary || "",
        risk_score: result.risk_score ?? 50,
        ai_status: "completed",
      }).eq("id", analysisId);

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
    return new Response(JSON.stringify({ error: "AI未返回有效结果" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-bid error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
