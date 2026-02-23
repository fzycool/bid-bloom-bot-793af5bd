
-- 模型配置表，存储管理员选择的AI模型和API Key
CREATE TABLE public.model_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,
  model_name text NOT NULL,
  api_key text,
  base_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  display_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.model_config ENABLE ROW LEVEL SECURITY;

-- 仅管理员可管理模型配置
CREATE POLICY "Admins can manage model config"
  ON public.model_config FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Edge functions 使用 service role 读取
CREATE POLICY "Service role can read model config"
  ON public.model_config FOR SELECT
  USING (true);

-- 更新时间触发器
CREATE TRIGGER update_model_config_updated_at
  BEFORE UPDATE ON public.model_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 预置国产大模型列表
INSERT INTO public.model_config (provider, display_name, model_name, base_url) VALUES
  ('deepseek', 'DeepSeek', 'deepseek-chat', 'https://api.deepseek.com/v1/chat/completions'),
  ('qwen', '通义千问 (Qwen)', 'qwen-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'),
  ('zhipu', '智谱清言 (GLM)', 'glm-4-flash', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'),
  ('moonshot', '月之暗面 (Kimi)', 'moonshot-v1-8k', 'https://api.moonshot.cn/v1/chat/completions'),
  ('doubao', '豆包 (Doubao)', 'doubao-1.5-pro-32k-250115', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'),
  ('baichuan', '百川 (Baichuan)', 'Baichuan4', 'https://api.baichuan-ai.com/v1/chat/completions'),
  ('spark', '讯飞星火 (Spark)', 'generalv3.5', 'https://spark-api-open.xf-yun.com/v1/chat/completions'),
  ('minimax', 'MiniMax', 'MiniMax-Text-01', 'https://api.minimax.chat/v1/text/chatcompletion_v2'),
  ('lovable', 'Lovable AI (GPT-5.2)', 'openai/gpt-5.2', 'https://ai.gateway.lovable.dev/v1/chat/completions');

-- 默认激活 Lovable AI
UPDATE public.model_config SET is_active = true WHERE provider = 'lovable';
