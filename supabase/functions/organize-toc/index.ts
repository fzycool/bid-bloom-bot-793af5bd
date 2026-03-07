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

    if (!sections || !tocEntries || !Array.isArray(sections) || !Array.isArray(tocEntries)) {
      return new Response(JSON.stringify({ error: "缺少必要参数" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tocEntries.length === 0) {
      return new Response(JSON.stringify({ assignments: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build compact outline - only id and title
    const buildOutline = (nodes: any[], depth = 0): string => {
      return nodes
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((n: any) => {
          const prefix = "  ".repeat(depth);
          const line = `${prefix}[${n.id}] ${n.title}`;
          const childLines = n.children?.length ? buildOutline(n.children, depth + 1) : "";
          return childLines ? `${line}\n${childLines}` : line;
        })
        .join("\n");
    };

    const outlineText = buildOutline(sections);

    // Compact TOC list
    const tocText = tocEntries
      .map((e: any) => `[${e.id}] ${e.title}`)
      .join("\n");

    // Collect all valid section IDs for validation
    const allSectionIds = new Set<string>();
    const collectIds = (nodes: any[]) => {
      for (const n of nodes) {
        allSectionIds.add(n.id);
        if (n.children) collectIds(n.children);
      }
    };
    collectIds(sections);

    const systemPrompt = `你是标书目录整理专家。将目录条目归类到最合适的提纲章节下。
规则：
1. 根据标题语义匹配最合适的章节
2. 同一父级下的条目按逻辑排序(sort_order从0开始)
3. 必须调用organize_toc工具返回结果
4. parent_section_id必须是提纲中的有效章节ID`;

    const userPrompt = `提纲章节：
${outlineText}

待归类目录条目：
${tocText}`;

    console.log(`Processing ${tocEntries.length} toc entries against ${allSectionIds.size} sections`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
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
                          toc_entry_id: { type: "string", description: "目录条目ID" },
                          parent_section_id: { type: "string", description: "目标章节ID" },
                          sort_order: { type: "integer", description: "排序" },
                        },
                        required: ["toc_entry_id", "parent_section_id", "sort_order"],
                      },
                    },
                  },
                  required: ["assignments"],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "organize_toc" } },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const t = await response.text();
        console.error("AI gateway error:", response.status, t);
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ error: "额度不足，请充值" }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`AI调用失败: ${response.status}`);
      }

      const result = await response.json();
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        console.error("No tool call in response:", JSON.stringify(result).substring(0, 500));
        throw new Error("AI未返回有效结果");
      }

      let parsed: any;
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch (parseErr) {
        // Try to repair truncated JSON
        let raw = toolCall.function.arguments;
        // Remove trailing incomplete entry
        const lastComplete = raw.lastIndexOf("}");
        if (lastComplete > 0) {
          raw = raw.substring(0, lastComplete + 1) + "]}";
          parsed = JSON.parse(raw);
        } else {
          throw new Error("AI返回的JSON格式无效");
        }
      }

      // Validate assignments - filter out invalid section IDs
      const validAssignments = (parsed.assignments || []).filter((a: any) =>
        a.toc_entry_id && a.parent_section_id && allSectionIds.has(a.parent_section_id)
      );

      console.log(`Valid assignments: ${validAssignments.length} / ${parsed.assignments?.length || 0}`);

      return new Response(JSON.stringify({ assignments: validAssignments }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
        throw new Error("AI调用超时，请稍后重试");
      }
      throw fetchErr;
    }
  } catch (e) {
    console.error("organize-toc error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
