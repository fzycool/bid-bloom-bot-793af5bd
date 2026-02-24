-- Add max_tokens column to model_config with sensible defaults
ALTER TABLE public.model_config ADD COLUMN max_tokens integer NOT NULL DEFAULT 8192;

-- Update existing rows with appropriate defaults based on provider
UPDATE public.model_config SET max_tokens = 32000 WHERE provider = 'lovable';
UPDATE public.model_config SET max_tokens = 8192 WHERE provider = 'deepseek';
UPDATE public.model_config SET max_tokens = 8192 WHERE provider NOT IN ('lovable', 'deepseek');