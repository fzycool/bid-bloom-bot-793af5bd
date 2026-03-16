import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentText, customPrompt } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (!documentText || documentText.trim().length < 50) {
      throw new Error("文档内容不足，无法解析大纲");
    }

    const systemPrompt = `你是投标文件大纲提取专家。用户会给你一份招标文件的全文内容和提取要求。
你需要根据文件内容提取出完整的投标文件大纲结构。

返回严格的JSON格式：
{
  "tree": [
    {
      "id": "new_1",
      "title": "第一章 ...",
      "section_number": "第一章",
      "sort_order": 0,
      "parent_id": null,
      "children": [
        {
          "id": "new_1_1",
          "title": "1.1 ...",
          "section_number": "1.1",
          "sort_order": 0,
          "parent_id": "new_1",
          "children": []
        }
      ]
    }
  ]
}

规则：
1. 所有新节点 id 使用 "new_" 开头
2. 严格从文档中提取，不要虚构章节
3. 保留原始章节编号
4. 按文档中出现的顺序排列
5. 只返回JSON，不要其他内容`;

    const userPrompt = `${customPrompt || "请提取文档的完整大纲结构"}\n\n--- 招标文件内容 ---\n${documentText}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "请求频率过高，请稍后重试" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "额度不足，请充值" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI 调用失败");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 返回格式错误");

    const parsed = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-outline error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
