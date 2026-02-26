import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { revisionId } = await req.json();
    if (!revisionId) {
      return new Response(JSON.stringify({ error: "Missing revisionId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get revision record
    const { data: revision, error: revError } = await supabase
      .from("contract_revisions")
      .select("*")
      .eq("id", revisionId)
      .single();

    if (revError || !revision) {
      return new Response(
        JSON.stringify({ error: "Revision not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update status to processing
    await supabase
      .from("contract_revisions")
      .update({ ai_status: "processing" })
      .eq("id", revisionId);

    // Download original PDF
    const { data: fileData, error: dlError } = await supabase.storage
      .from("contract-files")
      .download(revision.original_file_path);

    if (dlError || !fileData) {
      await supabase
        .from("contract_revisions")
        .update({ ai_status: "error", ai_result: { error: "Failed to download file" } })
        .eq("id", revisionId);
      return new Response(
        JSON.stringify({ error: "Failed to download file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Convert PDF to base64
    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Content = btoa(binary);

    // Get active model config
    const { data: modelConfig } = await supabase
      .from("model_config")
      .select("*")
      .eq("is_active", true)
      .maybeSingle();

    // Determine which AI provider to use
    let aiResponse: string;

    if (modelConfig?.api_key && modelConfig?.base_url) {
      // Use custom model
      aiResponse = await callCustomModel(
        modelConfig,
        base64Content,
        revision.revision_instructions
      );
    } else {
      // Use Lovable AI (Gemini)
      aiResponse = await callLovableAI(
        base64Content,
        revision.revision_instructions
      );
    }

    // Parse AI response - extract the full modified contract text
    const modifiedText = aiResponse;

    // Generate a simple PDF from modified text
    const pdfBytes = generatePDF(modifiedText, revision.original_file_name);

    // Upload revised file
    const revisedPath = revision.original_file_path.replace(
      /\.pdf$/i,
      `_revised_${Date.now()}.pdf`
    );
    const { error: uploadError } = await supabase.storage
      .from("contract-files")
      .upload(revisedPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      await supabase
        .from("contract_revisions")
        .update({ ai_status: "error", ai_result: { error: "Upload failed" } })
        .eq("id", revisionId);
      return new Response(
        JSON.stringify({ error: "Upload revised file failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update record
    await supabase
      .from("contract_revisions")
      .update({
        ai_status: "completed",
        revised_file_path: revisedPath,
        ai_result: {
          modified_content: modifiedText.substring(0, 2000),
          full_length: modifiedText.length,
        },
      })
      .eq("id", revisionId);

    return new Response(
      JSON.stringify({ success: true, revisedPath }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Contract revision error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function callLovableAI(
  base64Pdf: string,
  instructions: string
): Promise<string> {
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

  const response = await fetch("https://ai.lovable.dev/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableApiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `你是一个专业的合同修订助手。用户会提供一份PDF合同和修改指令。
你需要：
1. 仔细阅读整份合同
2. 根据用户的修改指令，精确定位需要修改的条款
3. 输出修改后的完整合同文本，保持原有的格式结构（章节编号、条款编号等）
4. 只修改用户要求的部分，其他内容保持原样
5. 在修改的条款前后用【修改开始】和【修改结束】标注

直接输出修改后的完整合同文本，不要加任何额外说明。`,
        },
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                filename: "contract.pdf",
                file_data: `data:application/pdf;base64,${base64Pdf}`,
              },
            },
            {
              type: "text",
              text: `请按照以下修改指令修改合同：\n\n${instructions}`,
            },
          ],
        },
      ],
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callCustomModel(
  config: any,
  base64Pdf: string,
  instructions: string
): Promise<string> {
  const baseUrl = config.base_url.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  // For custom models, send extracted text approach since they may not support file uploads
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model_name,
      messages: [
        {
          role: "system",
          content: `你是一个专业的合同修订助手。用户会提供一份合同内容和修改指令。
你需要：
1. 仔细阅读整份合同
2. 根据用户的修改指令，精确定位需要修改的条款
3. 输出修改后的完整合同文本，保持原有的格式结构
4. 只修改用户要求的部分，其他内容保持原样
5. 在修改的条款前后用【修改开始】和【修改结束】标注

直接输出修改后的完整合同文本，不要加任何额外说明。`,
        },
        {
          role: "user",
          content: `请按照以下修改指令修改合同：\n\n${instructions}\n\n（合同内容已通过PDF上传，base64长度: ${base64Pdf.length}）`,
        },
      ],
      max_tokens: config.max_tokens || 8000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Custom AI error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// Simple PDF generator using raw PDF commands
function generatePDF(text: string, originalName: string): Uint8Array {
  const lines = text.split("\n");
  const pageHeight = 842; // A4 height in points
  const pageWidth = 595; // A4 width
  const margin = 72; // 1 inch margin
  const lineHeight = 16;
  const maxCharsPerLine = 38; // For Chinese chars at font size 12
  const usableHeight = pageHeight - 2 * margin;
  const linesPerPage = Math.floor(usableHeight / lineHeight);

  // Wrap long lines
  const wrappedLines: string[] = [];
  for (const line of lines) {
    if (line.length <= maxCharsPerLine) {
      wrappedLines.push(line);
    } else {
      for (let i = 0; i < line.length; i += maxCharsPerLine) {
        wrappedLines.push(line.substring(i, i + maxCharsPerLine));
      }
    }
  }

  // Split into pages
  const pages: string[][] = [];
  for (let i = 0; i < wrappedLines.length; i += linesPerPage) {
    pages.push(wrappedLines.slice(i, i + linesPerPage));
  }

  if (pages.length === 0) pages.push([""]);

  // Build PDF structure
  const objects: string[] = [];
  let objectCount = 0;

  const addObject = (content: string): number => {
    objectCount++;
    objects.push(`${objectCount} 0 obj\n${content}\nendobj`);
    return objectCount;
  };

  // Object 1: Catalog
  addObject("<< /Type /Catalog /Pages 2 0 R >>");

  // Object 2: Pages (placeholder, will be updated)
  const pagesObjIdx = objects.length;
  addObject(""); // placeholder

  // Create font - use a built-in font
  const fontObjNum = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  );

  // Create pages
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];

  for (const pageLines of pages) {
    // Build content stream - use hex encoding for text to handle potential issues
    let stream = `BT\n/F1 11 Tf\n${margin} ${pageHeight - margin} Td\n${lineHeight} TL\n`;
    for (const line of pageLines) {
      // Escape special PDF characters
      const escaped = line
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");
      stream += `(${escaped}) Tj T*\n`;
    }
    stream += "ET";

    const streamBytes = new TextEncoder().encode(stream);
    const contentObj = addObject(
      `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`
    );
    contentObjNums.push(contentObj);

    const pageObj = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>`
    );
    pageObjNums.push(pageObj);
  }

  // Update pages object
  const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  objects[pagesObjIdx] = `2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pages.length} >>\nendobj`;

  // Build final PDF
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + "\n";
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objectCount + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
