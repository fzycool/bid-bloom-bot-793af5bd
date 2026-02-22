import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

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
      const uint8Array = new Uint8Array(arrayBuffer);
      const b64 = base64Encode(uint8Array);
      const fileName = filePath.split("/").pop() || "document";
      const isPdf = filePath.endsWith(".pdf") || fileType?.includes("pdf");
      const mimeType = isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      messages.push({
        role: "user",
        content: [
          { type: "file", file: { filename: fileName, file_data: `data:${mimeType};base64,${b64}` } },
          { type: "text", text: `项目名称: ${projectName || "未知"}\n\n请分析上传的招标文件的整体结构，提取完整的章节目录树。` },
        ],
      });
    } else if (content) {
      messages.push({
        role: "user",
        content: `项目名称: ${projectName || "未知"}\n\n请分析以下招标文件的整体结构，提取完整的章节目录树：\n\n${content}`,
      });
    } else {
      throw new Error("请提供文件或文本内容");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5.2",
        messages,
        tools: STRUCTURE_TOOLS,
        tool_choice: { type: "function", function: { name: "extract_document_structure" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
      if (status === 429) return new Response(JSON.stringify({ error: "AI服务请求过于频繁，请稍后重试" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI服务额度不足" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error: ${status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);

      await supabase.from("bid_analyses").update({
        document_structure: result,
        ai_status: "structure_ready",
      }).eq("id", analysisId);

      return new Response(JSON.stringify({ success: true, structure: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("bid_analyses").update({ ai_status: "failed" }).eq("id", analysisId);
    return new Response(JSON.stringify({ error: "AI未返回有效结果" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-bid-structure error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
