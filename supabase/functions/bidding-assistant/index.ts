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

    const { data: modelConfig } = await supabase.from("model_config").select("*").eq("is_active", true).maybeSingle();
    const aiUrl = modelConfig?.base_url || "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiModel = modelConfig?.model_name || "openai/gpt-5.2";
    const aiKey = modelConfig?.api_key || LOVABLE_API_KEY;
    const isLovable = !modelConfig || modelConfig.provider === "lovable";

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

      await supabase.from("bid_proposals").update({ ai_status: "processing", ai_progress: "正在准备数据...", token_usage: null } as any).eq("id", proposalId);

      let systemContent = `你是资深投标专家，擅长根据招标文件编制高质量投标文件。请根据以下招标解析结果，生成完整的投标文件应答提纲。

要求：
1. 严格按照招标文件的目录和评分标准组织章节
2. 每个章节标注需要的证明材料
3. 识别硬性要求（资质证书、业绩证明等）和软性要求（方案描述等）
4. 标注每个章节对应的评分分值
5. 建议可关联的知识库模板
6. 【极其重要】material_checklist 的生成规则：
   - 每一项证书、资质、证明文件都必须作为独立的一条记录，绝不允许合并
   - 例如：如果招标文件要求"CMMI L5级、ISO 27001、ISO 9001三项认证"，你必须生成3条独立记录：
     第1条: material_name="CMMI L5级认证证书"
     第2条: material_name="ISO 27001信息安全管理体系认证证书"
     第3条: material_name="ISO 9001质量管理体系认证证书"
   - 类似地，如果要求"项目经理学历证书、职称证书、社保证明"，也必须拆成3条独立记录
   - 每条记录的 material_name 必须是一个具体的、可独立上传的文件名称
   - 绝对禁止出现"XX等N项证书"、"多项认证复印件"这样的合并描述
7. 【极其重要】material_format 字段必须填写，用于对材料进行分类展示。请使用以下标准分类名称：
   - "资质认证证书" — 各类ISO、CMMI等体系认证证书
   - "企业基本资料" — 营业执照、法人证书、组织机构代码等
   - "财务证明材料" — 财务报告、验资报告、纳税证明、银行资信等
   - "人员资质证明" — 学历证书、职称证书、资格证书、社保证明等
   - "业绩证明材料" — 合同复印件、中标通知书、验收报告等
   - "技术能力证明" — 软件著作权、专利证书、产品检测报告等
   - "声明承诺文件" — 各类声明函、承诺书等
   - "投标文件组成" — 投标函、报价单、服务方案等

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
      "requirement_text": "具体要求原文（从招标文件中摘录）",
      "requirement_type": "hard|soft",
      "material_name": "需要上传的单项具体材料名称（一条记录只能对应一个文件，如：CMMI L5级认证证书）",
      "material_format": "资质认证证书|企业基本资料|财务证明材料|人员资质证明|业绩证明材料|技术能力证明|声明承诺文件|投标文件组成",
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

      await supabase.from("bid_proposals").update({ ai_progress: "正在调用AI生成提纲..." } as any).eq("id", proposalId);

      const requestBody: any = {
        model: aiModel,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent },
        ],
      };
      // Only set max_tokens for Lovable gateway (other providers may reject it)
      if (isLovable) {
        requestBody.max_tokens = 32000;
      }

      const response = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        await supabase.from("bid_proposals").update({ ai_status: "failed" }).eq("id", proposalId);
        const status = response.status;
        const errBody = await response.text();
        console.error("AI API error:", status, errBody);
        if (status === 429) return new Response(JSON.stringify({ error: "AI服务请求过于频繁" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "AI服务额度不足" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI error: ${status}`);
      }

      const data = await response.json();

      // Extract and save token usage immediately
      const usage = data.usage;
      if (usage) {
        await supabase.from("bid_proposals").update({
          ai_progress: "AI生成完成，正在解析结果...",
          token_usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 },
        } as any).eq("id", proposalId);
      } else {
        await supabase.from("bid_proposals").update({ ai_progress: "AI生成完成，正在解析结果..." } as any).eq("id", proposalId);
      }

      let resultText = data.choices?.[0]?.message?.content || "";
      resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      let result;
      try {
        result = JSON.parse(resultText);
      } catch {
        // Attempt to repair truncated JSON
        try {
          let repaired = resultText;
          
          // Close any unclosed string: count unescaped quotes
          let inString = false;
          for (let i = 0; i < repaired.length; i++) {
            if (repaired[i] === '\\' && inString) { i++; continue; }
            if (repaired[i] === '"') inString = !inString;
          }
          if (inString) repaired += '"';
          
          // Aggressively trim trailing incomplete structures
          // Remove incomplete key-value pairs, partial objects, etc.
          for (let attempt = 0; attempt < 10; attempt++) {
            const before = repaired;
            // Remove trailing incomplete value after colon
            repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*"[^"]*"?\s*$/g, "");
            repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*$/g, "");
            repaired = repaired.replace(/,\s*"[^"]*"\s*$/g, "");
            // Remove incomplete object at end of array
            repaired = repaired.replace(/,\s*\{\s*("[^"]*"\s*:\s*("[^"]*"|[^,}\]]*)\s*,?\s*)*$/g, "");
            // Remove trailing comma
            repaired = repaired.replace(/,\s*$/g, "");
            if (repaired === before) break;
          }
          
          // Clean trailing commas before closers
          repaired = repaired.replace(/,\s*}/g, "}");
          repaired = repaired.replace(/,\s*]/g, "]");
          
          // Balance braces and brackets
          let braces = 0, brackets = 0;
          for (const c of repaired) {
            if (c === '{') braces++;
            else if (c === '}') braces--;
            else if (c === '[') brackets++;
            else if (c === ']') brackets--;
          }
          while (brackets > 0) { repaired += ']'; brackets--; }
          while (braces > 0) { repaired += '}'; braces--; }
          
          result = JSON.parse(repaired);
          console.log("Successfully repaired truncated AI JSON response");
        } catch (repairErr) {
          // Last resort: try to extract just the outline portion
          try {
            const outlineMatch = resultText.match(/"outline"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
            if (outlineMatch) {
              result = { outline: JSON.parse(outlineMatch[1]), material_checklist: [], personnel_plan: [] };
              console.log("Recovered outline from truncated response");
            } else {
              throw repairErr;
            }
          } catch {
            console.error("Failed to parse AI response even after repair:", resultText.slice(-300));
            await supabase.from("bid_proposals").update({ ai_status: "failed" }).eq("id", proposalId);
            throw new Error("AI返回格式异常，请重试");
          }
        }
      }

      await supabase.from("bid_proposals").update({ ai_progress: "正在保存提纲结构..." } as any).eq("id", proposalId);

      // Save outline content
      await supabase.from("bid_proposals").update({
        outline_content: JSON.stringify(result),
        ai_status: "completed",
        ai_progress: null,
      } as any).eq("id", proposalId);

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
            material_format: mat.material_format || null,
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
