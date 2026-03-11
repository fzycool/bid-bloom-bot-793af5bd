import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Save,
  CheckCircle,
  Eye,
  EyeOff,
  Bot,
  Zap,
  FlaskConical,
  Pencil,
} from "lucide-react";

interface ModelConfig {
  id: string;
  provider: string;
  display_name: string;
  model_name: string;
  base_url: string;
  api_key: string | null;
  is_active: boolean;
  max_tokens: number;
}

const PROVIDER_DEFAULTS: Record<string, number> = {
  lovable: 32000,
  deepseek: 8192,
  openai: 16384,
  qwen: 8192,
  zhipu: 8192,
};

const ModelManagement = () => {
  const { toast } = useToast();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [editKeys, setEditKeys] = useState<Record<string, string>>({});
  const [editMaxTokens, setEditMaxTokens] = useState<Record<string, number>>({});
  const [editBaseUrls, setEditBaseUrls] = useState<Record<string, string>>({});
  const [editModelNames, setEditModelNames] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [editingFields, setEditingFields] = useState<Record<string, boolean>>({});

  // ... keep existing code (fetchModels, useEffect, handleSaveKey, handleActivate)
  const fetchModels = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("model_config")
        .select("*")
        .order("provider");
      if (error) throw error;
      setModels((data as unknown as ModelConfig[]) || []);
      const keys: Record<string, string> = {};
      const tokens: Record<string, number> = {};
      const urls: Record<string, string> = {};
      const names: Record<string, string> = {};
      (data as unknown as ModelConfig[])?.forEach((m) => {
        keys[m.id] = m.api_key || "";
        tokens[m.id] = m.max_tokens || PROVIDER_DEFAULTS[m.provider] || 8192;
        urls[m.id] = m.base_url || "";
        names[m.id] = m.model_name || "";
      });
      setEditKeys(keys);
      setEditMaxTokens(tokens);
      setEditBaseUrls(urls);
      setEditModelNames(names);
    } catch (err: any) {
      toast({ title: "加载失败", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleSaveKey = async (model: ModelConfig) => {
    setSaving(model.id);
    try {
      const { error } = await supabase
        .from("model_config")
        .update({
          api_key: editKeys[model.id] || null,
          max_tokens: editMaxTokens[model.id] || 8192,
          base_url: editBaseUrls[model.id] || model.base_url,
          model_name: editModelNames[model.id] || model.model_name,
        } as any)
        .eq("id", model.id);
      if (error) throw error;
      toast({ title: "配置已保存" });
      setEditingFields((prev) => ({ ...prev, [model.id]: false }));
      fetchModels();
    } catch (err: any) {
      toast({ title: "保存失败", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleActivate = async (model: ModelConfig) => {
    setSaving(model.id);
    try {
      const { error: resetError } = await supabase
        .from("model_config")
        .update({ is_active: false } as any)
        .eq("is_active", true);
      if (resetError) throw resetError;
      const { error } = await supabase
        .from("model_config")
        .update({ is_active: true } as any)
        .eq("id", model.id);
      if (error) throw error;
      toast({ title: `已切换至 ${model.display_name}` });
      fetchModels();
    } catch (err: any) {
      toast({ title: "切换失败", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleTestModel = async (model: ModelConfig) => {
    const apiKey = model.provider === "lovable" ? "lovable" : editKeys[model.id];
    if (model.provider !== "lovable" && !apiKey) {
      toast({ title: "请先输入 API Key", variant: "destructive" });
      return;
    }

    setTesting(model.id);
    try {
      const { data, error } = await supabase.functions.invoke("test-model", {
        body: {
          base_url: model.base_url,
          model_name: model.model_name,
          api_key: model.provider === "lovable" ? undefined : apiKey,
          provider: model.provider,
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "✅ 连接成功",
          description: `模型 ${model.display_name} 响应正常（${data.latency_ms}ms）`,
        });
      } else {
        toast({
          title: "❌ 连接失败",
          description: data?.error || "未知错误",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "测试失败",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setTesting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">模型管理</h2>
        <p className="text-sm text-muted-foreground mt-1">
          配置AI大模型，支持国产大模型替换。激活的模型将用于所有AI功能。
        </p>
      </div>

      <div className="space-y-3">
        {models.map((m) => {
          const hasKey = m.provider === "lovable" || !!editKeys[m.id];
          return (
            <div
              key={m.id}
              className={`border rounded-lg p-4 transition-colors ${
                m.is_active ? "border-accent bg-accent/5" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-foreground text-sm">{m.display_name}</span>
                  {m.is_active && (
                    <Badge className="text-[10px] bg-accent text-accent-foreground">
                      <Zap className="w-3 h-3 mr-0.5" />
                      当前使用
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTestModel(m)}
                    disabled={testing === m.id || !hasKey}
                    className="h-7 text-xs"
                    title={!hasKey ? "请先输入 API Key" : "测试模型连接"}
                  >
                    {testing === m.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FlaskConical className="w-3 h-3 mr-1" />
                    )}
                    测试
                  </Button>
                  {!m.is_active && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleActivate(m)}
                      disabled={saving === m.id || (m.provider !== "lovable" && !editKeys[m.id])}
                    >
                      {saving === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                      激活
                    </Button>
                  )}
                </div>
              </div>

              <div className="text-xs text-muted-foreground mb-2 space-y-1.5">
                {editingFields[m.id] ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0">模型:</span>
                      <Input
                        value={editModelNames[m.id] || ""}
                        onChange={(e) => setEditModelNames((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        className="text-xs h-7 flex-1"
                        placeholder="模型名称，如 deepseek-chat"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0">接口:</span>
                      <Input
                        value={editBaseUrls[m.id] || ""}
                        onChange={(e) => setEditBaseUrls((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        className="text-xs h-7 flex-1"
                        placeholder="接口地址，如 https://api.deepseek.com/v1"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      模型: <code className="bg-muted px-1 py-0.5 rounded">{editModelNames[m.id] || m.model_name}</code>
                      {m.provider !== "lovable" && (
                        <button
                          onClick={() => setEditingFields((prev) => ({ ...prev, [m.id]: true }))}
                          className="ml-1 text-muted-foreground hover:text-foreground"
                          title="编辑模型和接口地址"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="break-all">接口: <code className="bg-muted px-1 py-0.5 rounded">{editBaseUrls[m.id] || m.base_url}</code></div>
                  </>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span>Max Tokens:</span>
                  <Input
                    type="number"
                    value={editMaxTokens[m.id] || 8192}
                    onChange={(e) => setEditMaxTokens((prev) => ({ ...prev, [m.id]: parseInt(e.target.value) || 8192 }))}
                    className="w-24 text-xs h-6 px-1.5"
                    min={1024}
                    max={128000}
                    step={1024}
                  />
                </div>
              </div>

              {m.provider !== "lovable" && (
                <div className="flex items-center gap-2 mt-3">
                  <div className="relative flex-1">
                    <Input
                      type={showKeys[m.id] ? "text" : "password"}
                      placeholder="输入 API Key"
                      value={editKeys[m.id] || ""}
                      onChange={(e) => setEditKeys((prev) => ({ ...prev, [m.id]: e.target.value }))}
                      className="pr-9 text-xs h-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeys((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKeys[m.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSaveKey(m)}
                    disabled={saving === m.id}
                    className="h-8"
                  >
                    {saving === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    保存
                  </Button>
                </div>
              )}

              {m.provider === "lovable" && (
                <p className="text-[11px] text-muted-foreground/60 mt-2 italic">
                  内置模型，无需配置 API Key
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ModelManagement;
