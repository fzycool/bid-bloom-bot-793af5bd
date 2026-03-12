
-- Create techcheck_projects table
CREATE TABLE public.techcheck_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  project_name text NOT NULL DEFAULT '未命名项目',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create techcheck_files table
CREATE TABLE public.techcheck_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.techcheck_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  file_type text,
  category text NOT NULL DEFAULT 'bid_document',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.techcheck_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.techcheck_files ENABLE ROW LEVEL SECURITY;

-- RLS policies for techcheck_projects
CREATE POLICY "Users can manage own techcheck projects"
  ON public.techcheck_projects
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS policies for techcheck_files
CREATE POLICY "Users can manage own techcheck files"
  ON public.techcheck_files
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Updated_at trigger for projects
CREATE TRIGGER update_techcheck_projects_updated_at
  BEFORE UPDATE ON public.techcheck_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
