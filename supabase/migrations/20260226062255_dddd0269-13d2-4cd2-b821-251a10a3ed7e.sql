
-- Create table for contract revisions
CREATE TABLE public.contract_revisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  original_file_path TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  revised_file_path TEXT,
  revision_instructions TEXT NOT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  ai_result JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contract_revisions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own revisions" ON public.contract_revisions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own revisions" ON public.contract_revisions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own revisions" ON public.contract_revisions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own revisions" ON public.contract_revisions
  FOR DELETE USING (auth.uid() = user_id);

-- Timestamp trigger
CREATE TRIGGER update_contract_revisions_updated_at
  BEFORE UPDATE ON public.contract_revisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for contract files
INSERT INTO storage.buckets (id, name, public) VALUES ('contract-files', 'contract-files', false);

-- Storage RLS policies
CREATE POLICY "Users can upload contract files" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'contract-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view own contract files" ON storage.objects
  FOR SELECT USING (bucket_id = 'contract-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own contract files" ON storage.objects
  FOR DELETE USING (bucket_id = 'contract-files' AND auth.uid()::text = (storage.foldername(name))[1]);
