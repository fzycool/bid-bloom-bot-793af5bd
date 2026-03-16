export interface OutlineNode {
  id: string;
  title: string;
  section_number: string | null;
  sort_order: number;
  parent_id: string | null;
  children: OutlineNode[];
  source_text?: string; // original highlighted text from document
}

export interface FlatOutlineItem {
  id: string;
  title: string;
  section_number: string | null;
  sort_order: number;
  depth: number;
  parent_id: string | null;
  has_children: boolean;
  source_text?: string;
}

export type InsertPosition = "child" | "sibling" | "before";

export type DropPosition = "before" | "after" | "inside";
