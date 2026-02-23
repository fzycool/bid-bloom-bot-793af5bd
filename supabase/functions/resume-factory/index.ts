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

    const { action, ...params } = await req.json();

    // ---- ACTION: parse-resume (extract structured data from resume text) ----
    if (action === "parse-resume") {
      const { resumeVersionId, content, filePath, fileType } = params;

      let resumeText = content?.trim() || "";

      // If file path provided, download and extract text
      if (filePath && !resumeText) {
        const { data: fileData, error: dlError } = await supabase.storage
          .from("knowledge-base")
          .download(filePath);
        if (dlError || !fileData) throw new Error(`文件下载失败: ${dlError?.message || "unknown"}`);

        const isPdf = filePath.endsWith(".pdf") || fileType?.includes("pdf");
        const isExcel = filePath.endsWith(".xls") || filePath.endsWith(".xlsx") || fileType?.includes("spreadsheet") || fileType?.includes("excel");
        if (isPdf) {
          // For PDF, we'll send as base64 to Gemini which can read PDFs natively
          const arrayBuffer = await fileData.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          const b64 = btoa(binary);

          await supabase.from("resume_versions").update({ ai_status: "processing" }).eq("id", resumeVersionId);

          const pdfResponse = await fetch(aiUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: aiModel,
              messages: [
                {
                  role: "system",
                  content: "请从上传的PDF简历中提取全部文本内容，保留原始格式和结构。只输出提取的文本，不要添加额外说明。",
                },
                {
                  role: "user",
                  content: [
                    { type: "file", file: { filename: "resume.pdf", file_data: `data:application/pdf;base64,${b64}` } },
                    { type: "text", text: "请提取这份PDF简历的全部文本内容。" },
                  ],
                },
              ],
            }),
          });

          if (!pdfResponse.ok) throw new Error(`PDF提取失败: ${pdfResponse.status}`);
          const pdfData = await pdfResponse.json();
          resumeText = pdfData.choices?.[0]?.message?.content || "";
        } else if (isExcel) {
          // Parse Excel with SheetJS to extract text
          const arrayBuffer = await fileData.arrayBuffer();
          const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
          const texts: string[] = [];
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            if (csv.trim()) texts.push(`=== ${sheetName} ===\n${csv}`);
          }
          resumeText = texts.join("\n\n");
        } else {
          // Word/txt: extract text directly
          resumeText = await fileData.text();
        }
      }

      if (!resumeText) throw new Error("简历内容不能为空");

      await supabase.from("resume_versions").update({ ai_status: "processing" }).eq("id", resumeVersionId);

      const response = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: aiModel,
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
        content: resumeText || content,
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
      const { resumeVersionId, bidAnalysisId, targetRole, customPrompt } = params;

      // Fetch resume and bid data
      const [{ data: resume }, { data: bid }] = await Promise.all([
        supabase.from("resume_versions").select("*, employees(*)").eq("id", resumeVersionId).single(),
        supabase.from("bid_analyses").select("*").eq("id", bidAnalysisId).single(),
      ]);

      if (!resume || !bid) throw new Error("简历或招标数据不存在");

      // Find specific role requirements if targetRole specified
      const roleReq = targetRole ? (bid.personnel_requirements as any[] || []).find((r: any) => r.role === targetRole) : null;

      await supabase.from("resume_versions").update({ ai_status: "matching" }).eq("id", resumeVersionId);

      let systemContent = `你是招投标人员配置专家。`;
      if (targetRole && roleReq) {
        systemContent += `请重点针对"${targetRole}"这一岗位的具体要求来分析候选人的匹配度。`;
      }
      systemContent += `请返回JSON：
{
  "match_score": 0-100的匹配度分数,
  "match_details": {
    "target_role": "${targetRole || "综合评估"}",
    "role_requirements_met": "针对目标岗位各项要求的逐条分析",
    "strengths": ["优势1", "优势2"],
    "weaknesses": ["不足1", "不足2"],
    "missing_keywords": ["缺失关键词1"],
    "suggested_role": "建议担任的角色",
    "improvement_suggestions": ["改进建议1"],
    "keyword_coverage": {"matched": ["已匹配关键词"], "missing": ["未匹配关键词"]},
    "experience_relevance": "经验相关性分析文字描述",
    "certification_match": "证书匹配分析文字描述",
    "overall_assessment": "总体评价文字描述（50-100字）"
  }
}`;
      if (customPrompt) {
        systemContent += `\n\n【用户自定义分析要求】\n${customPrompt}`;
      }
      systemContent += `\n请严格输出纯JSON。`;

      let userContent = `【招标要求】\n`;
      if (targetRole && roleReq) {
        userContent += `🎯 目标岗位: ${targetRole}\n`;
        userContent += `岗位详细要求: ${JSON.stringify(roleReq)}\n\n`;
      }
      userContent += `全部人员要求: ${JSON.stringify(bid.personnel_requirements)}
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
学历: ${JSON.stringify(resume.education_history)}`;

      const response = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
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
      const { resumeVersionId, bidAnalysisId, targetRole, customInstructions } = params;

      const [{ data: resume }, { data: bid }] = await Promise.all([
        supabase.from("resume_versions").select("*, employees(*)").eq("id", resumeVersionId).single(),
        bidAnalysisId && bidAnalysisId !== "none"
          ? supabase.from("bid_analyses").select("*").eq("id", bidAnalysisId).single()
          : Promise.resolve({ data: null }),
      ]);

      if (!resume) throw new Error("简历不存在");

      const roleReq = targetRole && bid ? (bid.personnel_requirements as any[] || []).find((r: any) => r.role === targetRole) : null;

      await supabase.from("resume_versions").update({ ai_status: "polishing" }).eq("id", resumeVersionId);

      let bidContext = "";
      if (bid) {
        bidContext = `\n【目标招标项目关键词】\n`;
        if (targetRole && roleReq) {
          bidContext += `🎯 目标岗位: ${targetRole}\n`;
          bidContext += `岗位要求: ${JSON.stringify(roleReq)}\n`;
        }
        bidContext += `技术关键词: ${JSON.stringify(bid.technical_keywords)}
业务关键词: ${JSON.stringify(bid.business_keywords)}
职责关键词: ${JSON.stringify(bid.responsibility_keywords)}
全部人员要求: ${JSON.stringify(bid.personnel_requirements)}\n`;
      }

      const response = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            {
              role: "system",
              content: `你是资深投标简历润色专家。你的任务是将候选人的真实简历润色为投标用简历${targetRole ? `，重点针对"${targetRole}"这一岗位` : ""}，需要：

1. **职责对齐**：将日常工作职责映射到${targetRole ? `"${targetRole}"岗位` : "招标"}要求的描述上
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

    // ---- ACTION: batch-import-excel (one Excel, multiple sheets = multiple people) ----
    if (action === "batch-import-excel") {
      const { sheetsText, userId } = params;
      if (!sheetsText || !userId) throw new Error("缺少参数");

      if (!Array.isArray(sheetsText) || sheetsText.length === 0) {
        throw new Error("Excel文件中没有有效内容");
      }

      // Build prompt with all sheets' text content
      let sheetsContent = "";
      for (const s of sheetsText) {
        sheetsContent += `\n=== Sheet: ${s.name} ===\n${s.text}\n`;
      }

      // Step 1: Ask AI to extract structured data from all sheets
      const extractResponse = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            {
              role: "system",
              content: `你是简历解析专家。你将收到一个Excel文件中多个Sheet的CSV文本内容。

**关键要求：你必须根据每个Sheet的实际格式和布局来理解数据，不要假设固定的表格结构。**

Excel的格式可能包括但不限于：
- 每行一个字段（如"姓名: 张三"）
- 表格形式（表头+数据行）
- 混合格式（部分为键值对，部分为表格）
- 一个Sheet可能包含多个区域（基本信息区、工作经历区、项目经历区等）
- 有些Sheet可能用合并单元格或空行分隔不同区域

请仔细分析每个Sheet的数据结构，智能识别各字段含义，然后提取信息。

对于每个有效的人员简历Sheet，返回以下JSON结构：
[
  {
    "sheet_name": "Sheet名称",
    "name": "姓名（必须提取到，否则跳过此Sheet）",
    "gender": "性别（男/女，无法判断则null）",
    "birth_year": 出生年份(数字或null，如1990),
    "education": "最高学历（如博士/硕士/本科/大专）",
    "major": "专业",
    "current_company": "当前/最近工作单位",
    "current_position": "当前/最近职位",
    "years_of_experience": 工作年限(数字或null，可根据最早工作时间推算),
    "certifications": ["证书1", "证书2"],
    "skills": ["技能1", "技能2"],
    "resume_text": "将该Sheet的所有信息整理为一份完整的、格式清晰的简历文本。包含：个人信息、教育背景、工作经历（含时间、公司、职位、职责）、项目经历、技能证书等。用清晰的分节和换行组织。",
    "work_experiences": [
      {"company": "公司名", "position": "职位", "start_date": "YYYY-MM", "end_date": "YYYY-MM或至今", "description": "职责描述", "is_current": false}
    ],
    "project_experiences": [
      {"project_name": "项目名", "role": "担任角色", "start_date": "YYYY-MM", "end_date": "YYYY-MM", "description": "项目描述和职责", "technologies": ["技术1"]}
    ],
    "education_history": [
      {"school": "学校名", "degree": "学历", "major": "专业", "start_date": "YYYY-MM", "end_date": "YYYY-MM"}
    ],
    "timeline_issues": [
      {"type": "overlap|gap|impossible", "description": "具体问题描述", "severity": "error|warning"}
    ]
  }
]

**重要规则：**
1. resume_text 必须是整理后的完整简历文本，不是原始CSV，要有清晰的格式和分节
2. 日期格式统一为 YYYY-MM，如果只有年份则用 YYYY-01
3. 如果某个Sheet明显不是简历（如目录、汇总表、说明页），请跳过
4. skills 应包含从工作/项目描述中提炼的技术能力和业务能力
5. certifications 应包含所有提到的资格证书、职称等
6. 即使Excel格式不规范，也要尽力提取所有可用信息
7. 请严格输出纯JSON数组，不要包含markdown标记`,
            },
            {
              role: "user",
              content: `以下是Excel文件中所有Sheet的内容（CSV格式）：\n${sheetsContent}\n\n请根据每个Sheet的实际格式，智能解析并提取每个人的完整简历信息。`,
            },
          ],
        }),
      });

      if (!extractResponse.ok) {
        const errBody = await extractResponse.text();
        console.error("AI batch-import error:", extractResponse.status, errBody);
        throw new Error(`AI解析失败: ${extractResponse.status}`);
      }
      const extractData = await extractResponse.json();
      let resultText = extractData.choices?.[0]?.message?.content || "";
      resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      let people: any[];
      try {
        people = JSON.parse(resultText);
      } catch {
        console.error("Failed to parse batch result:", resultText.slice(0, 500));
        // Try to extract JSON array from response
        const arrayMatch = resultText.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try { people = JSON.parse(arrayMatch[0]); } catch { throw new Error("AI返回格式异常，无法解析"); }
        } else {
          throw new Error("AI返回格式异常，无法解析");
        }
      }

      if (!Array.isArray(people)) people = [people];
      people = people.filter((p: any) => p && p.name);
      
      if (people.length === 0) {
        console.error("No valid people found. AI returned:", resultText.slice(0, 300));
        throw new Error("未在Excel中识别到有效简历，请确认Excel中包含人员信息");
      }

      // Step 2: Create employees and resume versions
      const created: any[] = [];
      for (const person of people) {
        if (!person.name) continue;

        // Create employee
        const { data: emp, error: empErr } = await supabase
          .from("employees")
          .insert({
            user_id: userId,
            name: person.name,
            gender: person.gender || null,
            birth_year: person.birth_year || null,
            education: person.education || null,
            major: person.major || null,
            current_company: person.current_company || null,
            current_position: person.current_position || null,
            years_of_experience: person.years_of_experience || null,
            certifications: person.certifications || [],
            skills: person.skills || [],
          })
          .select()
          .single();

        if (empErr || !emp) {
          console.error("Create employee failed:", empErr);
          continue;
        }

        // Create resume version
        const { data: rv, error: rvErr } = await supabase
          .from("resume_versions")
          .insert({
            employee_id: emp.id,
            user_id: userId,
            version_name: "导入版",
            content: person.resume_text || "",
            work_experiences: person.work_experiences || [],
            project_experiences: person.project_experiences || [],
            education_history: person.education_history || [],
            timeline_issues: person.timeline_issues || [],
            ai_status: "completed",
          })
          .select()
          .single();

        created.push({ employee: emp, resumeVersion: rv });
      }

      return new Response(JSON.stringify({ success: true, count: created.length, created }), {
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
