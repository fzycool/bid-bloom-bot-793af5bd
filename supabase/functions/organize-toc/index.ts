import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { outlineSections, importedChapters, tocEntries } = await req.json();

    if (!outlineSections || !Array.isArray(outlineSections)) {
      return new Response(JSON.stringify({ error: "缺少提纲章节数据" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allItems = [
      ...(importedChapters || []).map((c: any) => ({ ...c, item_type: "section" })),
      ...(tocEntries || []).map((e: any) => ({ ...e, item_type: "toc" })),
    ];

    if (allItems.length === 0) {
      return new Response(JSON.stringify({ assignments: [], duplicates: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build compact outline tree text
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

    const outlineText = buildOutline(outlineSections);

    // Build items list
    const itemsText = allItems
      .map((e: any) => `[${e.id}] (${e.item_type}) ${e.title}`)
      .join("\n");

    // Collect all valid outline section IDs
    const allSectionIds = new Set<string>();
    const collectIds = (nodes: any[]) => {
      for (const n of nodes) {
        allSectionIds.add(n.id);
        if (n.children) collectIds(n.children);
      }
    };
    collectIds(outlineSections);

    const systemPrompt = `你是标书目录整理专家。你的任务是将待整理的目录条目归类到投标文件提纲的章节下。

规则：
1. 根据标题语义，将每个待整理条目分配到最合适的提纲章节下
2. 如果有多个条目标题含义相同或高度相似（重复），只保留一个，将其他标记为重复删除
3. parent_section_id 必须是提纲中存在的有效章节ID
4. 同一父级下的条目按逻辑顺序排列(sort_order从0开始递增)
5. 必须调用 organize_toc 工具返回结果
6. 对于无法归类的条目，分配到最接近的提纲章节下`;

    const userPrompt = `投标文件提纲（目标结构）：
${outlineText}

待整理的目录条目：
${itemsText}

请将所有待整理条目归类到提纲章节下。如果有标题重复或含义相同的条目，只保留一个，其余标记为重复。`;

    console.log(`Processing ${allItems.length} items against ${allSectionIds.size} outline sections`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
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
                      description: "保留的条目及其新的父级分配",
                      items: {
                        type: "object",
                        properties: {
                          item_id: { type: "string", description: "条目ID" },
                          item_type: { type: "string", enum: ["section", "toc"], description: "条目类型" },
                          parent_section_id: { type: "string", description: "目标提纲章节ID" },
                          sort_order: { type: "integer", description: "排序序号" },
                        },
                        required: ["item_id", "item_type", "parent_section_id", "sort_order"],
                      },
                    },
                    duplicates: {
                      type: "array",
                      description: "需要删除的重复条目",
                      items: {
                        type: "object",
                        properties: {
                          item_id: { type: "string", description: "重复条目ID" },
                          item_type: { type: "string", enum: ["section", "toc"], description: "条目类型" },
                          reason: { type: "string", description: "重复原因" },
                        },
                        required: ["item_id", "item_type"],
                      },
                    },
                  },
                  required: ["assignments", "duplicates"],
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
      } catch {
        let raw = toolCall.function.arguments;
        const lastComplete = raw.lastIndexOf("}");
        if (lastComplete > 0) {
          raw = raw.substring(0, lastComplete + 1);
          // Try to close arrays and object
          if (!raw.includes('"duplicates"')) {
            raw += '], "duplicates": []}';
          } else {
            raw += "]}";
          }
          parsed = JSON.parse(raw);
        } else {
          throw new Error("AI返回的JSON格式无效");
        }
      }

      // Validate: filter out invalid section IDs and item IDs
      const allItemIds = new Set(allItems.map((i: any) => i.id));

      const validAssignments = (parsed.assignments || []).filter((a: any) =>
        a.item_id && a.parent_section_id && allSectionIds.has(a.parent_section_id) && allItemIds.has(a.item_id)
      );

      const validDuplicates = (parsed.duplicates || []).filter((d: any) =>
        d.item_id && allItemIds.has(d.item_id)
      );

      console.log(`Assignments: ${validAssignments.length}, Duplicates: ${validDuplicates.length}`);

      return new Response(JSON.stringify({ assignments: validAssignments, duplicates: validDuplicates }), {
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
