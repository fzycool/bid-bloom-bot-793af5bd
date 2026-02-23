
-- 移除过于宽松的 SELECT 策略，避免匿名用户读取 API Key
-- Edge functions 使用 service_role_key 会自动绕过 RLS
DROP POLICY IF EXISTS "Service role can read model config" ON public.model_config;
