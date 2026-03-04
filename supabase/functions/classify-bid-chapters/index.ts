import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { chapters } = await req.json();
    if (!Array.isArray(chapters) || !chapters.length) {
      return new Response(JSON.stringify({ error: "chapters required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Build chapter list for the prompt
    const chapterList = chapters.map((ch: any, i: number) => `${i}: ${ch.section_number} ${ch.title}`).join("\n");

    const systemPrompt = `你是招投标文档专家。用户会给你一份标书目录清单，请判断哪些章节属于"证明文件类"材料。

证明文件类包括但不限于：
- 资质证书（营业执照、ISO认证、行业资质等）
- 人员证书（项目经理证书、技术人员资质等）
- 法定代表人身份证明/授权委托书
- 财务报表/审计报告
- 社保证明/纳税证明
- 业绩证明/合同/中标通知书
- 信用报告/无犯罪记录证明
- 承诺书/声明函
- 投标保证金证明
- 类似项目案例/业绩表

不属于证明文件类的章节（不要选择）：
- 投标函/报价表/开标一览表（属于商务文件）
- 技术方案/实施方案/服务方案（属于技术文件）
- 目录/封面/密封条（属于格式文件）
- 偏差表/响应表（属于商务文件）

请使用工具返回结果。`;

    const tools = [{
      type: "function",
      function: {
        name: "select_chapters",
        description: "返回属于证明文件类的章节索引",
        parameters: {
          type: "object",
          properties: {
            selected_indices: {
              type: "array",
              items: { type: "integer" },
              description: "属于证明文件类的章节索引（从0开始）",
            },
          },
          required: ["selected_indices"],
          ...(isLovable ? { additionalProperties: false } : {}),
        },
      },
    }];

    const requestBody: any = {
      model: aiModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `以下是标书目录，请选出证明文件类章节的索引：\n\n${chapterList}` },
      ],
      tools,
    };
    if (isLovable) {
      requestBody.tool_choice = { type: "function", function: { name: "select_chapters" } };
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
      const indices = (result.selected_indices || []).filter(
        (i: number) => typeof i === "number" && i >= 0 && i < chapters.length
      );
      console.log(`Auto-selected ${indices.length}/${chapters.length} chapters as certificate docs`);
      return new Response(JSON.stringify({ selected_indices: indices }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ selected_indices: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-bid-chapters error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
