-- Create table for bid comparison analyses
CREATE TABLE public.bid_comparisons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT '未命名对比分析',
  file_paths TEXT[] NOT NULL DEFAULT '{}',
  file_names TEXT[] NOT NULL DEFAULT '{}',
  comparison_result JSONB DEFAULT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.bid_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own comparisons"
  ON public.bid_comparisons FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own comparisons"
  ON public.bid_comparisons FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own comparisons"
  ON public.bid_comparisons FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own comparisons"
  ON public.bid_comparisons FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all comparisons"
  ON public.bid_comparisons FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_bid_comparisons_updated_at
  BEFORE UPDATE ON public.bid_comparisons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();