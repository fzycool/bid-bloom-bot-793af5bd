import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { base_url, model_name, api_key, provider } = await req.json();

    // Determine the actual API key and URL
    let actualKey = api_key;
    let actualUrl = base_url;

    if (provider === "lovable") {
      actualKey = Deno.env.get("LOVABLE_API_KEY");
      actualUrl = "https://ai.gateway.lovable.dev/v1";
      if (!actualKey) {
        return new Response(
          JSON.stringify({ success: false, error: "LOVABLE_API_KEY 未配置" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!actualKey) {
      return new Response(
        JSON.stringify({ success: false, error: "未提供 API Key" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(`${actualUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actualKey}`,
      },
      body: JSON.stringify({
        model: model_name,
        messages: [
          { role: "user", content: "请回复【连接成功】四个字" },
        ],
        max_tokens: 20,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - startTime;

    if (!resp.ok) {
      const errorText = await resp.text();
      let errorMsg = `HTTP ${resp.status}`;
      if (resp.status === 401 || resp.status === 403) {
        errorMsg = "API Key 无效或权限不足";
      } else if (resp.status === 404) {
        errorMsg = "接口地址或模型名称错误 (404)";
      } else if (resp.status === 402) {
        errorMsg = "账户余额不足 (402)";
      } else if (resp.status === 429) {
        errorMsg = "请求频率超限 (429)";
      } else {
        errorMsg += `: ${errorText.substring(0, 200)}`;
      }

      return new Response(
        JSON.stringify({ success: false, error: errorMsg, latency_ms: latencyMs }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({
        success: true,
        reply: reply.substring(0, 100),
        latency_ms: latencyMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    const msg = err.name === "AbortError" ? "请求超时（15秒）" : err.message;
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
