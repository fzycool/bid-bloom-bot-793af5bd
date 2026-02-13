import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COMPARISON_TOOLS = [{
  type: "function" as const,
  function: {
    name: "compare_bid_documents",
    description: "全面对比多个招标文件的差异",
    parameters: {
      type: "object",
      properties: {
        overview: {
          type: "string",
          description: "整体对比概述，300字以内，总结各文件的核心差异和共性",
        },
        documents: {
          type: "array",
          description: "每个文件的基本信息摘要",
          items: {
            type: "object",
            properties: {
              file_name: { type: "string" },
              project_name: { type: "string" },
              bid_deadline: { type: "string", description: "投标截止时间" },
              bid_location: { type: "string" },
              deposit_amount: { type: "string" },
              risk_score: { type: "integer", description: "0-100风险评分" },
            },
            required: ["file_name", "project_name", "risk_score"],
            additionalProperties: false,
          },
        },
        scoring_comparison: {
          type: "array",
          description: "评分标准差异对比，每项列出各文件的不同之处",
          items: {
            type: "object",
            properties: {
              dimension: { type: "string", description: "对比维度，如'技术评分权重'" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    file_name: { type: "string" },
                    value: { type: "string" },
                  },
                  required: ["file_name", "value"],
                  additionalProperties: false,
                },
              },
              remark: { type: "string", description: "差异点评或建议" },
            },
            required: ["dimension", "details"],
            additionalProperties: false,
          },
        },
        qualification_comparison: {
          type: "array",
          description: "资质门槛与废标项差异",
          items: {
            type: "object",
            properties: {
              dimension: { type: "string" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    file_name: { type: "string" },
                    value: { type: "string" },
                  },
                  required: ["file_name", "value"],
                  additionalProperties: false,
                },
              },
              risk_note: { type: "string", description: "风险提示" },
            },
            required: ["dimension", "details"],
            additionalProperties: false,
          },
        },
        personnel_comparison: {
          type: "array",
          description: "人员配置要求差异",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    file_name: { type: "string" },
                    requirement: { type: "string" },
                  },
                  required: ["file_name", "requirement"],
                  additionalProperties: false,
                },
              },
            },
            required: ["role", "details"],
            additionalProperties: false,
          },
        },
        risk_comparison: {
          type: "array",
          description: "风险项差异（废标项、陷阱项、逻辑冲突）",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["废标项", "陷阱项", "逻辑冲突"] },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    file_name: { type: "string" },
                    content: { type: "string" },
                    severity: { type: "string" },
                  },
                  required: ["file_name", "content"],
                  additionalProperties: false,
                },
              },
              summary: { type: "string" },
            },
            required: ["category", "items"],
            additionalProperties: false,
          },
        },
        recommendations: {
          type: "array",
          description: "基于差异分析的投标策略建议",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              content: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["title", "content", "priority"],
            additionalProperties: false,
          },
        },
      },
      required: ["overview", "documents", "scoring_comparison", "qualification_comparison", "personnel_comparison", "risk_comparison", "recommendations"],
      additionalProperties: false,
    },
  },
}];

const SYSTEM_PROMPT = `你是一位资深招投标分析专家，擅长对多个招标文件进行差异性对比分析。

请对以下多个招标文件进行全面的差异性对比分析，重点关注：

1. **基本信息对比**：项目名称、投标截止时间、地点、保证金等
2. **评分标准差异**：各文件的评分权重、评分细则有何不同
3. **资质门槛差异**：废标条件、资格要求、强制性条款的区别
4. **人员配置差异**：各文件对项目人员的要求有何不同
5. **风险项差异**：废标项、陷阱项、逻辑冲突的对比
6. **投标策略建议**：基于差异分析给出针对性的投标建议

请使用提供的工具返回结构化对比结果。对比要细致入微，不放过任何关键差异。`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { comparisonId, filePaths, fileNames } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from("bid_comparisons").update({ ai_status: "processing" }).eq("id", comparisonId);

    // Build message content with all files
    const contentParts: any[] = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const fileName = fileNames[i] || `文件${i + 1}`;

      const { data: fileData, error: dlError } = await supabase.storage
        .from("knowledge-base")
        .download(filePath);

      if (dlError || !fileData) {
        console.error(`Failed to download ${filePath}:`, dlError?.message);
        continue;
      }

      const isPdf = filePath.endsWith(".pdf");

      if (isPdf) {
        const arrayBuffer = await fileData.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const b64 = base64Encode(uint8Array);
        contentParts.push({
          type: "file",
          file: {
            filename: fileName,
            file_data: `data:application/pdf;base64,${b64}`,
          },
        });
      } else {
        const textContent = await fileData.text();
        contentParts.push({
          type: "text",
          text: `\n\n=== 文件: ${fileName} ===\n${textContent}`,
        });
      }
    }

    contentParts.push({
      type: "text",
      text: `\n\n请对以上 ${filePaths.length} 个招标文件进行全面的差异性对比分析。文件名分别是：${fileNames.join("、")}`,
    });

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: contentParts },
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        tools: COMPARISON_TOOLS,
        tool_choice: { type: "function", function: { name: "compare_bid_documents" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const body = await response.text();
      console.error("AI error:", status, body);
      await supabase.from("bid_comparisons").update({ ai_status: "failed" }).eq("id", comparisonId);
      if (status === 429) {
        return new Response(JSON.stringify({ error: "AI服务请求过于频繁，请稍后重试" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);

      await supabase.from("bid_comparisons").update({
        comparison_result: result,
        ai_status: "completed",
      }).eq("id", comparisonId);

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("bid_comparisons").update({ ai_status: "failed" }).eq("id", comparisonId);
    return new Response(JSON.stringify({ error: "AI未返回有效结果" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("compare-bids error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
