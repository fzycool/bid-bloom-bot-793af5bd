import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Minimal ZIP reader (no external deps) ──

function readUint16(d: Uint8Array, o: number) {
  return d[o] | (d[o + 1] << 8);
}
function readUint32(d: Uint8Array, o: number) {
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

async function extractFileFromZip(
  data: Uint8Array,
  targetName: string
): Promise<Uint8Array> {
  // Find End of Central Directory
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65558); i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP file");

  const cdOffset = readUint32(data, eocd + 16);
  const cdEntries = readUint16(data, eocd + 10);

  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (
      data[pos] !== 0x50 ||
      data[pos + 1] !== 0x4b ||
      data[pos + 2] !== 0x01 ||
      data[pos + 3] !== 0x02
    )
      break;

    const compMethod = readUint16(data, pos + 10);
    const compSize = readUint32(data, pos + 20);
    const nameLen = readUint16(data, pos + 28);
    const extraLen = readUint16(data, pos + 30);
    const commentLen = readUint16(data, pos + 32);
    const localOffset = readUint32(data, pos + 42);
    const name = new TextDecoder().decode(
      data.subarray(pos + 46, pos + 46 + nameLen)
    );

    if (name === targetName) {
      const lNameLen = readUint16(data, localOffset + 26);
      const lExtraLen = readUint16(data, localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = data.subarray(dataStart, dataStart + compSize);

      if (compMethod === 0) return raw;
      if (compMethod === 8) return await inflateRaw(raw);
      throw new Error(`Unsupported compression method: ${compMethod}`);
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${targetName} not found in ZIP`);
}

// ── DOCX text extraction ──

async function extractDocxText(data: Uint8Array): Promise<string> {
  const xmlBytes = await extractFileFromZip(data, "word/document.xml");
  const xml = new TextDecoder().decode(xmlBytes);
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Chapter splitting ──

interface Chapter {
  section_number: string;
  title: string;
  level: number;
  content?: string;
}

function splitTextByChapters(
  fullText: string,
  chapters: Chapter[]
): Chapter[] {
  if (!chapters.length) return [];

  const located = chapters.map((ch) => {
    const patterns = [
      `${ch.section_number} ${ch.title}`,
      `${ch.section_number}  ${ch.title}`,
      `${ch.section_number}\t${ch.title}`,
      `${ch.section_number}、${ch.title}`,
      `${ch.section_number}.${ch.title}`,
      `${ch.section_number} `,
      ch.title,
    ];
    let pos = -1;
    for (const p of patterns) {
      const idx = fullText.indexOf(p);
      if (idx >= 0) {
        pos = idx;
        break;
      }
    }
    return { ...ch, position: pos };
  });

  const found = located
    .filter((ch) => ch.position >= 0)
    .sort((a, b) => a.position - b.position);

  const unique: typeof found = [];
  for (const ch of found) {
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

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filePath } = await req.json();
    if (!filePath) throw new Error("filePath is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: fileData, error: dlErr } = await supabase.storage
      .from("company-materials")
      .download(filePath);
    if (dlErr) throw new Error(`下载文件失败: ${dlErr.message}`);

    const buf = await fileData.arrayBuffer();
    let fullText = "";

    if (filePath.toLowerCase().endsWith(".docx")) {
      fullText = await extractDocxText(new Uint8Array(buf));
    } else {
      throw new Error("目前仅支持DOCX格式文件");
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
