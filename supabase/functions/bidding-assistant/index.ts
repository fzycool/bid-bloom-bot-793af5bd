import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { action, ...params } = await req.json();

    // ---- ACTION: generate-outline ----
    if (action === "generate-outline") {
      const { proposalId, bidAnalysisId, customPrompt } = params;

      // Fetch bid analysis data
      const { data: bid } = await supabase
        .from("bid_analyses")
        .select("*")
        .eq("id", bidAnalysisId)
        .single();
      if (!bid) throw new Error("招标解析数据不存在");

      // Fetch knowledge base documents for context
      const { data: docs } = await supabase
        .from("documents")
        .select("id, file_name, doc_category, industry, ai_summary, tags")
        .eq("user_id", bid.user_id)
        .limit(50);

      // Fetch available employees/resumes
      const { data: employees } = await supabase
        .from("employees")
        .select("id, name, current_position, skills, certifications, years_of_experience")
        .eq("user_id", bid.user_id);

      await supabase.from("bid_proposals").update({ ai_status: "processing" }).eq("id", proposalId);

      let systemContent = `你是资深投标专家，擅长根据招标文件编制高质量投标文件。请根据以下招标解析结果，生成完整的投标文件应答提纲。

要求：
1. 严格按照招标文件的目录和评分标准组织章节
2. 每个章节标注需要的证明材料
3. 识别硬性要求（资质证书、业绩证明等）和软性要求（方案描述等）
4. 标注每个章节对应的评分分值
5. 建议可关联的知识库模板

请输出JSON格式：
{
  "outline": [
    {
      "section_number": "1",
      "title": "章节标题",
      "description": "章节内容说明",
      "score_weight": "对应分值",
      "children": [
        {
          "section_number": "1.1",
          "title": "子章节",
          "description": "内容要求",
          "required_materials": ["需要的证明材料"],
          "suggested_template": "建议关联的知识库模板类型"
        }
      ]
    }
  ],
  "material_checklist": [
    {
      "requirement_text": "具体要求原文",
      "requirement_type": "hard|soft",
      "material_name": "需要的材料名称",
      "severity": "error|warning|info"
    }
  ],
  "personnel_plan": [
    {
      "role": "岗位名称",
      "requirements": "要求描述",
      "suggested_candidate": "建议人选姓名（从候选人列表匹配）",
      "match_reason": "推荐理由"
    }
  ],
  "overall_strategy": "整体投标策略建议（200字以内）"
}`;

      if (customPrompt) {
        systemContent += `\n\n【用户自定义要求】\n${customPrompt}`;
      }
      systemContent += `\n请严格输出纯JSON。`;

      const userContent = `【招标项目】${bid.project_name || "未命名"}

【评分标准】
${JSON.stringify(bid.scoring_table)}

【废标红线】
${JSON.stringify(bid.disqualification_items)}

【人员配置要求】
${JSON.stringify(bid.personnel_requirements)}

【技术关键词】${JSON.stringify(bid.technical_keywords)}
【业务关键词】${JSON.stringify(bid.business_keywords)}
【职责关键词】${JSON.stringify(bid.responsibility_keywords)}

【项目摘要】${bid.summary || "无"}

【可用知识库文档】
${(docs || []).map((d: any) => `- ${d.file_name} [${d.doc_category || "未分类"}] ${d.ai_summary || ""}`).join("\n")}

【可用人员】
${(employees || []).map((e: any) => `- ${e.name}: ${e.current_position || "未知"}, 技能: ${(e.skills || []).join(",")}, 证书: ${(e.certifications || []).join(",")}, ${e.years_of_experience || "?"}年经验`).join("\n")}`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!response.ok) {
        await supabase.from("bid_proposals").update({ ai_status: "failed" }).eq("id", proposalId);
        const status = response.status;
        if (status === 429) return new Response(JSON.stringify({ error: "AI服务请求过于频繁" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        await supabase.from("bid_proposals").update({ ai_status: "failed" }).eq("id", proposalId);
        throw new Error("AI返回格式异常");
      }

      // Save outline content
      await supabase.from("bid_proposals").update({
        outline_content: JSON.stringify(result),
        ai_status: "completed",
      }).eq("id", proposalId);

      // Save sections to proposal_sections table
      if (result.outline) {
        for (let i = 0; i < result.outline.length; i++) {
          const section = result.outline[i];
          const { data: parent } = await supabase.from("proposal_sections").insert({
            proposal_id: proposalId,
            section_number: section.section_number,
            title: section.title,
            content: section.description || "",
            sort_order: i,
          }).select("id").single();

          if (parent && section.children) {
            for (let j = 0; j < section.children.length; j++) {
              const child = section.children[j];
              await supabase.from("proposal_sections").insert({
                proposal_id: proposalId,
                parent_id: parent.id,
                section_number: child.section_number,
                title: child.title,
                content: `${child.description || ""}\n\n需要材料: ${(child.required_materials || []).join(", ")}\n建议模板: ${child.suggested_template || "无"}`,
                sort_order: j,
              });
            }
          }
        }
      }

      // Save material checklist
      if (result.material_checklist) {
        for (const mat of result.material_checklist) {
          // Try to match with knowledge base documents
          let matchedDocId = null;
          let matchedPath = null;
          if (docs && mat.material_name) {
            const matched = docs.find((d: any) =>
              d.file_name?.includes(mat.material_name) ||
              d.ai_summary?.includes(mat.material_name) ||
              (d.tags || []).some((t: string) => mat.material_name.includes(t))
            );
            if (matched) {
              matchedDocId = matched.id;
              matchedPath = null;
            }
          }

          await supabase.from("proposal_materials").insert({
            proposal_id: proposalId,
            requirement_text: mat.requirement_text,
            requirement_type: mat.requirement_type || "hard",
            material_name: mat.material_name,
            status: matchedDocId ? "matched" : "missing",
            matched_document_id: matchedDocId,
            matched_file_path: matchedPath,
            severity: mat.severity || "warning",
          });
        }
      }

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- ACTION: check-materials ----
    if (action === "check-materials") {
      const { proposalId } = params;

      const [{ data: proposal }, { data: materials }] = await Promise.all([
        supabase.from("bid_proposals").select("*, bid_analyses(*)").eq("id", proposalId).single(),
        supabase.from("proposal_materials").select("*").eq("proposal_id", proposalId),
      ]);

      if (!proposal) throw new Error("投标方案不存在");

      // Re-check materials against knowledge base
      const { data: docs } = await supabase
        .from("documents")
        .select("id, file_name, doc_category, ai_summary, tags, file_path")
        .eq("user_id", proposal.user_id);

      let updatedCount = 0;
      for (const mat of (materials || [])) {
        if (mat.status === "matched") continue;

        const matched = (docs || []).find((d: any) =>
          d.file_name?.includes(mat.material_name || "") ||
          d.ai_summary?.includes(mat.material_name || "") ||
          d.ai_summary?.includes(mat.requirement_text || "") ||
          (d.tags || []).some((t: string) => (mat.material_name || "").includes(t))
        );

        if (matched) {
          await supabase.from("proposal_materials").update({
            status: "matched",
            matched_document_id: matched.id,
            matched_file_path: matched.file_path,
          }).eq("id", mat.id);
          updatedCount++;
        }
      }

      return new Response(JSON.stringify({ success: true, updatedCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("bidding-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
