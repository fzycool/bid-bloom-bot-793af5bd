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

    // ---- ACTION: parse-resume (extract structured data from resume text) ----
    if (action === "parse-resume") {
      const { resumeVersionId, content } = params;
      if (!content?.trim()) throw new Error("简历内容不能为空");

      await supabase.from("resume_versions").update({ ai_status: "processing" }).eq("id", resumeVersionId);

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `你是一位资深HR顾问，擅长解析和结构化简历信息。请从简历中提取以下结构化信息，以JSON格式返回：
{
  "name": "姓名",
  "gender": "性别",
  "birth_year": 出生年份(数字),
  "education": "最高学历",
  "major": "专业",
  "current_company": "当前单位",
  "current_position": "当前职位",
  "years_of_experience": 工作年限(数字),
  "certifications": ["证书1", "证书2"],
  "skills": ["技能1", "技能2"],
  "work_experiences": [
    {"company": "公司", "position": "职位", "start_date": "2020-01", "end_date": "2023-06", "description": "职责描述", "is_current": false}
  ],
  "project_experiences": [
    {"project_name": "项目名", "role": "角色", "start_date": "2021-03", "end_date": "2022-01", "description": "项目描述", "technologies": ["技术1"]}
  ],
  "education_history": [
    {"school": "学校", "degree": "学历", "major": "专业", "start_date": "2012-09", "end_date": "2016-06"}
  ],
  "timeline_issues": [
    {"type": "overlap|gap|impossible", "description": "具体问题描述", "severity": "error|warning"}
  ]
}

时间线稽查规则：
1. 检查是否存在工作经历时间重叠（同时在两家公司全职）
2. 检查毕业时间与工作年限是否匹配（如毕业2年却有8年经验）
3. 检查项目经验时间是否在对应工作经历时间范围内
4. 检查是否有不合理的空档期（>1年）
请严格输出纯JSON，不要包含markdown标记。`,
            },
            { role: "user", content: `请解析以下简历：\n\n${content}` },
          ],
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error("AI error:", response.status, errBody);
        await supabase.from("resume_versions").update({ ai_status: "failed" }).eq("id", resumeVersionId);
        throw new Error(`AI error: ${response.status}`);
      }

      const data = await response.json();
      let resultText = data.choices?.[0]?.message?.content || "";
      // Strip markdown code fences if present
      resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      let result;
      try {
        result = JSON.parse(resultText);
      } catch {
        console.error("Failed to parse AI response:", resultText);
        await supabase.from("resume_versions").update({ ai_status: "failed" }).eq("id", resumeVersionId);
        throw new Error("AI返回格式异常");
      }

      // Update resume version
      await supabase.from("resume_versions").update({
        work_experiences: result.work_experiences || [],
        project_experiences: result.project_experiences || [],
        education_history: result.education_history || [],
        timeline_issues: result.timeline_issues || [],
        content,
        ai_status: "completed",
      }).eq("id", resumeVersionId);

      // Update employee base info if available
      if (result.name) {
        const { data: rv } = await supabase.from("resume_versions").select("employee_id").eq("id", resumeVersionId).single();
        if (rv) {
          await supabase.from("employees").update({
            name: result.name,
            gender: result.gender || null,
            birth_year: result.birth_year || null,
            education: result.education || null,
            major: result.major || null,
            current_company: result.current_company || null,
            current_position: result.current_position || null,
            years_of_experience: result.years_of_experience || null,
            certifications: result.certifications || [],
            skills: result.skills || [],
          }).eq("id", rv.employee_id);
        }
      }

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- ACTION: match-resume (compare resume against bid requirements) ----
    if (action === "match-resume") {
      const { resumeVersionId, bidAnalysisId } = params;

      // Fetch resume and bid data
      const [{ data: resume }, { data: bid }] = await Promise.all([
        supabase.from("resume_versions").select("*, employees(*)").eq("id", resumeVersionId).single(),
        supabase.from("bid_analyses").select("*").eq("id", bidAnalysisId).single(),
      ]);

      if (!resume || !bid) throw new Error("简历或招标数据不存在");

      await supabase.from("resume_versions").update({ ai_status: "matching" }).eq("id", resumeVersionId);

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `你是招投标人员配置专家。请分析简历与招标要求的匹配度，返回JSON：
{
  "match_score": 0-100的匹配度分数,
  "match_details": {
    "strengths": ["优势1", "优势2"],
    "weaknesses": ["不足1", "不足2"],
    "missing_keywords": ["缺失关键词1"],
    "suggested_role": "建议担任的角色",
    "improvement_suggestions": ["改进建议1"]
  }
}
请严格输出纯JSON。`,
            },
            {
              role: "user",
              content: `【招标要求】
人员要求: ${JSON.stringify(bid.personnel_requirements)}
技术关键词: ${JSON.stringify(bid.technical_keywords)}
业务关键词: ${JSON.stringify(bid.business_keywords)}
职责关键词: ${JSON.stringify(bid.responsibility_keywords)}
评分表: ${JSON.stringify(bid.scoring_table)}

【候选人简历】
姓名: ${(resume as any).employees?.name}
职位: ${(resume as any).employees?.current_position}
技能: ${JSON.stringify((resume as any).employees?.skills)}
证书: ${JSON.stringify((resume as any).employees?.certifications)}
工作经历: ${JSON.stringify(resume.work_experiences)}
项目经验: ${JSON.stringify(resume.project_experiences)}
学历: ${JSON.stringify(resume.education_history)}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        await supabase.from("resume_versions").update({ ai_status: "failed" }).eq("id", resumeVersionId);
        throw new Error(`AI error: ${response.status}`);
      }

      const data = await response.json();
      let resultText = data.choices?.[0]?.message?.content || "";
      resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      const result = JSON.parse(resultText);

      await supabase.from("resume_versions").update({
        match_score: result.match_score,
        match_details: result.match_details,
        ai_status: "completed",
      }).eq("id", resumeVersionId);

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- ACTION: polish-resume ----
    if (action === "polish-resume") {
      const { resumeVersionId, bidAnalysisId, customInstructions } = params;

      const [{ data: resume }, { data: bid }] = await Promise.all([
        supabase.from("resume_versions").select("*, employees(*)").eq("id", resumeVersionId).single(),
        bidAnalysisId
          ? supabase.from("bid_analyses").select("*").eq("id", bidAnalysisId).single()
          : Promise.resolve({ data: null }),
      ]);

      if (!resume) throw new Error("简历不存在");

      await supabase.from("resume_versions").update({ ai_status: "polishing" }).eq("id", resumeVersionId);

      let bidContext = "";
      if (bid) {
        bidContext = `
【目标招标项目关键词】
技术关键词: ${JSON.stringify(bid.technical_keywords)}
业务关键词: ${JSON.stringify(bid.business_keywords)}
职责关键词: ${JSON.stringify(bid.responsibility_keywords)}
人员要求: ${JSON.stringify(bid.personnel_requirements)}
`;
      }

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `你是资深投标简历润色专家。你的任务是将候选人的真实简历润色为投标用简历，需要：

1. **职责对齐**：将日常工作职责映射到招标要求的描述上
2. **同义替换**：将平淡描述升级为专业表达，如"负责项目"→"主导XX千万级项目全生命周期管理"
3. **关键词植入**：自然地融入招标要求的技术/业务关键词
4. **量化增强**：尽量加入具体数据和成果
5. **严禁造假**：不编造不存在的经历，只润色真实经历的表达方式
6. **时间线保持**：不改变任何时间信息

${customInstructions ? `【用户自定义要求】\n${customInstructions}\n` : ""}

请输出完整的润色后简历文本，使用清晰的格式和分节。`,
            },
            {
              role: "user",
              content: `${bidContext}
【原始简历信息】
姓名: ${(resume as any).employees?.name}
职位: ${(resume as any).employees?.current_position}
学历: ${(resume as any).employees?.education} ${(resume as any).employees?.major || ""}
工作年限: ${(resume as any).employees?.years_of_experience || "未知"}年
证书: ${JSON.stringify((resume as any).employees?.certifications)}
技能: ${JSON.stringify((resume as any).employees?.skills)}

工作经历:
${JSON.stringify(resume.work_experiences, null, 2)}

项目经验:
${JSON.stringify(resume.project_experiences, null, 2)}

学历背景:
${JSON.stringify(resume.education_history, null, 2)}

原始简历文本:
${resume.content || "无"}

请对以上简历进行专业润色。`,
            },
          ],
        }),
      });

      if (!response.ok) {
        await supabase.from("resume_versions").update({ ai_status: "failed" }).eq("id", resumeVersionId);
        throw new Error(`AI error: ${response.status}`);
      }

      const data = await response.json();
      const polished = data.choices?.[0]?.message?.content || "";

      await supabase.from("resume_versions").update({
        polished_content: polished,
        ai_status: "completed",
      }).eq("id", resumeVersionId);

      return new Response(JSON.stringify({ success: true, polished }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("resume-factory error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
