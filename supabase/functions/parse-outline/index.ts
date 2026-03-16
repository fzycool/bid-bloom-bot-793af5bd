import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 30000;
const MAX_TOTAL = 200000;

interface OutlineNode {
  id: string;
  title: string;
  section_number: string | null;
  sort_order: number;
  parent_id: string | null;
  source_text?: string;
  children: OutlineNode[];
}

/** Call AI to extract outline from a text chunk */
async function extractChunk(
  text: string,
  apiKey: string,
  customPrompt: string | undefined,
  chunkIndex: number,
  totalChunks: number,
): Promise<OutlineNode[]> {
  const chunkContext = totalChunks > 1
    ? `\n注意：这是文档的第 ${chunkIndex + 1}/${totalChunks} 部分。请只提取本部分中出现的章节。`
    : "";

  const systemPrompt = `你是投标文件大纲提取专家。用户会给你一份招标文件的内容和提取要求。
你需要**严格按照用户的提取要求**来提取大纲结构。如果用户指定了只提取某些章节，则只返回用户要求的章节，不要返回其他章节。

返回严格的JSON格式：
{
  "tree": [
    {
      "id": "new_${chunkIndex}_1",
      "title": "第一章 ...",
      "section_number": "第一章",
      "sort_order": 0,
      "parent_id": null,
      "source_text": "从原文中摘录的该章节标题原始文字",
      "children": [...]
    }
  ]
}

规则：
1. 所有新节点 id 使用 "new_${chunkIndex}_" 开头
2. 严格从文档中提取，不要虚构章节
3. 保留原始章节编号
4. 按文档中出现的顺序排列
5. 只返回JSON，不要其他内容
6. 每个节点必须包含 source_text 字段
7. 提取所有层级的标题，包括表格名称（如"XXX一览表"、"XXX概况表"、"XXX简历表"）、承诺条款（如"（一）XXX承诺"、"（二）XXX措施"）等细节项
8. 不要遗漏用户要求范围内的任何子章节、附表、承诺项等细节内容
9. **最重要：如果用户的提取要求中指定了只需要某个章节或某些章节，则只返回那些章节的大纲，忽略其他所有章节**${chunkContext}`;

  const userPrompt = `${customPrompt || "请提取文档的完整大纲结构，包括所有子章节、表格、承诺条款等细节"}\n\n--- 招标文件内容 ---\n${text}`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error("请求频率过高，请稍后重试");
    if (response.status === 402) throw new Error("额度不足，请充值");
    const t = await response.text();
    console.error(`AI error chunk ${chunkIndex}:`, response.status, t);
    throw new Error("AI 调用失败");
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`Chunk ${chunkIndex} no JSON found`);
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.tree || [];
  } catch (e) {
    console.error(`Chunk ${chunkIndex} JSON parse error:`, e);
    return [];
  }
}

/** Merge chunk results - append new chapters or merge children into existing */
function mergeChunkIntoTree(mainTree: OutlineNode[], chunkTree: OutlineNode[]): OutlineNode[] {
  for (const chunkNode of chunkTree) {
    const existing = mainTree.find(m => {
      if (m.section_number && chunkNode.section_number) {
        return m.section_number === chunkNode.section_number;
      }
      const mTitle = m.title.replace(/\s+/g, "");
      const cTitle = chunkNode.title.replace(/\s+/g, "");
      return mTitle === cTitle || (mTitle.length > 4 && cTitle.startsWith(mTitle.slice(0, 6))) || (cTitle.length > 4 && mTitle.startsWith(cTitle.slice(0, 6)));
    });

    if (existing && chunkNode.children?.length) {
      existing.children = mergeChunkIntoTree(existing.children || [], chunkNode.children);
    } else if (!existing) {
      mainTree.push(chunkNode);
    }
  }
  return mainTree;
}

/** Split text into chunks at natural boundaries */
function splitText(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + chunkSize, text.length);
    if (end < text.length) {
      const searchBack = text.substring(Math.max(pos, end - 3000), end);
      const patterns = [/\n第[一二三四五六七八九十]+章/g, /\n第[一二三四五六七八九十]+[节部分]/g];
      let bestBreak = -1;
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(searchBack)) !== null) {
          const absPos = Math.max(pos, end - 3000) + match.index;
          if (absPos > pos + chunkSize * 0.4) bestBreak = Math.max(bestBreak, absPos);
        }
      }
      if (bestBreak > pos) end = bestBreak;
    }
    chunks.push(text.substring(pos, end));
    pos = end;
  }
  return chunks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentText, customPrompt } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (!documentText || documentText.trim().length < 50) {
      throw new Error("文档内容不足，无法解析大纲");
    }

    const text = documentText.slice(0, MAX_TOTAL);
    const chunks = splitText(text, CHUNK_SIZE);
    console.log(`Document length: ${text.length}, split into ${chunks.length} chunks`);

    // Process all chunks in PARALLEL to avoid timeout
    const chunkPromises = chunks.map((chunk, i) => {
      console.log(`Starting chunk ${i + 1}/${chunks.length}, length: ${chunk.length}`);
      return extractChunk(chunk, LOVABLE_API_KEY, customPrompt, i, chunks.length)
        .catch(err => {
          console.error(`Chunk ${i} failed:`, err.message);
          return [] as OutlineNode[];
        });
    });

    const results = await Promise.all(chunkPromises);

    // Merge results in order
    let mergedTree: OutlineNode[] = [];
    for (const chunkResult of results) {
      if (mergedTree.length === 0) {
        mergedTree = chunkResult;
      } else {
        mergedTree = mergeChunkIntoTree(mergedTree, chunkResult);
      }
    }

    // Fix sort_order
    function fixSortOrder(nodes: OutlineNode[], parentId: string | null = null) {
      nodes.forEach((n, idx) => {
        n.sort_order = idx;
        n.parent_id = parentId;
        if (n.children?.length) fixSortOrder(n.children, n.id);
      });
    }
    fixSortOrder(mergedTree);

    return new Response(JSON.stringify({ tree: mergedTree }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-outline error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
