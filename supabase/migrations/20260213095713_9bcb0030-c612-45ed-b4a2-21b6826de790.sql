ALTER TABLE public.bid_analyses
ADD COLUMN requires_presentation boolean DEFAULT NULL,
ADD COLUMN deposit_amount text DEFAULT NULL;