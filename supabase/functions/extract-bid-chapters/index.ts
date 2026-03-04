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
    const patterns = [
      `${ch.section_number} ${ch.title}`,
      `${ch.section_number}  ${ch.title}`,
      `${ch.section_number}\t${ch.title}`,
      `${ch.section_number}、${ch.title}`,
      `${ch.section_number}.${ch.title}`,
    ];
    const allPositions: number[] = [];
    for (const p of patterns) {
      allPositions.push(...findAllOccurrences(fullText, p));
    }
    // Deduplicate and sort
    const unique = [...new Set(allPositions)].sort((a, b) => a - b);
    return { ...ch, candidates: unique };
  });

  // Detect TOC region: if many chapters cluster in a small region, that's the TOC.
  // Collect all first-occurrence positions to detect cluster.
  const firstPositions = chapterCandidates
    .filter((ch) => ch.candidates.length > 0)
    .map((ch) => ch.candidates[0])
    .sort((a, b) => a - b);

  let tocEnd = 0;
  if (firstPositions.length >= 3) {
    // Check if the first N chapter titles appear within a dense region (TOC)
    // A TOC typically has many titles in a short span vs body has content between them
    const avgGap =
      (firstPositions[firstPositions.length - 1] - firstPositions[0]) /
      (firstPositions.length - 1);
    // If average gap between consecutive titles < 200 chars, likely a TOC
    if (avgGap < 200) {
      tocEnd = firstPositions[firstPositions.length - 1] + 50;
    }
  }

  // Now pick positions sequentially, preferring ones AFTER tocEnd
  let minPos = tocEnd;
  const located: Array<Chapter & { position: number }> = [];

  for (const ch of chapterCandidates) {
    // Find the first candidate at or after minPos
    let chosen = -1;
    for (const pos of ch.candidates) {
      if (pos >= minPos) {
        chosen = pos;
        break;
      }
    }
    // Fallback: if no candidate after minPos, use last candidate (least likely TOC)
    if (chosen < 0 && ch.candidates.length > 0) {
      chosen = ch.candidates[ch.candidates.length - 1];
    }
    if (chosen >= 0) {
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

    const result = splitTextByChapters(fullText, chapters);

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
