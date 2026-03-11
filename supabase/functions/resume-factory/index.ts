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
    const configMaxTokens = modelConfig?.max_tokens || (isLovable ? 32000 : 8192);

    function sanitizeTools(tools: any[]) {
      if (isLovable) return tools;
      return JSON.parse(JSON.stringify(tools), (key, value) => {
        if (key === "additionalProperties" || key === "nullable") return undefined;
        return value;
      });
    }

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

    // ---- ACTION: generate-resume-docx (fill template with polished content) ----
    if (action === "generate-resume-docx") {
      const { resumeVersionId, templateFilePath, employeeName } = params;
      if (!resumeVersionId || !templateFilePath) throw new Error("缺少参数");

      // Fetch resume version with employee info
      const { data: resume, error: rvErr } = await supabase
        .from("resume_versions")
        .select("*, employees(*)")
        .eq("id", resumeVersionId)
        .single();
      if (rvErr || !resume) throw new Error("简历版本不存在");
      if (!resume.polished_content) throw new Error("请先完成简历润色");

      // Download the template DOCX
      const { data: templateFile, error: dlErr } = await supabase.storage
        .from("resume-templates")
        .download(templateFilePath);
      if (dlErr || !templateFile) throw new Error(`模板下载失败: ${dlErr?.message || "unknown"}`);

      // Convert template to base64
      const templateBuffer = await templateFile.arrayBuffer();
      const templateUint8 = new Uint8Array(templateBuffer);
      let templateB64 = "";
      for (let i = 0; i < templateUint8.length; i++) {
        templateB64 += String.fromCharCode(templateUint8[i]);
      }
      templateB64 = btoa(templateB64);

      // Use AI to generate the filled DOCX content as structured JSON
      const emp = (resume as any).employees || {};
      const polishedContent = resume.polished_content;

      const aiResponse = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: aiModel,
          ...(aiModel.startsWith("openai/") || aiModel.includes("gpt-") ? { max_completion_tokens: configMaxTokens } : { max_tokens: configMaxTokens }),
          messages: [
            {
              role: "system",
              content: `你是一个专业的简历排版专家。你将收到一份Word简历模板文件和一份润色后的简历内容。

你的任务是：
1. 仔细分析Word模板的结构、格式和布局（表格结构、字段位置等）
2. 将润色后的简历内容严格按照模板的格式和结构填入
3. 输出一个JSON对象，描述如何填充模板

请返回JSON格式：
{
  "sections": [
    {
      "field": "模板中的字段名/位置描述",
      "content": "应填入的内容"
    }
  ],
  "full_text": "按照模板格式排列好的完整简历文本（使用markdown格式，包含表格如果模板是表格形式）"
}

重要：
- 必须严格遵循模板的格式和结构
- 如果模板是表格形式，full_text中使用markdown表格
- 保留模板中的所有分节和标题格式
- 不要遗漏任何简历信息
- 请严格输出纯JSON`,
            },
            {
              role: "user",
              content: [
                {
                  type: "file",
                  file: {
                    filename: "template.docx",
                    file_data: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${templateB64}`,
                  },
                },
                {
                  type: "text",
                  text: `请将以下润色后的简历内容按照模板格式填入：

【人员基本信息】
姓名: ${emp.name || employeeName}
性别: ${emp.gender || ""}
学历: ${emp.education || ""} ${emp.major || ""}
公司: ${emp.current_company || ""}
职位: ${emp.current_position || ""}
工作年限: ${emp.years_of_experience || ""}年
证书: ${(emp.certifications || []).join("、")}
技能: ${(emp.skills || []).join("、")}

【润色后的简历全文】
${polishedContent}

【结构化工作经历】
${JSON.stringify(resume.work_experiences || [], null, 2)}

【结构化项目经验】
${JSON.stringify(resume.project_experiences || [], null, 2)}

【结构化教育背景】
${JSON.stringify(resume.education_history || [], null, 2)}`,
                },
              ],
            },
          ],
        }),
      });

      if (!aiResponse.ok) {
        const errBody = await aiResponse.text();
        console.error("AI generate-resume error:", aiResponse.status, errBody);
        throw new Error(`AI生成失败: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      let aiText = aiData.choices?.[0]?.message?.content || "";
      aiText = aiText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      let fillResult: any;
      try {
        fillResult = JSON.parse(aiText);
      } catch {
        // If JSON parsing fails, use the text as full_text
        fillResult = { full_text: aiText };
      }

      // Now use AI to generate the actual DOCX by modifying the template
      // Since we can't use docx library in Deno easily, we'll ask AI to generate a filled version
      const generateResponse = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: aiModel,
          ...(aiModel.startsWith("openai/") || aiModel.includes("gpt-") ? { max_completion_tokens: configMaxTokens } : { max_tokens: configMaxTokens }),
          messages: [
            {
              role: "system",
              content: `你是文档生成专家。请根据模板和填充内容，生成完整的简历文本。
输出格式为纯文本，使用清晰的排版格式（标题、分节、表格等），方便用户直接复制到Word中。
严格按照模板的结构和格式来组织内容。`,
            },
            {
              role: "user",
              content: [
                {
                  type: "file",
                  file: {
                    filename: "template.docx",
                    file_data: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${templateB64}`,
                  },
                },
                {
                  type: "text",
                  text: `请严格按照这份Word模板的格式，将以下内容填入模板，生成完整的简历：\n\n${fillResult.full_text || polishedContent}`,
                },
              ],
            },
          ],
        }),
      });

      if (!generateResponse.ok) throw new Error(`AI最终生成失败: ${generateResponse.status}`);

      const genData = await generateResponse.json();
      const finalText = genData.choices?.[0]?.message?.content || fillResult.full_text || polishedContent;

      // Store the generated resume text as a file
      const outputPath = `${resume.user_id}/generated/${Date.now()}_${employeeName || "resume"}.txt`;
      const textBlob = new Blob([finalText], { type: "text/plain;charset=utf-8" });
      const { error: uploadErr } = await supabase.storage
        .from("resume-templates")
        .upload(outputPath, textBlob, { contentType: "text/plain; charset=utf-8" });
      if (uploadErr) throw new Error(`保存失败: ${uploadErr.message}`);

      // Create a signed URL for download
      const { data: signedData, error: signErr } = await supabase.storage
        .from("resume-templates")
        .createSignedUrl(outputPath, 300);
      if (signErr || !signedData?.signedUrl) throw new Error("获取下载链接失败");

      return new Response(JSON.stringify({
        success: true,
        signedUrl: signedData.signedUrl,
        content: finalText,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- ACTION: import-from-chapters (auto-import resumes from bid document chapters) ----
    if (action === "import-from-chapters") {
      const { userId, chapters } = params;
      // chapters: Array<{ section_number: string, title: string, content: string }>
      if (!userId || !chapters?.length) throw new Error("userId and chapters are required");

      const maxTokens = Math.min(configMaxTokens, 16000);

      const results: Array<{ name: string; action: "created" | "merged"; employeeId: string }> = [];

      for (const chapter of chapters) {
        const chapterText = (chapter.content || "").substring(0, 8000);
        if (chapterText.length < 50) continue;

        // Use AI to extract structured employee info
        const parsePrompt = `你是一位资深HR顾问。请从以下标书章节中提取人员简历信息。
如果该章节包含多个人员简历，请分别提取每个人的信息。
如果该章节不是人员简历（而是其他标书内容），请返回 {"resumes": []}。

请以JSON格式返回：
{
  "resumes": [
    {
      "name": "姓名",
      "gender": "性别(男/女/null)",
      "birth_year": 出生年份数字或null,
      "education": "最高学历",
      "major": "专业",
      "current_company": "当前单位",
      "current_position": "当前职位",
      "years_of_experience": 工作年限数字或null,
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
      ]
    }
  ]
}
请严格输出纯JSON，不要包含markdown标记。`;

        const requestBody: any = {
          model: aiModel,
          messages: [
            { role: "system", content: parsePrompt },
            { role: "user", content: `章节标题：${chapter.section_number} ${chapter.title}\n\n章节内容：\n${chapterText}` },
          ],
          temperature: 0.1,
        };
        if (aiModel.startsWith("openai/") || aiModel.includes("gpt-")) {
          requestBody.max_completion_tokens = maxTokens;
        } else {
          requestBody.max_tokens = maxTokens;
        }

        const response = await fetch(aiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          console.error(`AI error for chapter "${chapter.title}":`, response.status);
          continue;
        }

        const data = await response.json();
        let resultText = data.choices?.[0]?.message?.content || "";
        resultText = resultText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        let parsed;
        try {
          parsed = JSON.parse(resultText);
        } catch {
          console.error("Failed to parse AI response for chapter:", chapter.title);
          continue;
        }

        const resumes = parsed.resumes || (parsed.name ? [parsed] : []);
        if (!resumes.length) continue;

        for (const resume of resumes) {
          if (!resume.name || resume.name.length < 1) continue;

          // Check if employee with same name already exists for this user
          const { data: existing } = await supabase
            .from("employees")
            .select("id, certifications, skills")
            .eq("user_id", userId)
            .eq("name", resume.name)
            .maybeSingle();

          if (existing) {
            // ── Merge: update employee with new data, combining arrays ──
            const mergedCerts = [...new Set([
              ...(existing.certifications || []),
              ...(resume.certifications || []),
            ])];
            const mergedSkills = [...new Set([
              ...(existing.skills || []),
              ...(resume.skills || []),
            ])];

            await supabase.from("employees").update({
              gender: resume.gender || undefined,
              birth_year: resume.birth_year || undefined,
              education: resume.education || undefined,
              major: resume.major || undefined,
              current_company: resume.current_company || undefined,
              current_position: resume.current_position || undefined,
              years_of_experience: resume.years_of_experience || undefined,
              certifications: mergedCerts,
              skills: mergedSkills,
            }).eq("id", existing.id);

            // Update existing resume version or create new one
            const { data: existingVersion } = await supabase
              .from("resume_versions")
              .select("id, work_experiences, project_experiences, education_history")
              .eq("employee_id", existing.id)
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (existingVersion) {
              // Merge experiences
              const mergedWork = mergeExperiences(
                existingVersion.work_experiences || [],
                resume.work_experiences || [],
                "company"
              );
              const mergedProjects = mergeExperiences(
                existingVersion.project_experiences || [],
                resume.project_experiences || [],
                "project_name"
              );
              const mergedEdu = mergeExperiences(
                existingVersion.education_history || [],
                resume.education_history || [],
                "school"
              );

              await supabase.from("resume_versions").update({
                work_experiences: mergedWork,
                project_experiences: mergedProjects,
                education_history: mergedEdu,
                content: chapterText,
                ai_status: "completed",
              }).eq("id", existingVersion.id);
            } else {
              await supabase.from("resume_versions").insert({
                employee_id: existing.id,
                user_id: userId,
                version_name: "标书导入版",
                content: chapterText,
                work_experiences: resume.work_experiences || [],
                project_experiences: resume.project_experiences || [],
                education_history: resume.education_history || [],
                ai_status: "completed",
              });
            }

            results.push({ name: resume.name, action: "merged", employeeId: existing.id });
          } else {
            // ── Create new employee + resume version ──
            const { data: newEmp, error: empErr } = await supabase
              .from("employees")
              .insert({
                user_id: userId,
                name: resume.name,
                gender: resume.gender || null,
                birth_year: resume.birth_year || null,
                education: resume.education || null,
                major: resume.major || null,
                current_company: resume.current_company || null,
                current_position: resume.current_position || null,
                years_of_experience: resume.years_of_experience || null,
                certifications: resume.certifications || [],
                skills: resume.skills || [],
              })
              .select("id")
              .single();

            if (empErr || !newEmp) {
              console.error("Failed to create employee:", resume.name, empErr);
              continue;
            }

            await supabase.from("resume_versions").insert({
              employee_id: newEmp.id,
              user_id: userId,
              version_name: "标书导入版",
              content: chapterText,
              work_experiences: resume.work_experiences || [],
              project_experiences: resume.project_experiences || [],
              education_history: resume.education_history || [],
              ai_status: "completed",
            });

            results.push({ name: resume.name, action: "created", employeeId: newEmp.id });
          }
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
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
