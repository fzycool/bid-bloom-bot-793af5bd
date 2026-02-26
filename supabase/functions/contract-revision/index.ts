import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as decodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  let revisionId: string | undefined;

  try {
    const body = await req.json();
    revisionId = body.revisionId;
    const pageImagePaths: string[] = body.pageImagePaths || [];

    if (!revisionId || pageImagePaths.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing revisionId or pageImagePaths" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

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

    await supabase
      .from("contract_revisions")
      .update({ ai_status: "processing" })
      .eq("id", revisionId);

    // Step 1: Create signed URLs for page images to analyze

    // Step 2: Create signed URLs for page images to analyze
    const pageSignedUrls: string[] = [];
    for (const pagePath of pageImagePaths) {
      const { data: pageUrl } = await supabase.storage
        .from("contract-files")
        .createSignedUrl(pagePath, 600);
      if (pageUrl?.signedUrl) pageSignedUrls.push(pageUrl.signedUrl);
    }

    // Step 3: Analyze which pages need editing (using page images)
    const edits = await analyzeEdits(
      lovableApiKey,
      pageSignedUrls,
      revision.revision_instructions,
      pageImagePaths.length
    );

    console.log("Identified edits:", JSON.stringify(edits));

    // Step 3: Edit identified pages
    const finalPagePaths = [...pageImagePaths]; // start with originals
    const editedPageNumbers: number[] = [];

    for (const edit of edits) {
      const pageIdx = edit.page_number - 1; // 0-indexed
      if (pageIdx < 0 || pageIdx >= pageImagePaths.length) continue;

      // Create signed URL for this page image
      const { data: pageUrlData } = await supabase.storage
        .from("contract-files")
        .createSignedUrl(pageImagePaths[pageIdx], 600);

      if (!pageUrlData?.signedUrl) continue;

      try {
        const editedImageBase64 = await editPageImage(
          lovableApiKey,
          pageUrlData.signedUrl,
          edit.edit_instruction
        );

        if (editedImageBase64) {
          // Upload edited image
          const rawBase64 = editedImageBase64.replace(/^data:image\/\w+;base64,/, "");
          const imageBytes = decodeBase64(rawBase64);
          const editedPath = pageImagePaths[pageIdx].replace(/\.png$/i, `_edited.png`);

          const { error: uploadErr } = await supabase.storage
            .from("contract-files")
            .upload(editedPath, imageBytes, {
              contentType: "image/png",
              upsert: true,
            });

          if (!uploadErr) {
            finalPagePaths[pageIdx] = editedPath;
            editedPageNumbers.push(edit.page_number);
          }
        }
      } catch (editErr) {
        console.error(`Failed to edit page ${edit.page_number}:`, editErr);
        // Continue with other pages
      }
    }

    // Update revision record
    await supabase
      .from("contract_revisions")
      .update({
        ai_status: "completed",
        revised_file_path: "image-based", // marker for image-based result
        ai_result: {
          final_page_paths: finalPagePaths,
          edited_page_numbers: editedPageNumbers,
          total_pages: pageImagePaths.length,
        },
      })
      .eq("id", revisionId);

    return new Response(
      JSON.stringify({ success: true, editedPages: editedPageNumbers }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Contract revision error:", err);
    if (revisionId) {
      try {
        await supabase
          .from("contract_revisions")
          .update({ ai_status: "error", ai_result: { error: err.message || "Unknown error" } })
          .eq("id", revisionId);
      } catch (_) {}
    }
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function analyzeEdits(
  apiKey: string,
  pageImageUrls: string[],
  instructions: string,
  totalPages: number
): Promise<Array<{ page_number: number; edit_instruction: string }>> {
  // Build image content parts for each page
  const imageContent: any[] = pageImageUrls.map((url, idx) => ({
    type: "image_url",
    image_url: { url },
  }));

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `你是一个文档分析助手。用户会提供一份合同的页面图片（共${totalPages}页，按顺序排列）和修改指令。你需要分析修改指令，确定需要修改的具体页码（1-${totalPages}）和每页的具体修改内容。`,
        },
        {
          role: "user",
          content: [
            ...imageContent,
            {
              type: "text",
              text: `以上是合同的${totalPages}页图片（按顺序排列）。请分析以下修改指令，确定需要在哪些页面进行修改：\n\n${instructions}`,
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "identify_edits",
            description: "识别需要修改的页面和具体修改内容",
            parameters: {
              type: "object",
              properties: {
                edits: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      page_number: {
                        type: "integer",
                        description: "需要修改的页码（从1开始）",
                      },
                      edit_instruction: {
                        type: "string",
                        description: "该页面的具体修改内容",
                      },
                    },
                    required: ["page_number", "edit_instruction"],
                  },
                },
              },
              required: ["edits"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "identify_edits" } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Analysis API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  console.log("AI analysis response:", JSON.stringify(data.choices?.[0]?.message).substring(0, 500));

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall) {
    const args = JSON.parse(toolCall.function.arguments);
    return args.edits || [];
  }

  // Fallback: try to parse from text content
  const textContent = data.choices?.[0]?.message?.content;
  if (textContent) {
    console.log("AI returned text instead of tool call, attempting to parse...");
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*"edits"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.edits || [];
      }
    } catch (e) {
      console.error("Failed to parse text content as edits:", e);
    }
  }

  throw new Error("AI did not return edit analysis");
}

async function editPageImage(
  apiKey: string,
  imageUrl: string,
  editInstruction: string
): Promise<string | null> {
  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `你是一个专业的文档图像编辑器。请对这个文档页面图片进行精确修改：

${editInstruction}

要求：
1. 保持文档页面的原始排版、格式、字体、字号、颜色完全不变
2. 只修改指定的文字内容
3. 修改后的文字必须与周围文字的风格完全一致，看起来像原始文档一样自然
4. 不要改变文档中的任何其他内容、印章、签名、表格线等
5. 输出的图片分辨率和尺寸必须与输入一致`,
            },
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      modalities: ["image", "text"],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Image edit API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const editedImageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  return editedImageUrl || null;
}
