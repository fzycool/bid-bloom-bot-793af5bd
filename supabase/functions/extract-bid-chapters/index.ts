import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Chapter {
  section_number: string;
  title: string;
  level: number;
  content?: string;
}

function findAllOccurrences(text: string, pattern: string): number[] {
  const positions: number[] = [];
  let start = 0;
  while (start < text.length) {
    const idx = text.indexOf(pattern, start);
    if (idx < 0) break;
    positions.push(idx);
    start = idx + pattern.length;
  }
  return positions;
}

function splitTextByChapters(
  fullText: string,
  chapters: Chapter[]
): Chapter[] {
  if (!chapters.length) return [];

  // For each chapter, find ALL occurrences of its title patterns
  const chapterCandidates = chapters.map((ch) => {
    const fullPatterns = [
      `${ch.section_number} ${ch.title}`,
      `${ch.section_number}  ${ch.title}`,
      `${ch.section_number}\t${ch.title}`,
      `${ch.section_number}、${ch.title}`,
      `${ch.section_number}.${ch.title}`,
    ];
    const fullPositions: number[] = [];
    for (const p of fullPatterns) {
      fullPositions.push(...findAllOccurrences(fullText, p));
    }
    // Title-only positions (for body headings without section numbers)
    const titlePositions: number[] = [];
    if (ch.title.length >= 3) {
      titlePositions.push(...findAllOccurrences(fullText, ch.title));
    }
    return {
      ...ch,
      candidates: [...new Set(fullPositions)].sort((a, b) => a - b),
      titleCandidates: [...new Set(titlePositions)].sort((a, b) => a - b),
    };
  });

  // Detect TOC region
  const firstPositions = chapterCandidates
    .filter((ch) => ch.candidates.length > 0)
    .map((ch) => ch.candidates[0])
    .sort((a, b) => a - b);

  let tocEnd = 0;
  if (firstPositions.length >= 3) {
    const avgGap =
      (firstPositions[firstPositions.length - 1] - firstPositions[0]) /
      (firstPositions.length - 1);
    console.log("TOC detection: avgGap =", avgGap, "firstPositions count =", firstPositions.length);
    if (avgGap < 200) {
      tocEnd = firstPositions[firstPositions.length - 1] + 50;
      console.log("TOC detected, tocEnd =", tocEnd);
    }
  }

  // Pick positions sequentially, preferring ones AFTER tocEnd
  // Strategy: first try full pattern after tocEnd, then title-only after tocEnd
  let minPos = tocEnd;
  const located: Array<Chapter & { position: number }> = [];

  for (const ch of chapterCandidates) {
    let chosen = -1;

    // 1. Try full pattern (section_number + title) after minPos
    for (const pos of ch.candidates) {
      if (pos >= minPos) {
        chosen = pos;
        break;
      }
    }

    // 2. If not found, try title-only after minPos
    if (chosen < 0) {
      for (const pos of ch.titleCandidates) {
        if (pos >= minPos) {
          chosen = pos;
          break;
        }
      }
    }

    // 3. Last fallback: title-only after tocEnd (reset sequential constraint)
    if (chosen < 0 && tocEnd > 0) {
      for (const pos of ch.titleCandidates) {
        if (pos >= tocEnd) {
          chosen = pos;
          break;
        }
      }
    }

    if (chosen >= 0) {
      console.log(`  matched "${ch.section_number} ${ch.title}" at pos=${chosen}, content_preview="${fullText.substring(chosen, chosen + 40)}"`);
      located.push({
        section_number: ch.section_number,
        title: ch.title,
        level: ch.level,
        position: chosen,
      });
      minPos = chosen + 1;
    }
  }

  // Sort by position and deduplicate
  located.sort((a, b) => a.position - b.position);
  const unique: typeof located = [];
  for (const ch of located) {
    if (!unique.length || ch.position !== unique[unique.length - 1].position) {
      unique.push(ch);
    }
  }

  return unique.map((ch, i) => {
    const start = ch.position;
    const end =
      i + 1 < unique.length ? unique[i + 1].position : fullText.length;
    return {
      section_number: ch.section_number,
      title: ch.title,
      level: ch.level,
      content: fullText.substring(start, end).trim(),
      textStart: start,
      textEnd: end,
    };
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fullText } = await req.json();
    if (!fullText || typeof fullText !== "string") {
      throw new Error("fullText is required");
    }

    if (fullText.length < 50) {
      throw new Error("文档内容过少，无法提取章节结构");
    }

    const forAI =
      fullText.length > 80000 ? fullText.substring(0, 80000) : fullText;

    const systemPrompt = `你是专业的文档结构分析师。请分析以下文档内容，提取完整的章节目录结构。
只提取标题结构，不需要内容。注意识别所有层级的标题（一级、二级、三级等）。
要求：按照文档中实际编号和顺序列出，section_number使用文档原始编号。`;

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "extract_chapters",
          description: "提取文档的章节目录结构",
          parameters: {
            type: "object",
            properties: {
              chapters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    section_number: {
                      type: "string",
                      description: "章节编号",
                    },
                    title: {
                      type: "string",
                      description: "章节标题（不含编号）",
                    },
                    level: {
                      type: "integer",
                      description: "标题层级，1为一级标题",
                    },
                  },
                  required: ["section_number", "title", "level"],
                  additionalProperties: false,
                },
              },
            },
            required: ["chapters"],
            additionalProperties: false,
          },
        },
      },
    ];

    let chapters: Chapter[] = [];

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (lovableKey) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);

        const resp = await fetch(
          "https://ai.gateway.lovable.dev/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${lovableKey}`,
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: forAI },
              ],
              tools,
              tool_choice: {
                type: "function",
                function: { name: "extract_chapters" },
              },
              max_tokens: 8192,
              temperature: 0.1,
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(timer);

        if (resp.status === 429)
          throw new Error("Rate limited, please try again later.");
        if (resp.status === 402)
          throw new Error("Payment required, please add credits.");

        if (resp.ok) {
          const data = await resp.json();
          const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const args = JSON.parse(toolCall.function.arguments);
            chapters = args.chapters || [];
          } else {
            const content = data.choices?.[0]?.message?.content || "";
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              chapters = parsed.chapters || [];
            }
          }
        }
      } catch (e: any) {
        console.error("Lovable AI error:", e.message);
      }
    }

    if (!chapters.length) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data: mc } = await supabase
        .from("model_config")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();

      if (mc?.api_key && mc?.base_url) {
        const resp = await fetch(`${mc.base_url}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mc.api_key}`,
          },
          body: JSON.stringify({
            model: mc.model_name,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: forAI },
            ],
            tools,
            tool_choice: {
              type: "function",
              function: { name: "extract_chapters" },
            },
            max_tokens: mc.max_tokens || 8192,
            temperature: 0.1,
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const args = JSON.parse(toolCall.function.arguments);
            chapters = args.chapters || [];
          }
        }
      }
    }

    if (!chapters.length) {
      throw new Error("AI未能识别文档章节结构，请确认文档包含清晰的章节标题");
    }

    // Debug: log AI chapters and text sample
    console.log("fullText length:", fullText.length);
    console.log("fullText sample (first 500):", fullText.substring(0, 500));
    console.log("AI chapters count:", chapters.length);
    chapters.slice(0, 5).forEach((ch, i) => {
      console.log(`  ch[${i}]: "${ch.section_number}" "${ch.title}" level=${ch.level}`);
    });

    const result = splitTextByChapters(fullText, chapters);

    // Debug: log content sizes
    result.slice(0, 5).forEach((ch, i) => {
      console.log(`  result[${i}]: "${ch.section_number} ${ch.title}" content_len=${ch.content?.length || 0}`);
    });

    return new Response(
      JSON.stringify({ chapters: result, totalChapters: result.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
