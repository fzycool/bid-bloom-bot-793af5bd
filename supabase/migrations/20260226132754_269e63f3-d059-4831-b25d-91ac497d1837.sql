
-- Add columns to track proposal document generation status
ALTER TABLE public.bid_proposals
  ADD COLUMN IF NOT EXISTS proposal_doc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS proposal_doc_progress text;
