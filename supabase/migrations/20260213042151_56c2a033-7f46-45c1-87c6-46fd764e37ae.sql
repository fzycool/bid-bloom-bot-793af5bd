
-- Create employees table
CREATE TABLE public.employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  gender TEXT,
  birth_year INTEGER,
  education TEXT,
  major TEXT,
  current_company TEXT,
  current_position TEXT,
  years_of_experience INTEGER,
  certifications TEXT[] DEFAULT '{}',
  skills TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own employees"
  ON public.employees FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create resume_versions table
CREATE TABLE public.resume_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  version_name TEXT NOT NULL DEFAULT '标准版',
  target_role TEXT,
  target_industry TEXT,
  file_path TEXT,
  content TEXT,
  work_experiences JSONB DEFAULT '[]',
  project_experiences JSONB DEFAULT '[]',
  education_history JSONB DEFAULT '[]',
  timeline_issues JSONB DEFAULT '[]',
  match_score NUMERIC,
  match_details JSONB,
  polished_content TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.resume_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own resume versions"
  ON public.resume_versions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_resume_versions_updated_at
  BEFORE UPDATE ON public.resume_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
