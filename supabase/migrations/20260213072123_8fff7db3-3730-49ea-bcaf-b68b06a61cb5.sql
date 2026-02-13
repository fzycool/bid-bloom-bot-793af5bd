
-- Table for storing holographic audit reports
CREATE TABLE public.audit_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES public.bid_proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  audit_type TEXT NOT NULL DEFAULT 'full', -- full, response, logic, semantic
  findings JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  score INTEGER, -- overall score 0-100
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own audit reports"
ON public.audit_reports
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_audit_reports_updated_at
BEFORE UPDATE ON public.audit_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
