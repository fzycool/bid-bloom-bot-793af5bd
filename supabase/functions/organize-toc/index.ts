import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { sections, tocEntries } = await req.json();

    if (!sections || !tocEntries) {
      return new Response(JSON.stringify({ error: "缺少必要参数" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build a readable outline structure
    const buildOutline = (nodes: any[], depth = 0): string => {
      return nodes
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((n: any) => {
          const prefix = "  ".repeat(depth);
          const num = n.section_number || "";
          const line = `${prefix}[ID:${n.id}] ${num} ${n.title}`;
          const childLines = n.children?.length ? buildOutline(n.children, depth + 1) : "";
          return childLines ? `${line}\n${childLines}` : line;
        })
        .join("\n");
    };

    const outlineText = buildOutline(sections);

    const tocText = tocEntries
      .map((e: any) => `[ID:${e.id}] ${e.section_number || ""} ${e.title} (当前父级: ${e.parent_section_id || "无"})`)
      .join("\n");

    const systemPrompt = `你是一个标书目录整理专家。你的任务是将现有的标书目录条目（TOC entries）归类到正确的投标文件提纲章节（Sections）下。

规则：
1. 根据标书目录条目的标题内容，判断它应该属于提纲中的哪个章节
2. 通过语义匹配，将每个目录条目分配到最合适的提纲章节下
3. 同一父级下的条目按照逻辑顺序排列，给出合理的 sort_order（从0开始）
4. 如果某个目录条目无法明确归类，保持其当前的 parent_section_id 不变
5. 返回每个条目的新 parent_section_id 和 sort_order

你必须调用 organize_toc 工具返回结果。`;

    const userPrompt = `## 投标文件提纲（目标章节结构）：
${outlineText}

## 现有标书目录条目（需要归类）：
${tocText}

请分析每个目录条目的内容，将它们归类到最合适的提纲章节下，并给出合理的排序。`;

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
        tools: [
          {
            type: "function",
            function: {
              name: "organize_toc",
              description: "返回重新组织后的目录条目分配结果",
              parameters: {
                type: "object",
                properties: {
                  assignments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        toc_entry_id: { type: "string", description: "目录条目的ID" },
                        parent_section_id: { type: "string", description: "分配到的提纲章节ID" },
                        sort_order: { type: "integer", description: "在父章节下的排序" },
                      },
                      required: ["toc_entry_id", "parent_section_id", "sort_order"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["assignments"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "organize_toc" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "额度不足，请充值" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI调用失败: ${response.status}`);
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI未返回有效结果");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ assignments: parsed.assignments }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("organize-toc error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
