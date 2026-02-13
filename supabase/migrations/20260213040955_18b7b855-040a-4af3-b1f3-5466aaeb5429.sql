
-- Bid document analysis results
CREATE TABLE public.bid_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  project_name TEXT, -- 项目名称
  
  -- Structured extraction results
  scoring_table JSONB DEFAULT '[]', -- 评分标准表 [{category, weight, criteria, evidence_required}]
  disqualification_items JSONB DEFAULT '[]', -- 废标项 [{item, source_text, severity}]
  trap_items JSONB DEFAULT '[]', -- 陷阱项 [{item, risk_level, description, suggestion}]
  
  -- Keyword factory
  technical_keywords JSONB DEFAULT '[]', -- 专业技能关键词
  business_keywords JSONB DEFAULT '[]', -- 业务技能关键词  
  responsibility_keywords JSONB DEFAULT '[]', -- 工作职责关键词
  
  -- Personnel requirements
  personnel_requirements JSONB DEFAULT '[]', -- [{role, qualifications, certifications, experience}]
  
  -- Overall analysis
  summary TEXT, -- 总体分析摘要
  risk_score INTEGER, -- 风险评分 0-100
  
  ai_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bid_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analyses"
  ON public.bid_analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON public.bid_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analyses"
  ON public.bid_analyses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses"
  ON public.bid_analyses FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all analyses"
  ON public.bid_analyses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_bid_analyses_updated_at
  BEFORE UPDATE ON public.bid_analyses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
