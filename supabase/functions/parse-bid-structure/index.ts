import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STRUCTURE_TOOLS = [{
  type: "function" as const,
  function: {
    name: "extract_document_structure",
    description: "提取招标文件的整体结构（章节目录树）",
    parameters: {
      type: "object",
      properties: {
        document_title: { type: "string", description: "文档标题/项目名称" },
        total_pages: { type: "integer", description: "文档总页数（估计）" },
        sections: {
          type: "array",
          description: "文档章节结构树",
          items: {
            type: "object",
            properties: {
              number: { type: "string", description: "章节编号" },
              title: { type: "string", description: "章节标题" },
              page_hint: { type: "string", description: "大致页码" },
              importance: { type: "string", enum: ["critical", "high", "medium", "low"] },
              importance_reason: { type: "string" },
              children: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    number: { type: "string" },
                    title: { type: "string" },
                    page_hint: { type: "string" },
                    importance: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    importance_reason: { type: "string" },
                  },
                  required: ["title"],
                },
              },
            },
            required: ["title", "importance"],
          },
        },
        summary: { type: "string", description: "文档整体概述（100字以内）" },
      },
      required: ["document_title", "sections", "summary"],
    },
  },
}];

function repairAndParseJson(raw: string): any {
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  const start = s.indexOf("{");
  if (start === -1) throw new Error("No JSON object found");
  s = s.substring(start);
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
  s = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') inStr = !inStr;
  }
  if (inStr) s += '"';
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
  s = s.replace(/,\s*\{[^}]*$/, "");
  s = s.replace(/,\s*$/, "");
  let braces = 0, brackets = 0;
  inStr = false; esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') braces++; else if (c === '}') braces--;
    if (c === '[') brackets++; else if (c === ']') brackets--;
  }
  if (brackets > 0) s += ']'.repeat(brackets);
  if (braces > 0) s += '}'.repeat(braces);
  s = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i] === '}' || s[i] === ']') {
      let attempt = s.substring(0, i + 1);
      attempt = attempt.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      let b = 0, k = 0, is2 = false, e2 = false;
      for (const ch of attempt) {
        if (e2) { e2 = false; continue; }
        if (ch === '\\' && is2) { e2 = true; continue; }
        if (ch === '"') { is2 = !is2; continue; }
        if (is2) continue;
        if (ch === '{') b++; if (ch === '}') b--;
        if (ch === '[') k++; if (ch === ']') k--;
      }
      if (k > 0) attempt += ']'.repeat(k);
      if (b > 0) attempt += '}'.repeat(b);
      attempt = attempt.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      try { return JSON.parse(attempt); } catch (_) { continue; }
    }
  }
  throw new Error("AI返回的数据格式异常，请重试");
}

/** Lightweight DOCX text extraction using built-in DecompressionStream */
async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const uint8 = new Uint8Array(arrayBuffer);
  if (uint8.length < 4 || uint8[0] !== 0x50 || uint8[1] !== 0x4B) {
    throw new Error("NOT_DOCX");
  }
  let offset = 0;
  while (offset < uint8.length - 4) {
    if (uint8[offset] !== 0x50 || uint8[offset + 1] !== 0x4B || uint8[offset + 2] !== 0x03 || uint8[offset + 3] !== 0x04) break;
    const compressionMethod = uint8[offset + 8] | (uint8[offset + 9] << 8);
    const compressedSize = uint8[offset + 18] | (uint8[offset + 19] << 8) | (uint8[offset + 20] << 16) | (uint8[offset + 21] << 24);
    const nameLen = uint8[offset + 26] | (uint8[offset + 27] << 8);
    const extraLen = uint8[offset + 28] | (uint8[offset + 29] << 8);
    const name = new TextDecoder().decode(uint8.slice(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    if (name === "word/document.xml") {
      const compressedData = uint8.slice(dataStart, dataStart + compressedSize);
      let xmlBytes: Uint8Array;
      if (compressionMethod === 0) {
        xmlBytes = compressedData;
      } else {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(compressedData);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLen = chunks.reduce((a, c) => a + c.length, 0);
        xmlBytes = new Uint8Array(totalLen);
        let pos = 0;
        for (const c of chunks) { xmlBytes.set(c, pos); pos += c.length; }
      }
      const xmlStr = new TextDecoder().decode(xmlBytes);
      return xmlStr
        .replace(/<w:p[^>]*>/g, "\n")
        .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
        .replace(/<[^>]+>/g, "")
        .trim();
    }
    offset = dataStart + compressedSize;
  }
  return "";
}

/** Convert Uint8Array to base64 in chunks to avoid stack overflow */
function uint8ToBase64(uint8: Uint8Array): string {
  const CHUNK = 8192;
  let result = "";
  for (let i = 0; i < uint8.length; i += CHUNK) {
    const slice = uint8.subarray(i, Math.min(i + CHUNK, uint8.length));
    result += String.fromCharCode(...slice);
  }
  return btoa(result);
}

const SYSTEM_PROMPT = `你是一位资深招投标专家。请分析以下招标文件，提取其整体结构（章节目录树）。

要求：
1. 识别文档的所有主要章节和子章节，构建完整的目录结构
2. 为每个章节标注对投标方的重要程度（critical/high/medium/low）
3. 简要说明每个章节为什么重要
4. 给出文档整体概述

你必须使用提供的工具返回结构化结果。`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { analysisId, filePath, fileType, content, projectName } = await req.json();
    if (!analysisId) throw new Error("analysisId is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: modelConfig } = await supabase.from("model_config").select("*").eq("is_active", true).maybeSingle();
    const aiUrl = modelConfig?.base_url || "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiModel = modelConfig?.model_name || "google/gemini-2.5-flash";
    const aiKey = modelConfig?.api_key || LOVABLE_API_KEY;
    const isLovable = !modelConfig || modelConfig.provider === "lovable";
    const configMaxTokens = modelConfig?.max_tokens || (isLovable ? 32000 : 8192);

    function sanitizeTools(tools: any[]) {
      if (isLovable) return tools;
      return JSON.parse(JSON.stringify(tools), (key, value) => {
        if (key === "additionalProperties" || key === "nullable") return undefined;
        return value;
      });
    }

    // Update status and start background processing
    await supabase.from("bid_analyses").update({ ai_status: "analyzing_structure", ai_progress: "正在准备文档..." } as any).eq("id", analysisId);

    // Background processing function
    const processInBackground = async () => {
      try {
        const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];

        if (filePath) {
          const { data: fileData, error: dlError } = await supabase.storage
            .from("knowledge-base")
            .download(filePath);
          if (dlError || !fileData) {
            await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: `文件下载失败: ${dlError?.message || "unknown"}` } as any).eq("id", analysisId);
            return;
          }

          const arrayBuffer = await fileData.arrayBuffer();
          const fileSize = arrayBuffer.byteLength;
          const isPdf = filePath.endsWith(".pdf") || fileType?.includes("pdf");
          const isExcel = filePath.endsWith(".xlsx") || filePath.endsWith(".xls") || fileType?.includes("spreadsheet") || fileType?.includes("excel");
          const isDocx = filePath.endsWith(".docx") || fileType?.includes("wordprocessingml");

          // Reject files over 10MB to prevent memory issues
          if (fileSize > 10 * 1024 * 1024) {
            await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: "文件过大（超过10MB），请尝试压缩或拆分文件后重新上传" } as any).eq("id", analysisId);
            return;
          }

          if (isLovable && (isPdf || isExcel)) {
            const uint8Array = new Uint8Array(arrayBuffer);
            const b64 = uint8ToBase64(uint8Array);
            const fileName = filePath.split("/").pop() || "document";
            const mimeType = isPdf ? "application/pdf" :
              filePath.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :
              "application/vnd.ms-excel";
            messages.push({
              role: "user",
              content: [
                { type: "file", file: { filename: fileName, file_data: `data:${mimeType};base64,${b64}` } },
                { type: "text", text: `项目名称: ${projectName || "未知"}\n\n请分析上传的招标文件的整体结构，提取完整的章节目录树。` },
              ],
            });
          } else if (isDocx) {
            let textContent = "";
            try {
              textContent = await extractTextFromDocx(arrayBuffer);
            } catch (e: any) {
              if (e?.message === "NOT_DOCX") {
                await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: "该文件不是有效的Word格式" } as any).eq("id", analysisId);
                return;
              }
              throw e;
            }
            if (!textContent) {
              await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: "无法从文档中提取文本内容，请尝试转换为PDF后重新上传" } as any).eq("id", analysisId);
              return;
            }
            const MAX_CHARS = 60000;
            if (textContent.length > MAX_CHARS) {
              textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
            }
            messages.push({
              role: "user",
              content: `项目名称: ${projectName || "未知"}\n\n请分析以下招标文件的整体结构：\n\n${textContent}`,
            });
          } else if (isPdf && !isLovable) {
            const uint8Array = new Uint8Array(arrayBuffer);
            let textContent = "";
            try {
              const decoder = new TextDecoder("utf-8", { fatal: false });
              const raw = decoder.decode(uint8Array);
              const textParts: string[] = [];
              const regex = /\(([^)]{1,500})\)/g;
              let m;
              while ((m = regex.exec(raw)) !== null) {
                const t = m[1].replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\\\/g, "\\").replace(/\\([()])/g, "$1");
                if (t.trim().length > 1) textParts.push(t.trim());
              }
              textContent = textParts.join("\n");
            } catch (_) { /* ignore */ }
            if (!textContent || textContent.length < 200) {
              textContent = "[PDF文件无法直接提取文本。请根据文件名和项目名称进行结构分析。]";
            }
            const MAX_CHARS = 60000;
            if (textContent.length > MAX_CHARS) {
              textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
            }
            messages.push({
              role: "user",
              content: `项目名称: ${projectName || "未知"}\n\n请分析以下招标文件的整体结构：\n\n${textContent}`,
            });
          } else {
            let textContent = "";
            try { textContent = await extractTextFromDocx(arrayBuffer); } catch (_) { /* ignore */ }
            if (!textContent) {
              await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: "无法从文档中提取文本，请尝试转换为PDF后重新上传" } as any).eq("id", analysisId);
              return;
            }
            const MAX_CHARS = 60000;
            if (textContent.length > MAX_CHARS) {
              textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
            }
            messages.push({
              role: "user",
              content: `项目名称: ${projectName || "未知"}\n\n请分析以下招标文件的整体结构：\n\n${textContent}`,
            });
          }
        } else if (content) {
          const MAX_CHARS = 60000;
          let textContent = content;
          if (textContent.length > MAX_CHARS) {
            textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 内容过长，已截断 ...]";
          }
          messages.push({
            role: "user",
            content: `项目名称: ${projectName || "未知"}\n\n请分析以下招标文件的整体结构：\n\n${textContent}`,
          });
        } else {
          await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: "请提供文件或文本内容" } as any).eq("id", analysisId);
          return;
        }

        await supabase.from("bid_analyses").update({ ai_progress: "正在调用AI模型分析文档结构..." } as any).eq("id", analysisId);

        const tokenLimit = Math.min(configMaxTokens, 8192);
        const requestBody: any = {
          model: aiModel,
          messages,
          tools: sanitizeTools(STRUCTURE_TOOLS),
        };
        // Some models require max_completion_tokens instead of max_tokens
        const useMaxCompletionTokens = aiModel.startsWith("openai/") || aiModel.includes("gpt-");
        if (useMaxCompletionTokens) {
          requestBody.max_completion_tokens = tokenLimit;
        } else {
          requestBody.max_tokens = tokenLimit;
        }
        if (isLovable) {
          requestBody.tool_choice = { type: "function", function: { name: "extract_document_structure" } };
        } else {
          requestBody.tool_choice = "auto";
        }

        const response = await fetch(aiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const status = response.status;
          const errText = await response.text();
          console.error("AI gateway error:", status, errText);
          await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: `AI返回错误 (${status})` } as any).eq("id", analysisId);
          return;
        }

        const data = await response.json();
        const usage = data.usage || null;
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

        if (toolCall?.function?.arguments) {
          const result = repairAndParseJson(toolCall.function.arguments);
          const tokenData = usage ? { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 } : null;
          await supabase.from("bid_analyses").update({
            document_structure: result,
            ai_status: "structure_ready",
            ai_progress: "结构分析完成",
            token_usage: tokenData,
          } as any).eq("id", analysisId);
        } else {
          await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: "AI未返回有效结构数据" } as any).eq("id", analysisId);
        }
      } catch (e) {
        console.error("parse-bid-structure background error:", e);
        await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: `结构分析出错: ${e instanceof Error ? e.message : "未知错误"}` } as any).eq("id", analysisId);
      }
    };

    // Use EdgeRuntime.waitUntil for background processing
    // @ts-ignore - EdgeRuntime is available in Supabase edge functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(processInBackground());
    } else {
      // Fallback: run in background with no await
      processInBackground().catch(console.error);
    }

    // Return immediately
    return new Response(JSON.stringify({ status: "processing", analysisId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-bid-structure error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
