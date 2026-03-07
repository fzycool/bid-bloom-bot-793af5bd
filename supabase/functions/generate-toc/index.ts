import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RAGPLUS_BASE = "https://webappxa.hoperun.com:8443";
const NO_ANSWER_MARKER = "抱歉，暂不能在现有的知识库中找到该问题的答案";

async function loginRAGPlus(): Promise<string> {
  const res = await fetch(`${RAGPLUS_BASE}/api/auth/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "admin", password: "ragyftd18" }),
  });
  if (!res.ok) throw new Error(`RAGPlus登录失败: ${res.status}`);
  const json = await res.json();
  const token = json?.data;
  if (!token || typeof token !== "string") {
    throw new Error(`RAGPlus登录返回无效Token`);
  }
  return token;
}

async function queryKnowledgeBase(token: string, queryText: string, timeoutMs = 40000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
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
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`RAGPlus查询失败: ${res.status} ${txt}`);
    }
    const json = await res.json();
    const queryResult = json?.data?.queryResult || json?.queryResult;
    if (queryResult?.response) return queryResult.response;
    const fallback = json?.data?.answer || json?.data?.content || json?.data;
    if (fallback && typeof fallback === "string") return fallback;
    if (fallback && typeof fallback === "object") return JSON.stringify(fallback);
    return JSON.stringify(json);
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      console.warn(`RAGPlus查询超时(${timeoutMs}ms): ${queryText.substring(0, 50)}...`);
      throw new Error("TIMEOUT");
    }
    throw e;
  }
}

async function getAiConfig(supabase: any) {
  const { data } = await supabase
    .from("model_config")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .single();
  return data;
}

interface SubSection {
  title: string;
  details: string;
}

async function summarizeWithAI(
  content: string,
  sectionTitle: string,
  aiUrl: string,
  aiModel: string,
  aiKey: string,
): Promise<SubSection[]> {
  const prompt = `你是一个专业的投标文件编写专家。请根据以下知识库返回的内容，总结出"${sectionTitle}"章节下面的小节标题以及每个小节的注意事项。

要求：
1. 提取出所有子章节的标题，按逻辑顺序排列
2. 每个子章节的详情中标注撰写时需要的注意事项
3. 如有表格要求，描述表格的格式和内容
4. 如需盖章和签字的位置也请标注
5. 如果有图片要求，标注需要插入图片的位置

请严格按照以下JSON格式返回，不要包含任何其他内容：
[
  {"title": "子章节标题1", "details": "该子章节的注意事项、书写要求、表格要求、图片位置等详细说明"},
  {"title": "子章节标题2", "details": "..."}
]

知识库返回内容：
${content}`;

  try {
    const res = await fetch(aiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      console.error("AI summarize failed:", res.status);
      return [{ title: sectionTitle, details: content }];
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || "";
    // Extract JSON from response (may be wrapped in ```json ... ```)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item: any) => ({
            title: String(item.title || ""),
            details: String(item.details || item.detail || item.notes || ""),
          })).filter((item: SubSection) => item.title.trim().length > 0);
        }
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr);
      }
    }
    // Fallback: return as single sub-section
    return [{ title: sectionTitle, details: text || content }];
  } catch (e) {
    console.error("AI summarize error:", e);
    return [{ title: sectionTitle, details: content }];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { proposalId, resume = false } = await req.json();
    if (!proposalId) throw new Error("proposalId is required");

    await supabase.from("bid_proposals").update({
      toc_status: "processing",
      toc_progress: resume ? "正在继续生成..." : "正在登录知识库...",
    } as any).eq("id", proposalId);

    EdgeRuntime.waitUntil(
      generateToc(supabase, proposalId, resume).catch(async (error) => {
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

async function generateToc(supabase: any, proposalId: string, resume = false) {
  try {
    // 1. Login to RAGPlus
    const token = await loginRAGPlus();

    // 2. Get AI config
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const modelConfig = await getAiConfig(supabase);
    const aiUrl = modelConfig?.base_url || "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiModel = modelConfig?.model_name || "google/gemini-2.5-flash";
    const aiKey = modelConfig?.api_key || LOVABLE_API_KEY || "";

    // 3. Fetch all sections
    const { data: allSections, error: secErr } = await supabase
      .from("proposal_sections")
      .select("*")
      .eq("proposal_id", proposalId)
      .order("sort_order");

    if (secErr) throw new Error(`获取章节失败: ${secErr.message}`);
    if (!allSections || allSections.length === 0) throw new Error("提纲为空，请先生成提纲");

    // If not resuming, clear all existing TOC entries
    if (!resume) {
      await supabase.from("bid_proposals").update({
        toc_progress: "正在清除旧目录内容...",
      } as any).eq("id", proposalId);
      // Delete all TOC entries for this proposal
      await supabase.from("proposal_toc_entries")
        .delete()
        .eq("proposal_id", proposalId);
    }

    // Build parent-child map
    const childMap = new Map<string, any[]>();
    for (const s of allSections) {
      if (s.parent_id) {
        if (!childMap.has(s.parent_id)) childMap.set(s.parent_id, []);
        childMap.get(s.parent_id)!.push(s);
      }
    }

    // Find leaf sections (sections with no children that are NOT toc markers)
    const leafSections = allSections.filter((s: any) => !childMap.has(s.id) && s.source_type !== "toc_generated");
    if (leafSections.length === 0) throw new Error("没有找到最小章节");

    const total = leafSections.length;
    let completed = 0;

    // 4. Process each leaf section one by one
    for (const leaf of leafSections) {
      // Check status before each section
      const { data: statusCheck } = await supabase
        .from("bid_proposals")
        .select("toc_status")
        .eq("id", proposalId)
        .single();

      const currentStatus = (statusCheck as any)?.toc_status;
      if (currentStatus === "cancelled") {
        await supabase.from("bid_proposals").update({
          toc_status: "cancelled",
          toc_progress: `已取消 (已完成 ${completed}/${total})`,
        } as any).eq("id", proposalId);
        return;
      }
      if (currentStatus === "paused") {
        await supabase.from("bid_proposals").update({
          toc_progress: `已暂停 (已完成 ${completed}/${total})`,
        } as any).eq("id", proposalId);
        return;
      }

      // Skip sections that already have TOC entries (for resume)
      if (resume) {
        const { count } = await supabase.from("proposal_toc_entries")
          .select("id", { count: "exact", head: true })
          .eq("parent_section_id", leaf.id);
        if (count && count > 0) {
          completed++;
          continue;
        }
        // Also skip if marked as no match (stored as a special TOC entry)
        const { count: noMatchCount } = await supabase.from("proposal_toc_entries")
          .select("id", { count: "exact", head: true })
          .eq("parent_section_id", leaf.id)
          .eq("title", "__NO_KB_MATCH__");
        if (noMatchCount && noMatchCount > 0) {
          completed++;
          continue;
        }
      }

      // Build section label
      let sectionLabel = leaf.title;
      if (leaf.parent_id) {
        const parent = allSections.find((s: any) => s.id === leaf.parent_id);
        if (parent) sectionLabel = `${parent.title} ${sectionLabel}`;
      }

      await supabase.from("bid_proposals").update({
        toc_progress: `正在生成: ${leaf.section_number || ""} ${leaf.title} (${completed + 1}/${total})`,
      } as any).eq("id", proposalId);

      const queryText = `${sectionLabel}章节有什么内容 请详细描述，如有子章节，请列出子章节的标题，每一章节后面标注该章节撰写时需要的注意事项和需要遵守的格式，如有表格的话，请描述表格的格式和内容，如需要盖章和签字的位置也请描述出来，如果有图片，请把需要插入图片的位置也标注出来。`;

      try {
        const rawAnswer = await queryKnowledgeBase(token, queryText);

        // Check if RAGPlus returned "no answer"
        if (rawAnswer.includes(NO_ANSWER_MARKER)) {
          console.log(`Section "${leaf.title}" has no KB match, inserting marker TOC entry`);
          // Insert a marker TOC entry for resume tracking (never touch proposal_sections)
          await supabase.from("proposal_toc_entries").insert({
            proposal_id: proposalId,
            parent_section_id: leaf.id,
            title: "__NO_KB_MATCH__",
            content: "该章节在知识库中未找到相关内容，默认无子章节。",
            section_number: leaf.section_number || "",
            sort_order: leaf.sort_order * 100,
          });
        } else {
          // Use AI to summarize into sub-section titles + notes
          await supabase.from("bid_proposals").update({
            toc_progress: `正在AI总结: ${leaf.section_number || ""} ${leaf.title} (${completed + 1}/${total})`,
          } as any).eq("id", proposalId);

          const subSections = await summarizeWithAI(rawAnswer, sectionLabel, aiUrl, aiModel, aiKey);

          // Insert sub-sections into the separate TOC table
          const sectionNumber = leaf.section_number || "";
          for (let i = 0; i < subSections.length; i++) {
            const sub = subSections[i];
            const subNumber = sectionNumber ? `${sectionNumber}.${i + 1}` : `${i + 1}`;
            await supabase.from("proposal_toc_entries").insert({
              proposal_id: proposalId,
              parent_section_id: leaf.id,
              title: sub.title,
              content: sub.details,
              section_number: subNumber,
              sort_order: leaf.sort_order * 100 + i + 1,
            });
          }
        }
      } catch (queryErr: any) {
        console.error(`Query failed for section ${leaf.title}:`, queryErr);
        if (queryErr.message === "TIMEOUT") {
          console.warn(`Section "${leaf.title}" timed out, treating as no KB match`);
          await supabase.from("proposal_toc_entries").insert({
            proposal_id: proposalId,
            parent_section_id: leaf.id,
            title: "__NO_KB_MATCH__",
            content: "知识库查询超时，该章节默认无子章节。",
            section_number: leaf.section_number || "",
            sort_order: leaf.sort_order * 100,
          });
        } else {
          // Mark failure but don't pollute the outline
          console.error(`Section "${leaf.title}" failed: ${queryErr.message}`);
        }
      }

      completed++;

      // Small delay to avoid rate limiting and control memory
      if (completed < total) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 5. Mark completed
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
