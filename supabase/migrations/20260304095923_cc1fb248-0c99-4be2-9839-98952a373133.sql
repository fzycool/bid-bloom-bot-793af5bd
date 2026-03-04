
-- Create resume_templates table
CREATE TABLE public.resume_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  template_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_type TEXT,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.resume_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own templates" ON public.resume_templates FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own templates" ON public.resume_templates FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own templates" ON public.resume_templates FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own templates" ON public.resume_templates FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all templates" ON public.resume_templates FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_resume_templates_updated_at BEFORE UPDATE ON public.resume_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Storage bucket for resume templates
INSERT INTO storage.buckets (id, name, public) VALUES ('resume-templates', 'resume-templates', false);

-- Storage RLS policies
CREATE POLICY "Users can upload resume templates" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'resume-templates' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can view own resume templates" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'resume-templates' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can delete own resume templates" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'resume-templates' AND (storage.foldername(name))[1] = auth.uid()::text);
