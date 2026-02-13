
-- 投标方案主表
CREATE TABLE public.bid_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  bid_analysis_id UUID REFERENCES public.bid_analyses(id) ON DELETE SET NULL,
  project_name TEXT NOT NULL DEFAULT '未命名投标方案',
  status TEXT NOT NULL DEFAULT 'draft',
  outline_content TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  custom_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bid_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own proposals" ON public.bid_proposals FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_bid_proposals_updated_at
  BEFORE UPDATE ON public.bid_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 投标方案章节表
CREATE TABLE public.proposal_sections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES public.bid_proposals(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.proposal_sections(id) ON DELETE CASCADE,
  section_number TEXT,
  title TEXT NOT NULL,
  content TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_type TEXT,
  source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sections" ON public.proposal_sections FOR ALL
  USING (EXISTS (SELECT 1 FROM public.bid_proposals bp WHERE bp.id = proposal_id AND bp.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bid_proposals bp WHERE bp.id = proposal_id AND bp.user_id = auth.uid()));

CREATE TRIGGER update_proposal_sections_updated_at
  BEFORE UPDATE ON public.proposal_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 证明材料检查表
CREATE TABLE public.proposal_materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES public.bid_proposals(id) ON DELETE CASCADE,
  requirement_text TEXT NOT NULL,
  requirement_type TEXT NOT NULL DEFAULT 'hard',
  material_name TEXT,
  status TEXT NOT NULL DEFAULT 'missing',
  matched_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  matched_file_path TEXT,
  notes TEXT,
  severity TEXT NOT NULL DEFAULT 'warning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own materials" ON public.proposal_materials FOR ALL
  USING (EXISTS (SELECT 1 FROM public.bid_proposals bp WHERE bp.id = proposal_id AND bp.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bid_proposals bp WHERE bp.id = proposal_id AND bp.user_id = auth.uid()));

CREATE TRIGGER update_proposal_materials_updated_at
  BEFORE UPDATE ON public.proposal_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
