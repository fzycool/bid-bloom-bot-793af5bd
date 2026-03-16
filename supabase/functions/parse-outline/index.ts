import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 25000; // characters per chunk
const MAX_TOTAL = 200000; // max total characters to process

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
  existingSummary: string
): Promise<OutlineNode[]> {
  const chunkContext = totalChunks > 1
    ? `\n\n注意：这是文档的第 ${chunkIndex + 1}/${totalChunks} 部分。${existingSummary ? `前面部分已提取的章节概要：${existingSummary}` : ""}
请只提取本部分中出现的新章节，不要重复已提取的章节。如果某个章节在前面已出现，只提取其中新出现的子节点。`
    : "";

  const systemPrompt = `你是投标文件大纲提取专家。用户会给你一份招标文件的内容和提取要求。
你需要根据文件内容提取出完整的投标文件大纲结构。

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
      "children": [
        {
          "id": "new_${chunkIndex}_1_1",
          "title": "1.1 ...",
          "section_number": "1.1",
          "sort_order": 0,
          "parent_id": "new_${chunkIndex}_1",
          "source_text": "从原文中摘录的该小节标题原始文字",
          "children": []
        }
      ]
    }
  ]
}

规则：
1. 所有新节点 id 使用 "new_${chunkIndex}_" 开头
2. 严格从文档中提取，不要虚构章节
3. 保留原始章节编号
4. 按文档中出现的顺序排列
5. 只返回JSON，不要其他内容
6. 每个节点必须包含 source_text 字段，值为该章节标题在原文中的原始文字
7. 提取所有层级的标题，包括表格名称（如"XXX一览表"、"XXX概况表"、"XXX简历表"）、承诺条款（如"（一）XXX承诺"、"（二）XXX措施"）等细节项
8. 不要遗漏任何子章节、附表、承诺项等细节内容${chunkContext}`;

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
    console.error(`Chunk ${chunkIndex} no JSON found in:`, content.slice(0, 500));
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

/** Summarize existing tree for context in next chunk */
function summarizeTree(nodes: OutlineNode[]): string {
  const titles: string[] = [];
  function walk(list: OutlineNode[], depth: number) {
    for (const n of list) {
      titles.push(`${"  ".repeat(depth)}${n.section_number || ""} ${n.title}`);
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(nodes, 0);
  return titles.slice(0, 60).join("\n"); // limit summary size
}

/** Merge chunk results into main tree - append new chapters or merge children into existing ones */
function mergeChunkIntoTree(mainTree: OutlineNode[], chunkTree: OutlineNode[]): OutlineNode[] {
  for (const chunkNode of chunkTree) {
    // Try to find matching chapter in main tree by section_number or similar title
    const existing = mainTree.find(m => {
      if (m.section_number && chunkNode.section_number) {
        return m.section_number === chunkNode.section_number;
      }
      // Match by title prefix (e.g., "第六章" in both)
      const mTitle = m.title.replace(/\s+/g, "");
      const cTitle = chunkNode.title.replace(/\s+/g, "");
      return mTitle === cTitle || mTitle.startsWith(cTitle.slice(0, 6)) || cTitle.startsWith(mTitle.slice(0, 6));
    });

    if (existing && chunkNode.children?.length) {
      // Merge children
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
    // Try to break at a chapter/section boundary
    if (end < text.length) {
      const searchBack = text.substring(end - 2000, end);
      // Look for chapter headers to break at
      const patterns = [/\n第[一二三四五六七八九十]+章/g, /\n\d+\.\s/g, /\n第[一二三四五六七八九十]+[节部分]/g];
      let bestBreak = -1;
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(searchBack)) !== null) {
          bestBreak = Math.max(bestBreak, end - 2000 + match.index);
        }
      }
      if (bestBreak > pos + chunkSize * 0.5) {
        end = bestBreak;
      }
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

    let mergedTree: OutlineNode[] = [];

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}, length: ${chunks[i].length}`);
      const summary = i > 0 ? summarizeTree(mergedTree) : "";
      const chunkResult = await extractChunk(chunks[i], LOVABLE_API_KEY, customPrompt, i, chunks.length, summary);

      if (i === 0) {
        mergedTree = chunkResult;
      } else {
        mergedTree = mergeChunkIntoTree(mergedTree, chunkResult);
      }
    }

    // Re-assign sort_order
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
