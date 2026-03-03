import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RAGPLUS_BASE = "https://webappxa.hoperun.com:8443";

async function loginRAGPlus(): Promise<string> {
  const res = await fetch(`${RAGPLUS_BASE}/api/auth/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "admin", password: "ragyftd18" }),
  });
  if (!res.ok) throw new Error(`RAGPlus登录失败: ${res.status}`);
  const json = await res.json();
  console.log("RAGPlus login response code:", json?.code);
  const token = json?.data;
  if (!token || typeof token !== "string") {
    throw new Error(`RAGPlus登录返回无效Token: ${JSON.stringify(json).substring(0, 200)}`);
  }
  return token;
}

async function queryKnowledgeBase(token: string, queryText: string): Promise<string> {
  const res = await fetch(`${RAGPLUS_BASE}/api/chat/query/v3/queryKnowledgeBase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      agentId: 477,
      chatId: 5022,
      v3MultiTurnEnabled: false,
      v3MultiTurnNumber: 5,
      queryText,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`RAGPlus查询失败: ${res.status} ${txt}`);
  }
  const json = await res.json();
  // Log full response structure for debugging
  console.log("RAGPlus queryKnowledgeBase response keys:", JSON.stringify(Object.keys(json || {})));
  if (json?.data) {
    console.log("RAGPlus data keys:", JSON.stringify(Object.keys(json.data || {})));
    if (json.data.queryResult) {
      console.log("RAGPlus queryResult keys:", JSON.stringify(Object.keys(json.data.queryResult)));
    }
  }
  console.log("RAGPlus full response (first 500 chars):", JSON.stringify(json).substring(0, 500));
  
  // Extract only queryResult.response from RAGPlus response
  const queryResult = json?.data?.queryResult || json?.queryResult;
  if (queryResult?.response) {
    return queryResult.response;
  }
  // Fallback: try other known paths
  const fallback = json?.data?.answer || json?.data?.content || json?.data;
  if (fallback && typeof fallback === "string") return fallback;
  if (fallback && typeof fallback === "object") return JSON.stringify(fallback);
  return JSON.stringify(json);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { proposalId } = await req.json();
    if (!proposalId) throw new Error("proposalId is required");

    // Set status to processing
    await supabase.from("bid_proposals").update({
      toc_status: "processing",
      toc_progress: "正在登录知识库...",
    } as any).eq("id", proposalId);

    // Run in background
    EdgeRuntime.waitUntil(
      generateToc(supabase, proposalId).catch(async (error) => {
        console.error("generate-toc background error:", error);
        await supabase.from("bid_proposals").update({
          toc_status: "failed",
          toc_progress: error.message || "生成失败",
        } as any).eq("id", proposalId);
      })
    );

    return new Response(JSON.stringify({ success: true, processing: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-toc error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function generateToc(supabase: any, proposalId: string) {
  try {
    // 1. Login to RAGPlus
    await supabase.from("bid_proposals").update({
      toc_progress: "正在登录知识库...",
    } as any).eq("id", proposalId);

    const token = await loginRAGPlus();

    // 2. Fetch all sections
    const { data: allSections, error: secErr } = await supabase
      .from("proposal_sections")
      .select("*")
      .eq("proposal_id", proposalId)
      .order("sort_order");

    if (secErr) throw new Error(`获取章节失败: ${secErr.message}`);
    if (!allSections || allSections.length === 0) throw new Error("提纲为空，请先生成提纲");

    // Clear existing TOC content before regenerating
    await supabase.from("bid_proposals").update({
      toc_progress: "正在清除旧目录内容...",
    } as any).eq("id", proposalId);

    // Clear content for all sections before regenerating
    for (const sec of allSections) {
      await supabase.from("proposal_sections").update({ content: null }).eq("id", sec.id);
    }

    // Build parent-child map
    const childMap = new Map<string, any[]>();
    for (const s of allSections) {
      if (s.parent_id) {
        if (!childMap.has(s.parent_id)) childMap.set(s.parent_id, []);
        childMap.get(s.parent_id)!.push(s);
      }
    }

    // Find leaf sections (sections with no children)
    const leafSections = allSections.filter((s: any) => !childMap.has(s.id));

    if (leafSections.length === 0) throw new Error("没有找到最小章节");

    const total = leafSections.length;
    let completed = 0;

    // 3. For each leaf section, build prompt and query
    for (const leaf of leafSections) {
      // Check if paused or cancelled before each section
      const { data: statusCheck } = await supabase
        .from("bid_proposals")
        .select("toc_status")
        .eq("id", proposalId)
        .single();

      const currentStatus = (statusCheck as any)?.toc_status;
      if (currentStatus === "cancelled") {
        console.log("TOC generation cancelled by user");
        await supabase.from("bid_proposals").update({
          toc_status: "cancelled",
          toc_progress: `已取消 (已完成 ${completed}/${total})`,
        } as any).eq("id", proposalId);
        return;
      }
      if (currentStatus === "paused") {
        console.log("TOC generation paused by user at", completed);
        await supabase.from("bid_proposals").update({
          toc_progress: `已暂停 (已完成 ${completed}/${total})`,
        } as any).eq("id", proposalId);
        return;
      }

      // Skip sections that already have content (for resume after pause)
      if (leaf.content && !leaf.content.startsWith("[目录生成失败:")) {
        completed++;
        continue;
      }

      // Build the section path using only titles (no section numbers)
      let sectionLabel = leaf.title;

      // Find parent title for context (without section number)
      if (leaf.parent_id) {
        const parent = allSections.find((s: any) => s.id === leaf.parent_id);
        if (parent) {
          sectionLabel = `${parent.title} ${sectionLabel}`;
        }
      }

      await supabase.from("bid_proposals").update({
        toc_progress: `正在生成: ${leaf.section_number || ""} ${leaf.title} (${completed + 1}/${total})`,
      } as any).eq("id", proposalId);

      // Build the prompt per user requirements
      const queryText = `${sectionLabel}章节有什么内容 请详细描述，如有子章节，请列出子章节的标题，每一章节后面标注该章节撰写时需要的注意事项和需要遵守的格式，如有表格的话，请描述表格的格式和内容，如需要盖章和签字的位置也请描述出来，如果有图片，请把需要插入图片的位置也标注出来。`;

      try {
        const answer = await queryKnowledgeBase(token, queryText);

        // Save the answer as the section's content (TOC detail)
        await supabase.from("proposal_sections").update({
          content: answer,
        }).eq("id", leaf.id);
      } catch (queryErr: any) {
        console.error(`Query failed for section ${leaf.title}:`, queryErr);
        // Save error but continue
        await supabase.from("proposal_sections").update({
          content: `[目录生成失败: ${queryErr.message}]`,
        }).eq("id", leaf.id);
      }

      completed++;

      // Small delay to avoid rate limiting
      if (completed < total) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 4. Mark completed
    await supabase.from("bid_proposals").update({
      toc_status: "completed",
      toc_progress: null,
    } as any).eq("id", proposalId);

    console.log("TOC generation completed for:", proposalId);
  } catch (err) {
    console.error("generateToc fatal error:", err);
    await supabase.from("bid_proposals").update({
      toc_status: "failed",
      toc_progress: `生成异常: ${err instanceof Error ? err.message : "未知错误"}`,
    } as any).eq("id", proposalId);
  }
}
