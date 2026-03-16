import React, { useState } from "react";
import { Wand2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { OutlineNode } from "./types";

interface AICommandInputProps {
  tree: OutlineNode[];
  onApplyChanges: (newTree: OutlineNode[]) => void;
  documentText: string;
  disabled?: boolean;
}

export default function AICommandInput({
  tree, onApplyChanges, documentText, disabled,
}: AICommandInputProps) {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!command.trim() || loading) return;
    setLoading(true);
    setError(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/outline-ai-command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          command: command.trim(),
          currentTree: tree,
          documentText: documentText.slice(0, 8000), // limit context
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `请求失败 (${response.status})`);
      }

      const data = await response.json();
      if (data.tree) {
        onApplyChanges(data.tree);
        setCommand("");
      }
    } catch (err: any) {
      setError(err.message || "AI 调整失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Wand2 className="w-3.5 h-3.5" />
        <span>AI 指令调整大纲</span>
      </div>
      <div className="flex gap-1.5">
        <Textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder='例如："在第二章后增加技术方案承诺"、"交换第四章和第五章"...'
          className="min-h-[60px] text-sm resize-none flex-1"
          disabled={loading || disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <Button
          size="sm"
          className="self-end h-8"
          onClick={handleSubmit}
          disabled={!command.trim() || loading || disabled}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[10px] text-muted-foreground">Ctrl+Enter 发送</p>
    </div>
  );
}
