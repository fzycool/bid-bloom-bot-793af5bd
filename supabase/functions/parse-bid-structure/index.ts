import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { unzipSync } from "npm:fflate@0.8.2";
import * as XLSX from "npm:xlsx@0.18.5";
import { Buffer } from "node:buffer";
import WordExtractor from "npm:word-extractor@1.0.4";

// Polyfill Buffer globally for npm packages that depend on it
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as any).Buffer = Buffer;
}

function extractTextFromDocx(arrayBuffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(arrayBuffer);
  // Verify ZIP magic bytes (DOCX is a ZIP archive)
  if (uint8.length < 4 || uint8[0] !== 0x50 || uint8[1] !== 0x4B) {
    throw new Error("NOT_DOCX");
  }
  const unzipped = unzipSync(uint8);
  const docXml = unzipped["word/document.xml"];
  if (!docXml) return "";
  const xmlStr = new TextDecoder().decode(docXml);
  const text = xmlStr.replace(/<w:p[^>]*>/g, "\n").replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1").replace(/<[^>]+>/g, "");
  return text.trim();
}

async function extractTextFromOldDoc(arrayBuffer: ArrayBuffer): Promise<string> {
  const uint8 = new Uint8Array(arrayBuffer);
  // Check OLE2/CFB magic bytes: D0 CF 11 E0
  if (uint8.length < 8 || uint8[0] !== 0xD0 || uint8[1] !== 0xCF || uint8[2] !== 0x11 || uint8[3] !== 0xE0) {
    throw new Error("NOT_DOC");
  }
  const extractor = new WordExtractor();
  const doc = await extractor.extract(Buffer.from(uint8));
  return doc.getBody()?.trim() || "";
}

function isOldDocFormat(arrayBuffer: ArrayBuffer): boolean {
  const uint8 = new Uint8Array(arrayBuffer);
  return uint8.length >= 8 && uint8[0] === 0xD0 && uint8[1] === 0xCF && uint8[2] === 0x11 && uint8[3] === 0xE0;
}

function extractTextFromExcel(arrayBuffer: ArrayBuffer): string {
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    parts.push(`【Sheet: ${sheetName}】`);
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    parts.push(csv);
    parts.push("");
  }
  return parts.join("\n").trim();
}

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
              number: { type: "string", description: "章节编号，如 '第一章'、'1.1'、'（二）'" },
              title: { type: "string", description: "章节标题" },
              page_hint: { type: "string", description: "大致页码或位置提示" },
              importance: { type: "string", enum: ["critical", "high", "medium", "low"], description: "对投标的重要程度" },
              importance_reason: { type: "string", description: "为什么重要（简要说明）" },
              children: {
                type: "array",
                description: "子章节",
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
                  additionalProperties: false,
                },
              },
            },
            required: ["title", "importance"],
            additionalProperties: false,
          },
        },
        summary: { type: "string", description: "文档整体概述（100字以内）" },
      },
      required: ["document_title", "sections", "summary"],
      additionalProperties: false,
    },
  },
}];

function repairAndParseJson(raw: string): any {
  // Strip markdown fences
  let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Try direct parse first
  try { return JSON.parse(s); } catch (_) { /* continue */ }

  // Find JSON boundaries
  const start = s.indexOf("{");
  if (start === -1) throw new Error("No JSON object found");
  s = s.substring(start);

  // Remove control chars
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
  s = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  try { return JSON.parse(s); } catch (_) { /* continue */ }

  // Check if string is unterminated
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') inStr = !inStr;
  }
  if (inStr) s += '"';

  // Remove trailing incomplete property/array item
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
  s = s.replace(/,\s*\{[^}]*$/, "");
  s = s.replace(/,\s*$/, "");

  // Balance braces and brackets
  let braces = 0, brackets = 0;
  inStr = false; esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
  }

  if (brackets > 0) s += ']'.repeat(brackets);
  if (braces > 0) s += '}'.repeat(braces);
  s = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");

  try { return JSON.parse(s); } catch (_) { /* continue */ }

  // Aggressive: find last valid closing brace/bracket and truncate
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i] === '}' || s[i] === ']') {
      let attempt = s.substring(0, i + 1);
      attempt = attempt.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      let b = 0, k = 0;
      let is2 = false, e2 = false;
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

  console.error("JSON repair failed, raw length:", raw.length);
  throw new Error("AI返回的数据格式异常，请重试");
}

const SYSTEM_PROMPT = `你是一位资深招投标专家。请分析以下招标文件，提取其整体结构（章节目录树）。

要求：
1. 识别文档的所有主要章节和子章节，构建完整的目录结构
2. 为每个章节标注对投标方的重要程度（critical/high/medium/low）：
   - critical: 直接影响废标或重大失分的章节（如评分标准、废标条款、资格要求）
   - high: 投标方案核心内容章节（如技术要求、商务要求、人员配置）
   - medium: 需要关注但非核心的章节（如合同条款、付款方式）
   - low: 一般性信息章节（如项目背景、名词解释）
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

    await supabase.from("bid_analyses").update({ ai_status: "analyzing_structure" }).eq("id", analysisId);

    const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];

    if (filePath) {
      const { data: fileData, error: dlError } = await supabase.storage
        .from("knowledge-base")
        .download(filePath);
      if (dlError || !fileData) {
        await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
        throw new Error(`文件下载失败: ${dlError?.message || "unknown"}`);
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const isPdf = filePath.endsWith(".pdf") || fileType?.includes("pdf");
      const isExcel = filePath.endsWith(".xlsx") || filePath.endsWith(".xls") || fileType?.includes("spreadsheet") || fileType?.includes("excel");

      if (isExcel) {
        let textContent = extractTextFromExcel(arrayBuffer);
        if (!textContent) {
          await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
          throw new Error("无法从Excel文件中提取内容");
        }
        const MAX_CHARS = 80000;
        if (textContent.length > MAX_CHARS) {
          textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
        }
        messages.push({
          role: "user",
          content: `项目名称: ${projectName || "未知"}\n\n请分析以下从Excel招标文件中提取的内容，提取完整的章节目录树：\n\n${textContent}`,
        });
      } else if (isPdf) {
        if (isLovable) {
          const uint8Array = new Uint8Array(arrayBuffer);
          const b64 = base64Encode(uint8Array);
          const fileName = filePath.split("/").pop() || "document.pdf";
          messages.push({
            role: "user",
            content: [
              { type: "file", file: { filename: fileName, file_data: `data:application/pdf;base64,${b64}` } },
              { type: "text", text: `项目名称: ${projectName || "未知"}\n\n请分析上传的招标文件的整体结构，提取完整的章节目录树。` },
            ],
          });
        } else {
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
          const MAX_CHARS = 80000;
          if (textContent.length > MAX_CHARS) {
            textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
          }
          messages.push({
            role: "user",
            content: `项目名称: ${projectName || "未知"}\n\n请分析以下招标文件的整体结构，提取完整的章节目录树：\n\n${textContent}`,
          });
        }
      } else {
        let textContent = "";
        if (isOldDocFormat(arrayBuffer)) {
          try {
            textContent = await extractTextFromOldDoc(arrayBuffer);
          } catch (docErr: any) {
            console.error("Old .doc extraction failed:", docErr);
            await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
            throw new Error("无法从.doc文件中提取内容，请尝试用Word另存为.docx或PDF后重新上传");
          }
        } else {
          try {
            textContent = extractTextFromDocx(arrayBuffer);
          } catch (docxErr: any) {
            if (docxErr?.message === "NOT_DOCX") {
              await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
              throw new Error("该文件不是有效的Word格式，请确认文件格式后重新上传");
            }
            throw docxErr;
          }
        }
        if (!textContent) {
          await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
          throw new Error("无法从文档中提取文本内容，请尝试转换为PDF后重新上传");
        }
        const MAX_CHARS = 80000;
        if (textContent.length > MAX_CHARS) {
          textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
        }
        messages.push({
          role: "user",
          content: `项目名称: ${projectName || "未知"}\n\n请分析以下招标文件的整体结构，提取完整的章节目录树：\n\n${textContent}`,
        });
      }
    } else if (content) {
      messages.push({
        role: "user",
        content: `项目名称: ${projectName || "未知"}\n\n请分析以下招标文件的整体结构，提取完整的章节目录树：\n\n${content}`,
      });
    } else {
      throw new Error("请提供文件或文本内容");
    }

    const requestBody: any = {
      model: aiModel,
      messages,
      tools: sanitizeTools(STRUCTURE_TOOLS),
      max_tokens: Math.min(configMaxTokens, 8192),
    };
    if (isLovable) {
      requestBody.tool_choice = { type: "function", function: { name: "extract_document_structure" } };
    } else {
      requestBody.tool_choice = "auto";
    }

    // Use streaming response to keep HTTP connection alive during AI processing
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          sendEvent({ type: "progress", message: "正在调用AI模型分析文档结构..." });

          // Set up heartbeat to keep connection alive
          const heartbeat = setInterval(() => {
            sendEvent({ type: "heartbeat" });
          }, 15000);

          const response = await fetch(aiUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          clearInterval(heartbeat);

          if (!response.ok) {
            const status = response.status;
            const errText = await response.text();
            console.error("AI gateway error:", status, errText);
            await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: `AI返回错误 (${status})` } as any).eq("id", analysisId);
            sendEvent({ type: "error", message: `AI返回错误 (${status})` });
            controller.close();
            return;
          }

          sendEvent({ type: "progress", message: "AI已返回结果，正在解析结构数据..." });

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
            sendEvent({ type: "complete", status: "structure_ready" });
          } else {
            await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: "AI未返回有效结构数据" } as any).eq("id", analysisId);
            sendEvent({ type: "error", message: "AI未返回有效结构数据" });
          }
        } catch (e) {
          console.error("parse-bid-structure stream error:", e);
          await supabase.from("bid_analyses").update({ ai_status: "failed", ai_progress: `结构分析出错: ${e instanceof Error ? e.message : "未知错误"}` } as any).eq("id", analysisId);
          sendEvent({ type: "error", message: e instanceof Error ? e.message : "未知错误" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
    });
  } catch (e) {
    console.error("parse-bid-structure error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
