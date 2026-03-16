import { useState, useCallback } from "react";
import type { OutlineNode, FlatOutlineItem, InsertPosition } from "./types";

let nextId = 1;
const genId = () => `node_${Date.now()}_${nextId++}`;

function flattenTree(nodes: OutlineNode[], depth = 0): FlatOutlineItem[] {
  const result: FlatOutlineItem[] = [];
  const sorted = [...nodes].sort((a, b) => a.sort_order - b.sort_order);
  for (const node of sorted) {
    result.push({
      id: node.id,
      title: node.title,
      section_number: node.section_number,
      sort_order: node.sort_order,
      depth,
      parent_id: node.parent_id,
      has_children: node.children.length > 0,
      source_text: node.source_text,
    });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

function findNode(nodes: OutlineNode[], id: string): OutlineNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

function removeNode(nodes: OutlineNode[], id: string): OutlineNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

function insertNodeAt(
  nodes: OutlineNode[],
  parentId: string | null,
  newNode: OutlineNode,
  afterId?: string
): OutlineNode[] {
  if (parentId === null) {
    // Insert at root level
    const idx = afterId ? nodes.findIndex((n) => n.id === afterId) : -1;
    const copy = [...nodes];
    if (idx >= 0) {
      copy.splice(idx + 1, 0, newNode);
    } else {
      copy.push(newNode);
    }
    return reindex(copy);
  }

  return nodes.map((n) => {
    if (n.id === parentId) {
      const children = [...n.children];
      const idx = afterId ? children.findIndex((c) => c.id === afterId) : -1;
      if (idx >= 0) {
        children.splice(idx + 1, 0, newNode);
      } else {
        children.push(newNode);
      }
      return { ...n, children: reindex(children) };
    }
    return { ...n, children: insertNodeAt(n.children, parentId, newNode, afterId) };
  });
}

function reindex(nodes: OutlineNode[]): OutlineNode[] {
  return nodes.map((n, i) => ({ ...n, sort_order: i }));
}

function updateNodeTitle(nodes: OutlineNode[], id: string, title: string): OutlineNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, title };
    return { ...n, children: updateNodeTitle(n.children, id, title) };
  });
}

function autoNumber(nodes: OutlineNode[], prefix = ""): OutlineNode[] {
  const sorted = [...nodes].sort((a, b) => a.sort_order - b.sort_order);
  return sorted.map((n, i) => {
    const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    return {
      ...n,
      section_number: num,
      sort_order: i,
      children: autoNumber(n.children, num),
    };
  });
}

export function useOutlineTree() {
  const [tree, setTree] = useState<OutlineNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const flatItems = flattenTree(tree);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const addNode = useCallback(
    (title: string, position: InsertPosition = "child", sourceText?: string) => {
      const newNode: OutlineNode = {
        id: genId(),
        title,
        section_number: null,
        sort_order: 999,
        parent_id: null,
        children: [],
        source_text: sourceText,
      };

      setTree((prev) => {
        if (!selectedId || position === "child") {
          // Add as child of selected (or root if none selected)
          const parentId = position === "child" ? selectedId : null;
          newNode.parent_id = parentId;
          if (parentId) {
            setExpandedIds((e) => new Set([...e, parentId]));
          }
          return insertNodeAt(prev, parentId, newNode);
        }

        if (position === "sibling") {
          const flat = flattenTree(prev);
          const selected = flat.find((f) => f.id === selectedId);
          if (!selected) return [...prev, { ...newNode, parent_id: null }];
          newNode.parent_id = selected.parent_id;
          return insertNodeAt(prev, selected.parent_id, newNode, selectedId);
        }

        if (position === "before") {
          const flat = flattenTree(prev);
          const selected = flat.find((f) => f.id === selectedId);
          if (!selected) return [...prev, { ...newNode, parent_id: null }];
          // Find the node before selected among siblings
          newNode.parent_id = selected.parent_id;
          // Insert before = insert at same position
          const withoutNew = prev;
          // We need to find siblings and insert before
          const insertBefore = (nodes: OutlineNode[], targetParent: string | null): OutlineNode[] => {
            if (targetParent === null) {
              const idx = nodes.findIndex((n) => n.id === selectedId);
              if (idx >= 0) {
                const copy = [...nodes];
                copy.splice(idx, 0, newNode);
                return reindex(copy);
              }
              return nodes;
            }
            return nodes.map((n) => {
              if (n.id === targetParent) {
                const idx = n.children.findIndex((c) => c.id === selectedId);
                if (idx >= 0) {
                  const children = [...n.children];
                  children.splice(idx, 0, newNode);
                  return { ...n, children: reindex(children) };
                }
              }
              return { ...n, children: insertBefore(n.children, targetParent) };
            });
          };
          return insertBefore(withoutNew, selected.parent_id);
        }

        return prev;
      });

      setSelectedId(newNode.id);
      return newNode.id;
    },
    [selectedId]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setTree((prev) => removeNode(prev, id));
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId]
  );

  const renameNode = useCallback((id: string, title: string) => {
    setTree((prev) => updateNodeTitle(prev, id, title));
  }, []);

  const moveNode = useCallback(
    (sourceId: string, targetId: string, position: "before" | "after" | "inside") => {
      setTree((prev) => {
        const sourceNode = findNode(prev, sourceId);
        if (!sourceNode) return prev;

        let cleaned = removeNode(prev, sourceId);
        const targetNode = findNode(cleaned, targetId);
        if (!targetNode) return prev;

        const targetFlat = flattenTree(cleaned);
        const targetItem = targetFlat.find((f) => f.id === targetId);
        if (!targetItem) return prev;

        const movedNode = { ...sourceNode };

        if (position === "inside") {
          movedNode.parent_id = targetId;
          setExpandedIds((e) => new Set([...e, targetId]));
          return insertNodeAt(cleaned, targetId, movedNode);
        }

        movedNode.parent_id = targetItem.parent_id;
        if (position === "after") {
          return insertNodeAt(cleaned, targetItem.parent_id, movedNode, targetId);
        }

        // before
        const insertBefore = (nodes: OutlineNode[], targetParent: string | null): OutlineNode[] => {
          if (targetParent === null) {
            const idx = nodes.findIndex((n) => n.id === targetId);
            if (idx >= 0) {
              const copy = [...nodes];
              copy.splice(idx, 0, movedNode);
              return reindex(copy);
            }
            return nodes;
          }
          return nodes.map((n) => {
            if (n.id === targetParent) {
              const idx = n.children.findIndex((c) => c.id === targetId);
              if (idx >= 0) {
                const children = [...n.children];
                children.splice(idx, 0, movedNode);
                return { ...n, children: reindex(children) };
              }
            }
            return { ...n, children: insertBefore(n.children, targetParent) };
          });
        };
        return insertBefore(cleaned, targetItem.parent_id);
      });
    },
    []
  );

  const promoteNode = useCallback((id: string) => {
    setTree((prev) => {
      const flat = flattenTree(prev);
      const item = flat.find((f) => f.id === id);
      if (!item || !item.parent_id) return prev; // already root

      const node = findNode(prev, id);
      if (!node) return prev;

      const parentItem = flat.find((f) => f.id === item.parent_id);
      if (!parentItem) return prev;

      let cleaned = removeNode(prev, id);
      const movedNode = { ...node, parent_id: parentItem.parent_id };
      return insertNodeAt(cleaned, parentItem.parent_id, movedNode, item.parent_id);
    });
  }, []);

  const demoteNode = useCallback((id: string) => {
    setTree((prev) => {
      const flat = flattenTree(prev);
      const item = flat.find((f) => f.id === id);
      if (!item) return prev;

      // Find previous sibling at same level
      const siblings = flat.filter((f) => f.parent_id === item.parent_id);
      const idx = siblings.findIndex((s) => s.id === id);
      if (idx <= 0) return prev; // no previous sibling

      const prevSibling = siblings[idx - 1];
      const node = findNode(prev, id);
      if (!node) return prev;

      let cleaned = removeNode(prev, id);
      const movedNode = { ...node, parent_id: prevSibling.id };
      setExpandedIds((e) => new Set([...e, prevSibling.id]));
      return insertNodeAt(cleaned, prevSibling.id, movedNode);
    });
  }, []);

  const doAutoNumber = useCallback(() => {
    setTree((prev) => autoNumber(prev));
  }, []);

  const replaceTree = useCallback((newTree: OutlineNode[]) => {
    setTree(newTree);
  }, []);

  return {
    tree,
    flatItems,
    selectedId,
    expandedIds,
    setSelectedId,
    toggleExpand,
    addNode,
    deleteNode,
    renameNode,
    moveNode,
    promoteNode,
    demoteNode,
    doAutoNumber,
    replaceTree,
  };
}
