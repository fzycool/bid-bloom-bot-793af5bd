ALTER TABLE public.bid_analyses
ADD COLUMN bid_deadline timestamp with time zone DEFAULT NULL,
ADD COLUMN bid_location text DEFAULT NULL;