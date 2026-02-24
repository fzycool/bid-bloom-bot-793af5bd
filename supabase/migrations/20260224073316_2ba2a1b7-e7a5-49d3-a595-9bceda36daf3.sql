
ALTER TABLE public.bid_proposals 
ADD COLUMN IF NOT EXISTS token_usage jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ai_progress text DEFAULT NULL;
