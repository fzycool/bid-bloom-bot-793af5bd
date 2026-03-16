
-- Create material_folders table for directory tree structure
CREATE TABLE public.material_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id UUID REFERENCES public.material_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add folder_id to company_materials
ALTER TABLE public.company_materials ADD COLUMN folder_id UUID REFERENCES public.material_folders(id) ON DELETE SET NULL;

-- RLS for material_folders
ALTER TABLE public.material_folders ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can view folders
CREATE POLICY "Authenticated users can view folders"
  ON public.material_folders FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can insert/update/delete folders
CREATE POLICY "Admins can insert folders"
  ON public.material_folders FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update folders"
  ON public.material_folders FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete folders"
  ON public.material_folders FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Update trigger for updated_at
CREATE TRIGGER update_material_folders_updated_at
  BEFORE UPDATE ON public.material_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
