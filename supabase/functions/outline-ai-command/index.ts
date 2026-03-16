import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { command, currentTree, documentText } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const isCommitment = command === "__GENERATE_COMMITMENT__";

    const systemPrompt = isCommitment
      ? `你是投标文件专家。根据用户提供的招标文件原文，识别所有涉及"承诺"的段落（如承诺书、保证、声明等），
生成一个完整的承诺章节大纲。返回JSON格式：
{
  "commitmentNodes": [
    {
      "title": "承诺书",
      "children": [
        { "title": "质量承诺" },
        { "title": "工期承诺" },
        { "title": "售后服务承诺" },
        ...
      ]
    }
  ]
}
只返回JSON，不要其他内容。根据招标文件实际内容调整子节点。`
      : `你是投标文件大纲编辑专家。用户会给你当前的大纲树结构和一条自然语言指令。
你需要根据指令修改大纲树并返回完整的新树结构。

当前大纲树结构（JSON格式，每个节点有 id, title, section_number, sort_order, parent_id, children）：
${JSON.stringify(currentTree, null, 2)}

规则：
1. 保留原有节点的 id 不变
2. 新增节点使用 "new_" 开头的 id
3. 返回完整的树结构 JSON
4. 格式：{ "tree": [...] }
5. 只返回JSON，不要其他内容`;

    const userPrompt = isCommitment
      ? `招标文件原文（部分）：\n${documentText}`
      : command;

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
        temperature: 0.3,
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

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 返回格式错误");

    const parsed = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("outline-ai-command error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
