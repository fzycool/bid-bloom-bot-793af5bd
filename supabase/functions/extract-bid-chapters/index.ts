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

// ─── Text search helpers ──────────────────────────────────────────

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

function findLineStartOccurrences(text: string, pattern: string): number[] {
  const positions: number[] = [];
  let start = 0;
  while (start < text.length) {
    const idx = text.indexOf(pattern, start);
    if (idx < 0) break;
    if (idx === 0 || text[idx - 1] === "\n") {
      positions.push(idx);
    }
    start = idx + pattern.length;
  }
  return positions;
}

// ─── Fallback: extract chapter headings from body text ────────────

function extractChaptersFromBody(fullText: string): Chapter[] {
  const chapters: Chapter[] = [];
  const lines = fullText.split("\n");

  // Patterns for chapter headings in body text
  const bodyPatterns: Array<{ regex: RegExp; groups: 2 }> = [
    // "第一章 标题" or "第1章 标题"
    { regex: /^(第[一二三四五六七八九十百千\d]+[章部分节篇])\s*[.、：:\s]*(.+?)(?:\s*[.·…]+\s*\d*\s*)?$/, groups: 2 },
    // "1.1. 标题" or "1.1 标题" — require at least one dot to avoid matching years like "2025"
    { regex: /^(\d+\.\d+(?:\.\d+)*\.?)\s+(.+?)(?:\s*[.·…]+\s*\d*\s*)?$/, groups: 2 },
    // Top-level "1 标题" — only single digit 1-99 to avoid years
    { regex: /^(\d{1,2})\s+([^\d].{2,})(?:\s*[.·…]+\s*\d*\s*)?$/, groups: 2 },
    // "（一）标题" or "(1) 标题"
    { regex: /^([（(][一二三四五六七八九十\d]+[）)])\s*(.+?)(?:\s*[.·…]+\s*\d*\s*)?$/, groups: 2 },
    // "附录A 标题" or "附件1 标题"
    { regex: /^(附[录件表]\s*[A-Za-z\d]*)\s*[.、\s]*(.+?)(?:\s*[.·…]+\s*\d*\s*)?$/, groups: 2 },
    // "一、标题" Chinese numbered
    { regex: /^([一二三四五六七八九十百]+)[、.．]\s*(.+?)(?:\s*[.·…]+\s*\d*\s*)?$/, groups: 2 },
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 200 || trimmed.length < 2) continue;

    for (const { regex } of bodyPatterns) {
      const m = trimmed.match(regex);
      if (m) {
        const sectionNum = m[1].replace(/\.$/, "").trim();
        const title = m[2].trim()
          .replace(/[.\s·…]+\d*$/, "")
          .trim();
        if (title.length < 1 || title.length > 80) continue;
        // Skip date-like matches: "2025年", "6 月" etc.
        if (/^\d{4}年/.test(trimmed) || /^\d{1,2}\s*月/.test(trimmed)) continue;
        const level = inferLevel(sectionNum);
        chapters.push({ section_number: sectionNum, title, level });
        break;
      }
    }
  }

  console.log(`Body scan found ${chapters.length} chapter headings`);
  return chapters;
}

// ─── Pre-processing: extract TOC from text directly ───────────────

function extractTocFromText(fullText: string): Chapter[] {
  const chapters: Chapter[] = [];

  // Find Word-style TOC region (look for "目录" or "目 录" followed by structured entries)
  let tocIdx = fullText.indexOf("目录");
  if (tocIdx < 0) tocIdx = fullText.indexOf("目 录");
  
  // If no TOC found, try scanning the full text for chapter heading patterns
  if (tocIdx < 0) {
    return extractChaptersFromBody(fullText);
  }

  // Get text after "目录" — scan up to 50K chars to handle very long TOCs (70-80+ entries)
  const tocRegion = fullText.substring(tocIdx, Math.min(tocIdx + 50000, fullText.length));
  const lines = tocRegion.split("\n").slice(1); // skip the "目录" line itself

  // Patterns for TOC entries
  const tocPatterns = [
    // "第一章 标题" or "第1章 标题"
    /^(第[一二三四五六七八九十百千\d]+[章部分节篇])\s*[.、\s]*(.+?)(?:\s*PAGEREF|\s*\d+\s*$|\t|$)/,
    // "1.1. 标题" or "1.1 标题" — also match "1 标题"
    /^(\d+(?:\.\d+)*\.?)\s+(.+?)(?:\s*PAGEREF|\s*\d+\s*$|\t|$)/,
    // "（一）标题" or "(1) 标题"
    /^([（(][一二三四五六七八九十\d]+[）)])\s*(.+?)(?:\s*PAGEREF|\s*\d+\s*$|\t|$)/,
    // "附录A 标题" or "附件1 标题"
    /^(附[录件表]\s*[A-Za-z\d]*)\s*[.、\s]*(.+?)(?:\s*PAGEREF|\s*\d+\s*$|\t|$)/,
    // "一、标题" Chinese numbered without parentheses
    /^([一二三四五六七八九十百]+)[、.．]\s*(.+?)(?:\s*PAGEREF|\s*\d+\s*$|\t|$)/,
    // Unnumbered TOC entries: lines ending with dots + page number (e.g. "评分导航表....5")
    /^([^\d第附（(一二三四五六七八九十\s][^\n]{1,30}?)\s*[.·…]+\s*\d+\s*$/,
  ];

  let emptyLineCount = 0;
  let consecutiveNonMatch = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      emptyLineCount++;
      // Allow up to 8 empty lines (DOCX TOCs often have extra spacing)
      if (emptyLineCount > 8) break;
      continue;
    }

    // Skip PAGEREF/TOC field codes
    if (/^\\[lfh]$|^TOC\s|^PAGEREF/.test(trimmed)) continue;
    // Skip pure page numbers
    if (/^\d+$/.test(trimmed)) continue;
    // Skip dots-only lines (TOC leader dots)
    if (/^[.\s·…]+$/.test(trimmed)) continue;

    emptyLineCount = 0;
    let matched = false;

    for (const pattern of tocPatterns) {
      const m = trimmed.match(pattern);
      if (m) {
        let sectionNum: string;
        let title: string;

        if (m.length === 2) {
          // Unnumbered TOC entry pattern: only one capture group (the title)
          sectionNum = "";
          title = m[1].trim()
            .replace(/[.\s·…]+\d*$/, "")
            .trim();
        } else {
          sectionNum = m[1].replace(/\.$/, "").trim();
          title = m[2].trim()
            .replace(/\s*PAGEREF\s.*$/, "")
            .replace(/\s*\\h\s*$/, "")
            .replace(/\t.*$/, "")
            .replace(/[.\s·…]+\d*$/, "") // Remove trailing dots + page numbers
            .trim();
        }

        if (title.length < 1 || title.length > 120) continue;

        const level = sectionNum ? inferLevel(sectionNum) : 1;
        chapters.push({ section_number: sectionNum, title, level });
        matched = true;
        consecutiveNonMatch = 0;
        break;
      }
    }

    if (!matched) {
      consecutiveNonMatch++;
      // Only break after many consecutive non-matching lines AND we have some entries
      // This prevents premature exit on TOCs with occasional noise lines
      if (chapters.length > 10 && consecutiveNonMatch > 8 && trimmed.length > 150) break;
    }
  }

  return chapters;
}

function inferLevel(sectionNum: string): number {
  // "第X章", "第X部分" → level 1
  if (/^第.+[章部分篇]$/.test(sectionNum)) return 1;
  // "第X节" → level 2
  if (/^第.+节$/.test(sectionNum)) return 2;
  // Numbered: count dots
  const dotMatch = sectionNum.match(/^(\d+)(\.(\d+))?(\.(\d+))?(\.(\d+))?/);
  if (dotMatch) {
    if (dotMatch[7]) return 4;
    if (dotMatch[5]) return 3;
    if (dotMatch[3]) return 2;
    return 1;
  }
  // （一）→ level 2, （1）→ level 3
  if (/^[（(][一二三四五六七八九十]+[）)]$/.test(sectionNum)) return 2;
  if (/^[（(]\d+[）)]$/.test(sectionNum)) return 3;
  // 附录/附件 → level 1
  if (/^附/.test(sectionNum)) return 1;
  return 1;
}

// ─── JSON repair for truncated AI output ──────────────────────────

function repairAndParseJson(raw: string): any {
  // Clean markdown
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Find JSON start
  const jsonStart = cleaned.search(/[\[{]/);
  if (jsonStart < 0) throw new Error("No JSON found");
  cleaned = cleaned.substring(jsonStart);

  // Try direct parse
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // Remove trailing commas
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  // Try again
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // Force-close open brackets
  let open = 0, close = 0;
  for (const c of cleaned) {
    if (c === "{" || c === "[") open++;
    if (c === "}" || c === "]") close++;
  }

  // Remove trailing incomplete property (e.g., `"title": "some` without closing)
  cleaned = cleaned.replace(/,\s*\{[^}]*$/, "");
  cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");

  // Re-count and close
  open = 0; close = 0;
  const stack: string[] = [];
  for (const c of cleaned) {
    if (c === "{") stack.push("}");
    if (c === "[") stack.push("]");
    if (c === "}" || c === "]") stack.pop();
  }
  cleaned += stack.reverse().join("");

  try { return JSON.parse(cleaned); } catch (e) {
    // Last resort: find last valid closing bracket for the outermost structure
    const firstChar = cleaned[0];
    const endChar = firstChar === "[" ? "]" : "}";
    const lastEnd = cleaned.lastIndexOf(endChar);
    if (lastEnd > 0) {
      try { return JSON.parse(cleaned.substring(0, lastEnd + 1)); } catch { /* give up */ }
    }
    throw e;
  }
}

// ─── Smart text selection for AI ──────────────────────────────────

function selectTextForAI(fullText: string, maxLen: number): string {
  if (fullText.length <= maxLen) return fullText;

  // Try to find TOC region and include it plus content after
  const tocIdx = fullText.indexOf("目录");
  if (tocIdx >= 0 && tocIdx < fullText.length / 2) {
    // Include some context before TOC + everything after
    const start = Math.max(0, tocIdx - 2000);
    const selected = fullText.substring(start, start + maxLen);
    if (selected.length > maxLen * 0.5) return selected;
  }

  // For very large docs: include beginning + end (chapter titles often appear at transitions)
  if (fullText.length > maxLen * 1.5) {
    const headSize = Math.floor(maxLen * 0.7);
    const tailSize = maxLen - headSize;
    return fullText.substring(0, headSize) + "\n\n...[中间内容省略]...\n\n" + fullText.substring(fullText.length - tailSize);
  }

  // Fallback: first maxLen chars
  return fullText.substring(0, maxLen);
}

// ─── Chapter-to-text mapping ─────────────────────────────────────

function splitTextByChapters(fullText: string, chapters: Chapter[]): Chapter[] {
  if (!chapters.length) return [];

  const chapterCandidates = chapters.map((ch) => {
    const fullPatterns: string[] = [];
    if (ch.section_number) {
      const seps = [" ", "  ", "\t", "、", ".", " ", ""];
      for (const sep of seps) {
        fullPatterns.push(`${ch.section_number}${sep}${ch.title}`);
      }
      fullPatterns.push(`${ch.section_number}\n${ch.title}`);
    } else {
      // Unnumbered entry: search by title alone
      fullPatterns.push(ch.title);
    }

    const fullPositions: number[] = [];
    for (const p of fullPatterns) {
      fullPositions.push(...findAllOccurrences(fullText, p));
    }

    const titleLineStartPositions: number[] = [];
    if (ch.title.length >= 3) {
      titleLineStartPositions.push(...findLineStartOccurrences(fullText, ch.title));
    }

    return {
      ...ch,
      candidates: [...new Set(fullPositions)].sort((a, b) => a - b),
      titleCandidates: [...new Set(titleLineStartPositions)].sort((a, b) => a - b),
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
    if (avgGap < 200) {
      tocEnd = firstPositions[firstPositions.length - 1] + 50;
      console.log("TOC detected, tocEnd =", tocEnd);
    }
  }

  let minPos = tocEnd;
  const located: Array<Chapter & { position: number }> = [];

  for (const ch of chapterCandidates) {
    let chosen = -1;

    for (const pos of ch.candidates) {
      if (pos >= minPos) { chosen = pos; break; }
    }

    if (chosen < 0) {
      for (const pos of ch.titleCandidates) {
        if (pos >= minPos) { chosen = pos; break; }
      }
    }

    if (chosen < 0 && tocEnd > 0) {
      for (const pos of ch.titleCandidates) {
        if (pos >= tocEnd) { chosen = pos; break; }
      }
    }

    if (chosen >= 0) {
      located.push({ section_number: ch.section_number, title: ch.title, level: ch.level, position: chosen });
      minPos = chosen + 1;
    } else {
      console.log(`  SKIPPED "${ch.section_number} ${ch.title}" — no position found`);
    }
  }

  located.sort((a, b) => a.position - b.position);
  const unique: typeof located = [];
  for (const ch of located) {
    if (!unique.length || ch.position !== unique[unique.length - 1].position) {
      unique.push(ch);
    }
  }

  return unique.map((ch, i) => {
    const start = ch.position;
    const end = i + 1 < unique.length ? unique[i + 1].position : fullText.length;
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

// ─── AI call helper ──────────────────────────────────────────────

async function callAI(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  tools: any[] | null,
  maxTokens: number,
): Promise<Chapter[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  const useMaxCompletionTokens = model.startsWith("openai/") || model.includes("gpt-");
  const body: any = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
  };
  if (useMaxCompletionTokens) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
  }

  if (tools) {
    body.tools = tools;
    body.tool_choice = { type: "function", function: { name: "extract_chapters" } };
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timer);

  console.log(`AI [${model}] status=${resp.status}`);

  if (resp.status === 429 || resp.status === 402) {
    console.error(`AI [${model}] returned ${resp.status}, skipping to fallback`);
    return [];
  }
  if (!resp.ok) {
    const t = await resp.text();
    console.error("AI error:", resp.status, t.substring(0, 300));
    return [];
  }

  const data = await resp.json();
  const finishReason = data.choices?.[0]?.finish_reason;
  console.log(`AI finish_reason=${finishReason}`);

  // Try tool_call first
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall) {
    try {
      const args = repairAndParseJson(toolCall.function.arguments);
      const chs = args.chapters || [];
      console.log(`Extracted ${chs.length} chapters via tool_call`);
      return chs;
    } catch (e: any) {
      console.error("Tool call JSON parse error:", e.message);
    }
  }

  // Try content
  const content = data.choices?.[0]?.message?.content || "";
  if (content) {
    console.log(`Content length=${content.length}`);
    try {
      const parsed = repairAndParseJson(content);
      const chs = parsed.chapters || (Array.isArray(parsed) ? parsed : []);
      if (chs.length) {
        console.log(`Extracted ${chs.length} chapters from content`);
        return chs;
      }
    } catch (e: any) {
      console.error("Content JSON parse error:", e.message);
    }
  }

  return [];
}

// ─── Main handler ────────────────────────────────────────────────

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

    let chapters: Chapter[] = [];

    // ── Step 1: Try pre-processing (regex-based TOC extraction) ──
    const preParsed = extractTocFromText(fullText);
    if (preParsed.length >= 3) {
      console.log(`Pre-processing found ${preParsed.length} TOC entries`);
      chapters = preParsed;
    }

    // ── Step 2: AI extraction (always run to get complete/custom chapters) ──
    const forAI = selectTextForAI(fullText, 120000);

    const systemPrompt = `你是专业的文档结构分析师。请分析以下文档内容，提取完整的章节目录结构（包括所有层级）。

【重要】你必须识别所有类型的章节格式，不仅限于标准的Word标题样式，还包括但不限于：

标准编号格式：
- 数字编号：1、1.1、1.1.1、2.3.4 等
- 第X章/第X节：第一章、第二章、第1章、第一节 等

自定义/特殊格式：
- 中文数字序号：一、二、三、（一）、（二）、（三）等
- 带括号编号：(1)、(2)、（1）、（2）等
- 罗马数字：I、II、III、IV 等
- 字母编号：A、B、C 或 a、b、c 等
- 混合格式：如"第一部分"、"附录A"、"附件1"、"表格清单" 等
- 无编号但明显是章节标题的（如独占一行的短文本，像"评分索引表"、"目录"等）

层级判断规则：
- "第X章"、"第X部分"、纯数字如"1"、中文大写如"一、"→ level 1
- "第X节"、"1.1"、"（一）"→ level 2
- "1.1.1"、"（1）"、"1)"→ level 3
- 更深层级以此类推

要求：
1. 按照文档中实际出现的顺序列出所有章节
2. section_number 使用文档中的原始编号（如"第一章"、"（一）"、"1.1"等）
3. title 为章节标题文字（不含编号）
4. 不要遗漏任何章节，宁可多识别也不要少识别
5. 如果文档中有"目录"页，以目录中列出的条目为准，并补充目录中未列出但正文中存在的章节
6. 注意区分正文中的编号列表和章节标题——章节标题通常独占一行且后续有大段内容`;

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
                    section_number: { type: "string", description: "章节编号" },
                    title: { type: "string", description: "章节标题（不含编号）" },
                    level: { type: "integer", description: "标题层级，1为一级标题" },
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

    let lovableAIWorked = false;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (lovableKey) {
      // Attempt 1: tool_choice with gemini-2.5-pro (best for complex docs)
      let aiChapters = await callAI(
        lovableKey,
        "https://ai.gateway.lovable.dev/v1",
        "google/gemini-2.5-pro",
        systemPrompt,
        forAI,
        tools,
        32768,
      );

      // Attempt 2: without tool_choice (fallback)
      if (!aiChapters.length) {
        console.log("Retrying without tool_choice...");
        const fallbackPrompt = systemPrompt + `\n\n请以JSON格式返回结果，格式为：{"chapters": [{"section_number": "编号", "title": "标题", "level": 层级数字}]}`;
        aiChapters = await callAI(
          lovableKey,
          "https://ai.gateway.lovable.dev/v1",
          "google/gemini-2.5-flash",
          fallbackPrompt,
          forAI,
          null,
          32768,
        );
      }

      // Use AI result if it found more chapters than pre-processing
      if (aiChapters.length > chapters.length) {
        console.log(`AI found ${aiChapters.length} chapters (pre-processing: ${chapters.length}), using AI result`);
        chapters = aiChapters;
        lovableAIWorked = true;
      }
    }

    // ── Step 3: Fallback to custom model_config (when Lovable AI failed or no results) ──
    if (!lovableAIWorked) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data: mc } = await supabase
        .from("model_config")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();

      if (mc?.api_key && mc?.base_url) {
        const mcChapters = await callAI(
          mc.api_key,
          mc.base_url,
          mc.model_name,
          systemPrompt,
          forAI,
          tools,
          Math.max(mc.max_tokens || 8192, 16384),
        );
        if (mcChapters.length > chapters.length) {
          chapters = mcChapters;
        }
      }
    }

    if (!chapters.length) {
      throw new Error("AI未能识别文档章节结构，请确认文档包含清晰的章节标题");
    }

    console.log("Final chapters count:", chapters.length);
    chapters.slice(0, 10).forEach((ch, i) => {
      console.log(`  ch[${i}]: "${ch.section_number}" "${ch.title}" level=${ch.level}`);
    });

    const result = splitTextByChapters(fullText, chapters);

    console.log("Mapped result count:", result.length);

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
