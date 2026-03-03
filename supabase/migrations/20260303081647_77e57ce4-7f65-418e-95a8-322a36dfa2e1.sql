
-- Create a separate table for TOC entries (标书目录), independent from proposal_sections (应答提纲)
CREATE TABLE public.proposal_toc_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES public.bid_proposals(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES public.proposal_sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text,
  section_number text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_toc_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can manage toc entries"
ON public.proposal_toc_entries
FOR ALL
USING (is_bid_member(auth.uid(), proposal_id))
WITH CHECK (is_bid_member(auth.uid(), proposal_id));

CREATE TRIGGER update_proposal_toc_entries_updated_at
BEFORE UPDATE ON public.proposal_toc_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Clean up: remove any toc_generated rows from proposal_sections
DELETE FROM public.proposal_sections WHERE source_type = 'toc_generated';
