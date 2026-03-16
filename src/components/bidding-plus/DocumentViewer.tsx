import React, { useState, useRef, useCallback, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DocContent =
  | { type: "empty" }
  | { type: "loading"; progress?: string }
  | { type: "html"; html: string; plainText: string }
  | { type: "images"; pages: string[]; plainText: string }
  | { type: "pdf"; data: ArrayBuffer; plainText: string };

interface DocumentViewerProps {
  content: DocContent;
  onAddFromSelection: (selectedText: string) => void;
  highlightText?: string | null;
}

/** Renders a single PDF page: canvas + transparent text layer for selection */
function PdfPage({ pdf, pageNum }: { pdf: any; pageNum: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        const scale = 2;
        const viewport = page.getViewport({ scale });

        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";

        // Canvas layer
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (cancelled || !containerRef.current) return;
        containerRef.current.appendChild(canvas);

        // Text layer for selection
        const textContent = await page.getTextContent();
        const textDiv = document.createElement("div");
        textDiv.className = "textLayer";

        const vp1 = page.getViewport({ scale: 1 });
        textDiv.style.width = vp1.width + "px";
        textDiv.style.height = vp1.height + "px";
        textDiv.style.setProperty("--scale-factor", "1");

        if (cancelled || !containerRef.current) return;
        containerRef.current.appendChild(textDiv);

        // Use the TextLayer class from pdfjs-dist v4+
        const pdfjsLib = await import("pdfjs-dist");
        // @ts-ignore
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport: vp1,
        });
        await textLayer.render();

        // Scale the text div to match actual display size
        const adjustScale = () => {
          if (!containerRef.current || !canvas) return;
          const displayWidth = canvas.getBoundingClientRect().width;
          const ratio = displayWidth / vp1.width;
          textDiv.style.transformOrigin = "top left";
          textDiv.style.transform = `scale(${ratio})`;
        };
        adjustScale();

        const observer = new ResizeObserver(adjustScale);
        observer.observe(containerRef.current);
        (containerRef.current as any).__cleanup = () => observer.disconnect();
      } catch (err) {
        console.error(`Error rendering PDF page ${pageNum}:`, err);
      }
    })();

    return () => {
      cancelled = true;
      if (containerRef.current && (containerRef.current as any).__cleanup) {
        (containerRef.current as any).__cleanup();
      }
    };
  }, [pdf, pageNum]);

  return (
    <div
      ref={containerRef}
      className="relative border border-border rounded-sm overflow-hidden shadow-sm mb-2 select-text"
      style={{ userSelect: "text" }}
    />
  );
}

export default function DocumentViewer({ content, onAddFromSelection, highlightText }: DocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [floatingBtn, setFloatingBtn] = useState<{ x: number; y: number; text: string } | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Highlight and scroll to matching text when highlightText changes
  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous highlights
    containerRef.current.querySelectorAll(".outline-highlight").forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ""), el);
        parent.normalize();
      }
    });

    if (!highlightText?.trim()) return;
    const searchText = highlightText.trim().replace(/\s+/g, "");
    if (!searchText) return;

    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      // Collect all text nodes with their positions in concatenated string
      const walker = document.createTreeWalker(
        containerRef.current,
        NodeFilter.SHOW_TEXT,
        null
      );

      const textNodes: { node: Text; start: number; end: number }[] = [];
      let fullText = "";

      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const t = node.textContent || "";
        // Normalize: remove whitespace for matching
        const normalized = t.replace(/\s+/g, "");
        if (!normalized) continue;
        textNodes.push({ node, start: fullText.length, end: fullText.length + normalized.length });
        fullText += normalized;
      }

      // Find match in concatenated text
      const matchIdx = fullText.indexOf(searchText);
      if (matchIdx === -1) {
        // Fallback: try shorter prefix (first 10 chars)
        const shortSearch = searchText.slice(0, Math.min(10, searchText.length));
        const shortIdx = fullText.indexOf(shortSearch);
        if (shortIdx === -1) return;
        highlightRange(textNodes, shortIdx, shortIdx + shortSearch.length, containerRef.current);
        return;
      }

      highlightRange(textNodes, matchIdx, matchIdx + searchText.length, containerRef.current);
    }, 200);

    return () => clearTimeout(timer);
  }, [highlightText]);

  useEffect(() => {
    if (content.type !== "pdf") {
      setPdfDoc(null);
      setPdfPageCount(0);
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        const pdf = await pdfjsLib.getDocument({ data: content.data.slice(0) }).promise;
        if (!cancelled) {
          setPdfDoc(pdf);
          setPdfPageCount(pdf.numPages);
        }
      } catch (err) {
        console.error("Failed to load PDF:", err);
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [content]);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setTimeout(() => setFloatingBtn(null), 200);
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText || !containerRef.current) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    setFloatingBtn({
      x: Math.min(rect.right - containerRect.left, containerRect.width - 130),
      y: rect.top - containerRect.top - 36 + containerRef.current.scrollTop,
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

  if (content.type === "empty") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <p>请上传招标文件以开始</p>
      </div>
    );
  }

  if (content.type === "loading") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-3">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p>{content.progress || "正在解析文件..."}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto"
      onMouseUp={handleMouseUp}
    >
      {content.type === "html" && (
        <div
          className="p-6 select-text doc-html-content"
          dangerouslySetInnerHTML={{ __html: content.html }}
        />
      )}

      {content.type === "pdf" && pdfLoading && (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-3">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p>正在加载 PDF...</p>
        </div>
      )}

      {content.type === "pdf" && pdfDoc && (
        <div className="p-4 space-y-2">
          {Array.from({ length: pdfPageCount }, (_, i) => (
            <PdfPage key={i} pdf={pdfDoc} pageNum={i + 1} />
          ))}
        </div>
      )}

      {content.type === "images" && (
        <div className="p-4 space-y-2 select-text">
          {content.pages.map((src, i) => (
            <div key={i} className="border border-border rounded-sm overflow-hidden shadow-sm">
              <img
                src={src}
                alt={`第 ${i + 1} 页`}
                className="w-full h-auto"
                draggable={false}
              />
            </div>
          ))}
        </div>
      )}

      {floatingBtn && (
        <div
          className="absolute z-20 animate-in fade-in zoom-in-95 duration-150"
          style={{ left: floatingBtn.x, top: floatingBtn.y }}
        >
          <Button
            size="sm"
            className="h-7 px-2.5 shadow-lg gap-1 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
            onMouseDown={(e) => e.preventDefault()}
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
