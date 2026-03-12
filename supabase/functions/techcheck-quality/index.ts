import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get active model config
    const { data: modelConfig } = await supabase.from("model_config").select("*").eq("is_active", true).maybeSingle();
    const aiUrl = modelConfig?.base_url || "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiModel = modelConfig?.model_name || "google/gemini-2.5-flash";
    const aiKey = modelConfig?.api_key || LOVABLE_API_KEY;

    const { checkItems, bidFilePaths, proposalFilePaths } = await req.json();

    if (!checkItems || !Array.isArray(checkItems) || checkItems.length === 0) {
      throw new Error("checkItems is required and must be a non-empty array");
    }
    if (!bidFilePaths || bidFilePaths.length === 0) {
      throw new Error("至少需要上传一个招标文件");
    }
    if (!proposalFilePaths || proposalFilePaths.length === 0) {
      throw new Error("至少需要上传一个技术方案");
    }

    // Download files and extract text content
    const downloadFile = async (path: string): Promise<{ text: string; name: string }> => {
      const { data, error } = await supabase.storage.from("company-materials").download(path);
      if (error || !data) throw new Error(`文件下载失败: ${path} - ${error?.message}`);
      const fileName = path.split("/").pop() || "unknown";
      const ext = fileName.split(".").pop()?.toLowerCase();

      if (ext === "pdf") {
        // For PDF, send as base64 in a file content block
        const arrayBuffer = await data.arrayBuffer();
        const b64 = base64Encode(new Uint8Array(arrayBuffer));
        return { text: `[PDF文件: ${fileName}，base64编码已传入]`, name: fileName };
      }
      // For docx/doc, extract as text
      const text = await data.text();
      return { text, name: fileName };
    };

    // Download all files in parallel
    const [bidContents, proposalContents] = await Promise.all([
      Promise.all(bidFilePaths.map(downloadFile)),
      Promise.all(proposalFilePaths.map(downloadFile)),
    ]);

    // Build checklist text
    const checklistText = checkItems.map((item: any, idx: number) => 
      `${idx + 1}. [${item.severity === "critical" ? "关键" : item.severity === "major" ? "重要" : "一般"}] ${item.category} - ${item.title}\n   检查要求：${item.description}`
    ).join("\n\n");

    const bidText = bidContents.map(c => `--- 招标文件: ${c.name} ---\n${c.text}`).join("\n\n");
    const proposalText = proposalContents.map(c => `--- 技术方案: ${c.name} ---\n${c.text}`).join("\n\n");

    const systemPrompt = `你是一位资深投标评审专家，负责按照检查清单对技术方案进行逐项质量检查。

你将收到：
1. 检查清单（包含多个检查项，每项有分类、标题、检查要求和严重程度）
2. 招标文件内容（用于了解招标方的具体要求）
3. 技术方案内容（被检查的对象）

你的任务：
- 逐项检查技术方案是否满足每个检查项的要求
- 结合招标文件的具体要求进行针对性评价
- 给每个检查项打分（0-100分）并给出检查结论

请严格输出纯JSON，不要输出任何其他内容：
{
  "results": [
    {
      "itemIndex": 0,
      "status": "pass|fail|warning",
      "score": 85,
      "finding": "检查发现的具体问题或优点（100字以内）",
      "suggestion": "改进建议（如有问题时给出，50字以内）"
    }
  ],
  "overallScore": 78,
  "summary": "总体质检结论（200字以内）"
}

评分标准：
- 90-100：完全符合要求，内容详实
- 70-89：基本符合，有小改进空间
- 50-69：部分符合，存在明显不足
- 0-49：严重不符合或缺失

status判定规则：
- score >= 80 → "pass"
- 50 <= score < 80 → "warning"  
- score < 50 → "fail"`;

    const userContent = `【检查清单】\n${checklistText}\n\n【招标文件】\n${bidText}\n\n【技术方案（被检查对象）】\n${proposalText}`;

    // Build messages - handle PDF files specially
    const messages: any[] = [{ role: "system", content: systemPrompt }];
    
    // Check if any bid files are PDFs
    const pdfBidFiles = bidFilePaths.filter((p: string) => p.toLowerCase().endsWith(".pdf"));
    
    if (pdfBidFiles.length > 0) {
      // For PDFs, use file content blocks
      const contentParts: any[] = [];
      
      for (const pdfPath of pdfBidFiles) {
        const { data, error } = await supabase.storage.from("company-materials").download(pdfPath);
        if (!error && data) {
          const arrayBuffer = await data.arrayBuffer();
          const b64 = base64Encode(new Uint8Array(arrayBuffer));
          contentParts.push({
            type: "file",
            file: {
              filename: pdfPath.split("/").pop() || "bid-document.pdf",
              file_data: `data:application/pdf;base64,${b64}`,
            },
          });
        }
      }
      
      // Add non-PDF bid content + proposal content + checklist as text
      const nonPdfBidText = bidContents
        .filter((_, i) => !bidFilePaths[i].toLowerCase().endsWith(".pdf"))
        .map(c => `--- 招标文件: ${c.name} ---\n${c.text}`)
        .join("\n\n");
      
      contentParts.push({
        type: "text",
        text: `以上是招标文件PDF。\n\n${nonPdfBidText ? `【其他招标文件】\n${nonPdfBidText}\n\n` : ""}【检查清单】\n${checklistText}\n\n【技术方案（被检查对象）】\n${proposalText}`,
      });
      
      messages.push({ role: "user", content: contentParts });
    } else {
      messages.push({ role: "user", content: userContent });
    }

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: aiModel, messages }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return new Response(JSON.stringify({ error: "AI服务请求过于频繁，请稍后重试" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI服务额度不足" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error: ${status}`);
    }

    const data = await response.json();
    let resultText = data.choices?.[0]?.message?.content || "";
    resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result;
    try {
      result = JSON.parse(resultText);
    } catch {
      console.error("Failed to parse AI response:", resultText);
      throw new Error("AI返回格式异常，请重试");
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("techcheck-quality error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
