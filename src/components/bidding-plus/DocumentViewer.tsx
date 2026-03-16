import React, { useState, useRef, useCallback, useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DocumentViewerProps {
  text: string;
  onAddFromSelection: (selectedText: string) => void;
}

export default function DocumentViewer({ text, onAddFromSelection }: DocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [floatingBtn, setFloatingBtn] = useState<{ x: number; y: number; text: string } | null>(null);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      // Delay hiding to allow button click
      setTimeout(() => setFloatingBtn(null), 200);
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText || !containerRef.current) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    setFloatingBtn({
      x: rect.right - containerRect.left,
      y: rect.top - containerRect.top - 36,
      text: selectedText,
    });
  }, []);

  const handleAdd = useCallback(() => {
    if (floatingBtn) {
      onAddFromSelection(floatingBtn.text);
      setFloatingBtn(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [floatingBtn, onAddFromSelection]);

  // Split text into paragraphs for better readability
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto"
      onMouseUp={handleMouseUp}
    >
      {!text ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          <p>请上传招标文件以开始</p>
        </div>
      ) : (
        <div className="p-4 space-y-3 text-sm leading-relaxed text-foreground/90 select-text">
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap">{p}</p>
          ))}
        </div>
      )}

      {/* Floating "+" button on text selection */}
      {floatingBtn && (
        <div
          className="absolute z-20 animate-in fade-in zoom-in-95 duration-150"
          style={{ left: floatingBtn.x, top: floatingBtn.y }}
        >
          <Button
            size="sm"
            className="h-7 px-2.5 shadow-lg gap-1 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
            onMouseDown={(e) => e.preventDefault()} // prevent losing selection
            onClick={handleAdd}
          >
            <Plus className="w-3.5 h-3.5" />
            添加为目录项
          </Button>
        </div>
      )}
    </div>
  );
}
