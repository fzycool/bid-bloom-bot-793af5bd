import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentId, fileName, fileType } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 读取活跃模型配置
    const { data: modelConfig } = await supabase.from("model_config").select("*").eq("is_active", true).maybeSingle();
    let aiUrl = modelConfig?.base_url || "https://ai.gateway.lovable.dev/v1/chat/completions";
    if (modelConfig?.base_url && !aiUrl.endsWith("/chat/completions")) {
      aiUrl = aiUrl.replace(/\/+$/, "") + "/chat/completions";
    }
    const aiModel = modelConfig?.model_name || "openai/gpt-5.2";
    const aiKey = modelConfig?.api_key || LOVABLE_API_KEY;
    const isLovable = !modelConfig || modelConfig.provider === "lovable";
    const configMaxTokens = modelConfig?.max_tokens || (isLovable ? 32000 : 8192);

    function sanitizeTools(tools: any[]) {
      if (isLovable) return tools;
      return JSON.parse(JSON.stringify(tools), (key, value) => {
        if (key === "additionalProperties" || key === "nullable") return undefined;
        return value;
      });
    }

    // Update status to processing
    await supabase.from("documents").update({ ai_status: "processing" }).eq("id", documentId);

    const systemPrompt = `你是一个招投标文档分类专家。根据文件名和文件类型，分析并返回以下分类信息。
你必须使用以下工具返回结果。根据文件名推断尽可能多的信息。如果无法确定某个字段，使用null。

doc_category 必须是以下之一：招标文件、投标文件、资质证书、人员证书、合同业绩、友商报价、技术方案、其他
industry 示例：信息技术、建筑工程、医疗卫生、教育、交通、金融、政务、能源等
amount_range 示例：100万以下、100-500万、500-1000万、1000万-5000万、5000万以上`;

    const classifyTools = [{
      type: "function",
      function: {
        name: "classify_document",
        description: "对招投标文档进行分类标注",
        parameters: {
          type: "object",
          properties: {
            doc_category: { type: "string", description: "文档类别" },
            industry: { type: "string", description: "行业分类" },
            owner_name: { type: "string", description: "业主/甲方名称" },
            doc_year: { type: "integer", description: "文档年份" },
            amount_range: { type: "string", description: "金额范围" },
            tags: { type: "array", items: { type: "string" }, description: "额外标签" },
            summary: { type: "string", description: "文档简要描述" },
          },
          required: ["doc_category", "tags", "summary"],
          ...(isLovable ? { additionalProperties: false } : {}),
        },
      },
    }];

    const requestBody: any = {
      model: aiModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `文件名: ${fileName}\n文件类型: ${fileType}` },
      ],
      tools: classifyTools,
    };
    if (isLovable) {
      requestBody.tool_choice = { type: "function", function: { name: "classify_document" } };
    } else {
      requestBody.tool_choice = "auto";
    }

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        await supabase.from("documents").update({ ai_status: "failed" }).eq("id", documentId);
        return new Response(JSON.stringify({ error: "AI服务请求过于频繁，请稍后重试" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        await supabase.from("documents").update({ ai_status: "failed" }).eq("id", documentId);
        return new Response(JSON.stringify({ error: "AI服务额度不足" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", status, t);
      await supabase.from("documents").update({ ai_status: "failed" }).eq("id", documentId);
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);
      
      const clean = (v: any) => (v == null || v === "null" || v === "") ? null : v;

      await supabase.from("documents").update({
        doc_category: clean(result.doc_category) || "其他",
        industry: clean(result.industry),
        owner_name: clean(result.owner_name),
        doc_year: result.doc_year || null,
        amount_range: clean(result.amount_range),
        tags: Array.isArray(result.tags) ? result.tags.filter((t: any) => t != null && t !== "null" && t !== "") : [],
        ai_summary: clean(result.summary) || "",
        ai_status: "completed",
        ai_metadata: result,
      }).eq("id", documentId);

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("documents").update({ ai_status: "failed" }).eq("id", documentId);
    return new Response(JSON.stringify({ error: "AI未返回有效结果" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-document error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
