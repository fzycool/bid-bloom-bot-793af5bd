import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { unzipSync } from "npm:fflate@0.8.2";
import * as XLSX from "npm:xlsx@0.18.5";

function extractTextFromDocx(arrayBuffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(arrayBuffer);
  const unzipped = unzipSync(uint8);
  const docXml = unzipped["word/document.xml"];
  if (!docXml) return "";
  const xmlStr = new TextDecoder().decode(docXml);
  const text = xmlStr.replace(/<w:p[^>]*>/g, "\n").replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1").replace(/<[^>]+>/g, "");
  return text.trim();
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

function repairAndParseJson(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (_) { /* fall through to repair */ }

  let cleaned = jsonString
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonStart = cleaned.search(/[\{\[]/);
  if (jsonStart === -1) throw new Error("No JSON found in response");
  const opener = cleaned[jsonStart];
  const closer = opener === '[' ? ']' : '}';
  const jsonEnd = cleaned.lastIndexOf(closer);
  if (jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  } else {
    cleaned = cleaned.substring(jsonStart);
  }

  // Remove trailing commas and control chars
  cleaned = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, " ");

  // Fix unterminated strings: remove the last incomplete key-value if truncated
  // by finding the last complete property
  try { return JSON.parse(cleaned); } catch (_) { /* continue */ }

  // Close any open strings, objects, arrays
  let inString = false;
  let escape = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') inString = !inString;
  }
  if (inString) cleaned += '"';

  // Remove trailing incomplete property (after last comma)
  cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");

  // Balance braces/brackets
  let braces = 0, brackets = 0;
  for (const c of cleaned) {
    if (c === '{') braces++;
    if (c === '}') braces--;
    if (c === '[') brackets++;
    if (c === ']') brackets--;
  }
  if (brackets > 0) cleaned += ']'.repeat(brackets);
  if (braces > 0) cleaned += '}'.repeat(braces);

  // Final cleanup
  cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON repair failed:", e);
    throw new Error("AI返回的数据格式异常，请重试");
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANALYSIS_TOOLS = [{
  type: "function" as const,
  function: {
    name: "analyze_bid_document",
    description: "结构化提取招标文件的评分表、废标项、陷阱项和关键词",
    parameters: {
      type: "object",
      properties: {
        scoring_table: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              item: { type: "string" },
              weight: { type: "string" },
              criteria: { type: "string" },
              evidence_required: { type: "string" },
            },
            required: ["category", "item", "weight", "criteria"],
            additionalProperties: false,
          },
        },
        disqualification_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              source_text: { type: "string" },
              severity: { type: "string", enum: ["critical", "high", "medium"] },
            },
            required: ["item", "source_text", "severity"],
            additionalProperties: false,
          },
        },
        trap_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              risk_level: { type: "string", enum: ["high", "medium", "low"] },
              description: { type: "string" },
              suggestion: { type: "string" },
            },
            required: ["item", "risk_level", "description", "suggestion"],
            additionalProperties: false,
          },
        },
        conflict_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string", description: "冲突或逻辑错误的简要描述" },
              detail: { type: "string", description: "详细说明冲突内容，引用原文" },
              location: { type: "string", description: "出现位置（章节/页码）" },
              severity: { type: "string", enum: ["critical", "high", "medium"], description: "严重程度" },
            },
            required: ["item", "detail", "severity"],
            additionalProperties: false,
          },
        },
        technical_keywords: { type: "array", items: { type: "string" } },
        business_keywords: { type: "array", items: { type: "string" } },
        responsibility_keywords: { type: "array", items: { type: "string" } },
        personnel_requirements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              count: { type: "integer" },
              qualifications: { type: "string" },
              certifications: { type: "array", items: { type: "string" } },
              experience_years: { type: "integer" },
              specific_requirements: { type: "string" },
            },
            required: ["role"],
            additionalProperties: false,
          },
        },
        summary: { type: "string" },
        risk_score: { type: "integer" },
        bid_deadline: { type: "string", description: "投标截止时间，格式为ISO 8601（如2026-03-15T10:00:00+08:00），如果文档中未明确则返回null" },
        bid_location: { type: "string", description: "投标/开标地点，如果文档中未明确则返回null" },
        requires_presentation: { type: "boolean", description: "是否需要讲标/演示，如果文档中未明确则返回null" },
        deposit_amount: { type: "string", description: "投标保证金金额，如'50万元'、'100,000元'等，如果文档中未明确则返回null" },
      },
      required: ["scoring_table", "disqualification_items", "trap_items", "conflict_items", "technical_keywords", "business_keywords", "responsibility_keywords", "personnel_requirements", "summary", "risk_score"],
      additionalProperties: false,
    },
  },
}];

const SYSTEM_PROMPT = `你是一位资深招投标专家，拥有20年标书审查经验。你的任务是像最严格的标书专员一样"读题"并画出所有重点。

请仔细分析以下招标文件内容，提取以下信息：

1. **评分标准表 (scoring_table)**：识别所有评分项目，包括分类、权重/分值、评分细则、需要的佐证材料。
2. **废标项 (disqualification_items)**：找出所有可能导致废标的条款。特别关注带有"★"、"否决投标"、"如不满足则废标"、"强制要求"等标记的内容。severity分为: critical(必废标), high(极高风险), medium(较高风险)。
3. **陷阱项 (trap_items)**：识别逻辑上容易忽略但容易失分的条款。例如："需同时提供XX和YY，缺一不可"、"非本单位人员证明无效"、隐含的时间限制、格式要求等。risk_level: high/medium/low
4. **逻辑冲突项 (conflict_items)**：检查招标文件中明显有逻辑错误或者冲突的内容。例如：前后矛盾的条款、不同章节要求不一致、评分标准与资格要求冲突、时间节点矛盾等。severity: critical/high/medium
5. **专业技能关键词 (technical_keywords)**：从人员要求中提取技术技能词汇。
6. **业务技能关键词 (business_keywords)**：提取业务领域技能。
7. **工作职责关键词 (responsibility_keywords)**：提取职责描述关键词。
8. **人员配置要求 (personnel_requirements)**：每个角色的具体要求。
9. **总体分析摘要 (summary)**：200字以内的项目概况和投标建议。
10. **风险评分 (risk_score)**：0-100分，分数越高风险越大。
11. **投标截止时间 (bid_deadline)**：提取投标截止日期和时间，返回ISO 8601格式。如果文档中没有明确说明，返回null。
12. **投标/开标地点 (bid_location)**：提取投标或开标地点。如果文档中没有明确说明，返回null。
13. **是否讲标 (requires_presentation)**：判断是否要求讲标/现场演示/答辩。返回true/false，未明确则返回null。
14. **投标保证金 (deposit_amount)**：提取投标保证金金额。如果文档中没有明确说明，返回null。

你必须使用提供的工具返回结构化结果。不要遗漏任何关键信息。`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { analysisId, content, projectName, filePath, fileType, customPrompt, documentStructure } = await req.json();

    // Build system prompt with custom instructions and structure context
    let systemPrompt = SYSTEM_PROMPT;
    if (documentStructure) {
      systemPrompt += `\n\n【文档整体结构（已预先分析）】\n请参照以下文档结构，逐章节详细解析每一部分的具体内容：\n${JSON.stringify(documentStructure, null, 2)}`;
    }
    if (customPrompt) {
      systemPrompt += `\n\n【用户自定义解析重点】\n请特别关注以下内容：\n${customPrompt}`;
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: modelConfig } = await supabase.from("model_config").select("*").eq("is_active", true).maybeSingle();
    const aiUrl = modelConfig?.base_url || "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiModel = modelConfig?.model_name || "openai/gpt-5.2";
    const aiKey = modelConfig?.api_key || LOVABLE_API_KEY;
    const isLovable = !modelConfig || modelConfig.provider === "lovable";

    function sanitizeTools(tools: any[]) {
      if (isLovable) return tools;
      return JSON.parse(JSON.stringify(tools), (key, value) => {
        if (key === "additionalProperties" || key === "nullable") return undefined;
        return value;
      });
    }

    await supabase.from("bid_analyses").update({ ai_status: "processing" }).eq("id", analysisId);

    // Build messages based on input type
    const messages: any[] = [{ role: "system", content: systemPrompt }];

    if (filePath) {
      // Download file from storage
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
        const MAX_CHARS = 120000;
        if (textContent.length > MAX_CHARS) {
          textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
        }
        messages.push({
          role: "user",
          content: `项目名称: ${projectName || "未知"}\n\n以下是从Excel招标文件中提取的内容，请仔细分析并提取所有关键信息：\n\n${textContent}`,
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
              { type: "text", text: `项目名称: ${projectName || "未知"}\n\n请仔细分析上传的招标文件，提取所有关键信息。` },
            ],
          });
        } else {
          // Third-party providers: extract text from PDF
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
            textContent = "[PDF文件无法直接提取文本内容]";
            console.warn("PDF text extraction yielded insufficient text");
          }
          const MAX_CHARS = 120000;
          if (textContent.length > MAX_CHARS) {
            textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
          }
          messages.push({
            role: "user",
            content: `项目名称: ${projectName || "未知"}\n\n以下是从招标文件中提取的内容，请仔细分析并提取所有关键信息：\n\n${textContent}`,
          });
        }
      } else {
        // DOCX/DOC: extract text content
        let textContent = extractTextFromDocx(arrayBuffer);
        if (!textContent) {
          await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
          throw new Error("无法从文档中提取文本内容，请尝试转换为PDF后重新上传");
        }
        // Truncate to avoid timeout
        const MAX_CHARS = 120000;
        if (textContent.length > MAX_CHARS) {
          console.log(`Text truncated from ${textContent.length} to ${MAX_CHARS} chars for detailed analysis`);
          textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... 文档内容过长，已截断 ...]";
        }
        messages.push({
          role: "user",
          content: `项目名称: ${projectName || "未知"}\n\n以下是从招标文件中提取的内容，请仔细分析并提取所有关键信息：\n\n${textContent}`,
        });
      }
    } else {
      // Text content mode
      messages.push({
        role: "user",
        content: `项目名称: ${projectName || "未知"}\n\n招标文件内容:\n${content}`,
      });
    }

    const requestBody: any = {
      model: aiModel,
      messages,
      tools: sanitizeTools(ANALYSIS_TOOLS),
    };
    if (isLovable) {
      requestBody.tool_choice = { type: "function", function: { name: "analyze_bid_document" } };
    } else {
      requestBody.tool_choice = "auto";
    }

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const status = response.status;
      const body = await response.text();
      console.error("AI error:", status, body);
      await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
      if (status === 429) {
        return new Response(JSON.stringify({ error: "AI服务请求过于频繁，请稍后重试" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI服务额度不足" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const result = repairAndParseJson(toolCall.function.arguments);

      const updateData: any = {
        scoring_table: result.scoring_table || [],
        disqualification_items: result.disqualification_items || [],
        trap_items: result.trap_items || [],
        conflict_items: result.conflict_items || [],
        technical_keywords: result.technical_keywords || [],
        business_keywords: result.business_keywords || [],
        responsibility_keywords: result.responsibility_keywords || [],
        personnel_requirements: result.personnel_requirements || [],
        summary: result.summary || "",
        risk_score: result.risk_score ?? 50,
        ai_status: "completed",
      };
      if (result.bid_deadline) updateData.bid_deadline = result.bid_deadline;
      if (result.bid_location) updateData.bid_location = result.bid_location;
      if (result.requires_presentation !== undefined && result.requires_presentation !== null) updateData.requires_presentation = result.requires_presentation;
      if (result.deposit_amount) updateData.deposit_amount = result.deposit_amount;

      await supabase.from("bid_analyses").update(updateData).eq("id", analysisId);

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
    return new Response(JSON.stringify({ error: "AI未返回有效结果" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-bid error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
