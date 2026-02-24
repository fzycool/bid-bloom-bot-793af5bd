import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { materialId, filePath } = await req.json();
    if (!materialId || !filePath) {
      throw new Error("materialId and filePath are required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Update status to processing
    await supabase
      .from("company_materials")
      .update({ ai_status: "processing" })
      .eq("id", materialId);

    // Get public URL for the image
    const { data: urlData } = supabase.storage
      .from("company-materials")
      .getPublicUrl(filePath);
    const imageUrl = urlData.publicUrl;

    const systemPrompt = `你是一个专业的证书/资质文件识别专家。请仔细分析图片中的内容，提取以下信息并以JSON格式返回：
{
  "content_description": "图片内容的详细描述，包括证书名称、类型等",
  "material_type": "材料类型，如：营业执照、资质证书、荣誉证书、安全许可证、ISO认证、税务登记、组织机构代码证、其他",
  "issuing_authority": "颁发机构",
  "certificate_number": "证书编号",
  "expire_at": "有效期截止日期，格式YYYY-MM-DD，如无则返回null",
  "issued_at": "颁发日期，格式YYYY-MM-DD，如无则返回null"
}
仅返回JSON，不要包含其他内容。如果某个字段无法识别，返回null。`;

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: "请分析这张图片，提取证书/资质的相关信息。" },
        ],
      },
    ];

    let aiResult: any = null;
    let response: Response | null = null;

    // Try Lovable AI first
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (lovableApiKey) {
      try {
        response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lovableApiKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages,
            max_tokens: 2000,
            temperature: 0.1,
          }),
        });

        if (response.status === 429) {
          throw new Error("Rate limited, please try again later.");
        }
        if (response.status === 402) {
          throw new Error("Payment required, please add credits.");
        }

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "";
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            aiResult = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (e) {
        console.error("Lovable AI error:", e);
      }
    }

    // Fallback to configured model
    if (!aiResult) {
      const { data: modelConfig } = await supabase
        .from("model_config")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();

      if (modelConfig?.api_key && modelConfig?.base_url) {
        response = await fetch(`${modelConfig.base_url}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${modelConfig.api_key}`,
          },
          body: JSON.stringify({
            model: modelConfig.model_name,
            messages,
            max_tokens: modelConfig.max_tokens || 2000,
            temperature: 0.1,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error("Model API error:", response.status, errText);
          throw new Error(`AI API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiResult = JSON.parse(jsonMatch[0]);
        }
      }
    }

    if (aiResult) {
      await supabase
        .from("company_materials")
        .update({
          ai_status: "completed",
          content_description: aiResult.content_description || null,
          material_type: aiResult.material_type || null,
          issuing_authority: aiResult.issuing_authority || null,
          certificate_number: aiResult.certificate_number || null,
          expire_at: aiResult.expire_at || null,
          issued_at: aiResult.issued_at || null,
          ai_extracted_info: aiResult,
        })
        .eq("id", materialId);
    } else {
      await supabase
        .from("company_materials")
        .update({ ai_status: "failed" })
        .eq("id", materialId);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
