import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  GitCompare,
  Loader2,
  Upload,
  FileText,
  Trash2,
  Plus,
  Eye,
  BarChart3,
  ShieldAlert,
  Users,
  Lightbulb,
  ArrowLeft,
} from "lucide-react";

interface ComparisonRecord {
  id: string;
  title: string;
  file_names: string[];
  file_paths: string[];
  comparison_result: any;
  ai_status: string;
  created_at: string;
}

export default function BidComparison() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [records, setRecords] = useState<ComparisonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<ComparisonRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchRecords = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("bid_comparisons")
      .select("*")
      .order("created_at", { ascending: false });
    setRecords((data as any as ComparisonRecord[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleCompare = async () => {
    if (uploadedFiles.length < 2) {
      toast({ title: "请至少上传2个招标文件进行对比", variant: "destructive" });
      return;
    }
    if (!user) return;

    setAnalyzing(true);
    const filePaths: string[] = [];
    const fileNames: string[] = [];

    // Upload all files
    for (const file of uploadedFiles) {
      const fileExt = file.name.split(".").pop() || "bin";
      const safeFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${fileExt}`;
      const storagePath = `${user.id}/${safeFileName}`;
      const { error: uploadErr } = await supabase.storage
        .from("knowledge-base")
        .upload(storagePath, file);
      if (uploadErr) {
        toast({ title: `${file.name} 上传失败`, description: uploadErr.message, variant: "destructive" });
        setAnalyzing(false);
        return;
      }
      filePaths.push(storagePath);
      fileNames.push(file.name);
    }

    // Create record
    const { data: record, error: insertErr } = await supabase
      .from("bid_comparisons")
      .insert({
        user_id: user.id,
        title: title || `${fileNames.length}文件对比 · ${new Date().toLocaleDateString("zh-CN")}`,
        file_paths: filePaths,
        file_names: fileNames,
      } as any)
      .select()
      .single();

    if (insertErr || !record) {
      toast({ title: "创建失败", description: insertErr?.message, variant: "destructive" });
      setAnalyzing(false);
      return;
    }

    try {
      const { error: fnErr } = await supabase.functions.invoke("compare-bids", {
        body: {
          comparisonId: record.id,
          filePaths,
          fileNames,
        },
      });
      if (fnErr) throw fnErr;

      toast({ title: "对比分析完成" });
      setUploadedFiles([]);
      setTitle("");
      setShowForm(false);
      await fetchRecords();

      const { data: updated } = await supabase
        .from("bid_comparisons")
        .select("*")
        .eq("id", record.id)
        .single();
      if (updated) setSelectedRecord(updated as any as ComparisonRecord);
    } catch (err: any) {
      toast({ title: "分析失败", description: err.message, variant: "destructive" });
    }
    setAnalyzing(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("bid_comparisons").delete().eq("id", id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
    if (selectedRecord?.id === id) setSelectedRecord(null);
    toast({ title: "已删除" });
  };

  const priorityConfig: Record<string, { color: string; label: string }> = {
    high: { color: "bg-red-100 text-red-800", label: "高优先" },
    medium: { color: "bg-orange-100 text-orange-800", label: "中优先" },
    low: { color: "bg-green-100 text-green-800", label: "低优先" },
  };

  const riskColor = (score: number) => {
    if (score >= 70) return "text-red-600";
    if (score >= 40) return "text-orange-500";
    return "text-green-600";
  };

  // Detail view
  if (selectedRecord) {
    const r = selectedRecord;
    const result = r.comparison_result;

    if (!result) {
      return (
        <div className="space-y-4">
          <button onClick={() => setSelectedRecord(null)} className="text-sm text-accent hover:underline flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回列表
          </button>
          <p className="text-muted-foreground text-center py-12">暂无分析结果</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div>
          <button onClick={() => setSelectedRecord(null)} className="text-sm text-accent hover:underline mb-1 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回列表
          </button>
          <h2 className="text-xl font-bold text-foreground">{r.title}</h2>
          <p className="text-sm text-muted-foreground">
            对比 {r.file_names.length} 个文件 · {new Date(r.created_at).toLocaleString("zh-CN")}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {r.file_names.map((name, i) => (
              <Badge key={i} variant="outline" className="text-xs">{name}</Badge>
            ))}
          </div>
        </div>

        {/* Overview */}
        {result.overview && (
          <Card className="border-2 border-accent/30">
            <CardContent className="p-5">
              <h3 className="text-sm font-bold text-foreground mb-2">📊 对比概述</h3>
              <p className="text-sm text-foreground leading-relaxed">{result.overview}</p>
            </CardContent>
          </Card>
        )}

        {/* Document summaries */}
        {result.documents?.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.documents.map((doc: any, i: number) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <h4 className="text-sm font-bold text-foreground mb-2 truncate">{doc.file_name}</h4>
                  <p className="text-xs text-muted-foreground mb-2">{doc.project_name}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {doc.bid_deadline && (
                      <div><span className="text-muted-foreground">截止: </span><span className="text-red-600 font-medium">{doc.bid_deadline}</span></div>
                    )}
                    {doc.bid_location && (
                      <div><span className="text-muted-foreground">地点: </span><span className="text-blue-600 font-medium">{doc.bid_location}</span></div>
                    )}
                    {doc.deposit_amount && (
                      <div><span className="text-muted-foreground">保证金: </span><span className="text-amber-600 font-medium">{doc.deposit_amount}</span></div>
                    )}
                    <div>
                      <span className="text-muted-foreground">风险: </span>
                      <span className={`font-bold ${riskColor(doc.risk_score)}`}>{doc.risk_score}分</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Tabs defaultValue="scoring">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="scoring" className="text-xs gap-1">
              <BarChart3 className="w-3.5 h-3.5" /> 评分差异
            </TabsTrigger>
            <TabsTrigger value="qualification" className="text-xs gap-1">
              <ShieldAlert className="w-3.5 h-3.5" /> 资质门槛
            </TabsTrigger>
            <TabsTrigger value="personnel" className="text-xs gap-1">
              <Users className="w-3.5 h-3.5" /> 人员要求
            </TabsTrigger>
            <TabsTrigger value="risk" className="text-xs gap-1">
              <GitCompare className="w-3.5 h-3.5" /> 风险对比
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scoring" className="mt-4">
            {result.scoring_comparison?.length > 0 ? (
              <div className="space-y-3">
                {result.scoring_comparison.map((item: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <h4 className="text-sm font-semibold text-foreground mb-2">{item.dimension}</h4>
                      <div className="space-y-1.5">
                        {item.details?.map((d: any, j: number) => (
                          <div key={j} className="flex items-start gap-2 text-xs">
                            <Badge variant="outline" className="shrink-0 text-[10px]">{d.file_name}</Badge>
                            <span className="text-foreground">{d.value}</span>
                          </div>
                        ))}
                      </div>
                      {item.remark && (
                        <p className="text-xs text-accent mt-2 bg-accent/10 p-2 rounded">💡 {item.remark}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">未识别到评分差异</p>
            )}
          </TabsContent>

          <TabsContent value="qualification" className="mt-4">
            {result.qualification_comparison?.length > 0 ? (
              <div className="space-y-3">
                {result.qualification_comparison.map((item: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <h4 className="text-sm font-semibold text-foreground mb-2">{item.dimension}</h4>
                      <div className="space-y-1.5">
                        {item.details?.map((d: any, j: number) => (
                          <div key={j} className="flex items-start gap-2 text-xs">
                            <Badge variant="outline" className="shrink-0 text-[10px]">{d.file_name}</Badge>
                            <span className="text-foreground">{d.value}</span>
                          </div>
                        ))}
                      </div>
                      {item.risk_note && (
                        <p className="text-xs text-red-600 mt-2 bg-red-50 p-2 rounded">⚠️ {item.risk_note}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">未识别到资质门槛差异</p>
            )}
          </TabsContent>

          <TabsContent value="personnel" className="mt-4">
            {result.personnel_comparison?.length > 0 ? (
              <div className="space-y-3">
                {result.personnel_comparison.map((item: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Users className="w-4 h-4 text-accent" /> {item.role}
                      </h4>
                      <div className="space-y-1.5">
                        {item.details?.map((d: any, j: number) => (
                          <div key={j} className="flex items-start gap-2 text-xs">
                            <Badge variant="outline" className="shrink-0 text-[10px]">{d.file_name}</Badge>
                            <span className="text-foreground">{d.requirement}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">未识别到人员要求差异</p>
            )}
          </TabsContent>

          <TabsContent value="risk" className="mt-4">
            {result.risk_comparison?.length > 0 ? (
              <div className="space-y-4">
                {result.risk_comparison.map((group: any, i: number) => (
                  <Card key={i}>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold">{group.category}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2">
                      {group.items?.map((item: any, j: number) => (
                        <div key={j} className="flex items-start gap-2 text-xs border-b border-border pb-2 last:border-0">
                          <Badge variant="outline" className="shrink-0 text-[10px]">{item.file_name}</Badge>
                          <span className="text-foreground flex-1">{item.content}</span>
                          {item.severity && (
                            <Badge className={`text-[10px] shrink-0 ${
                              item.severity === "critical" ? "bg-red-100 text-red-800" :
                              item.severity === "high" ? "bg-orange-100 text-orange-800" : "bg-yellow-100 text-yellow-800"
                            }`}>{item.severity}</Badge>
                          )}
                        </div>
                      ))}
                      {group.summary && (
                        <p className="text-xs text-muted-foreground mt-2 italic">{group.summary}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">未识别到风险差异</p>
            )}
          </TabsContent>
        </Tabs>

        {/* Recommendations */}
        {result.recommendations?.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500" /> 投标策略建议
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {result.recommendations.map((rec: any, i: number) => {
                const p = priorityConfig[rec.priority] || priorityConfig.medium;
                return (
                  <div key={i} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <Badge className={`shrink-0 text-[10px] ${p.color}`}>{p.label}</Badge>
                    <div>
                      <span className="text-sm font-medium text-foreground">{rec.title}</span>
                      <p className="text-xs text-muted-foreground mt-1">{rec.content}</p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <GitCompare className="w-6 h-6 text-accent" />
            招标文件差异对比
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            上传多个招标文件，AI全面分析评分标准、资质门槛、人员要求等差异
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="w-4 h-4" />
          新建对比
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label>对比标题（可选）</Label>
              <Input
                placeholder="例如：XX项目各包对比分析"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>上传招标文件（至少2个）</Label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    const newFiles = Array.from(files);
                    const docFiles = newFiles.filter(f => f.name.toLowerCase().endsWith('.doc') && !f.name.toLowerCase().endsWith('.docx'));
                    if (docFiles.length > 0) {
                      toast({ title: "不支持 .doc 格式", description: "请将 .doc 文件转换为 .docx 或 .pdf 后再上传", variant: "destructive" });
                    }
                    const validFiles = newFiles.filter(f => !f.name.toLowerCase().endsWith('.doc') || f.name.toLowerCase().endsWith('.docx'));
                    if (validFiles.length > 0) {
                      setTimeout(() => {
                        setUploadedFiles((prev) => [...prev, ...validFiles]);
                      }, 50);
                    }
                  }
                  e.target.value = "";
                }}
              />
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent/50 hover:bg-accent/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadedFiles.length > 0 ? (
                  <div className="space-y-2">
                    {uploadedFiles.map((file, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 bg-muted/50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-5 h-5 text-accent shrink-0" />
                          <div className="text-left min-w-0">
                            <p className="font-medium text-foreground text-sm truncate">{file.name}</p>
                            <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setUploadedFiles((prev) => prev.filter((_, idx) => idx !== i)); }}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground mt-2">点击继续添加更多文件</p>
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium text-foreground">点击上传招标文件</p>
                    <p className="text-xs text-muted-foreground mt-1">支持 PDF、Word 格式，至少2个文件</p>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleCompare} disabled={analyzing || uploadedFiles.length < 2} className="gap-2">
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
                {analyzing ? "AI分析中..." : "开始对比分析"}
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setUploadedFiles([]); setTitle(""); }}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      ) : records.length === 0 && !showForm ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <GitCompare className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">暂无对比记录</p>
            <p className="text-sm">点击「新建对比」上传多个招标文件进行差异分析</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {records.map((r) => (
            <Card
              key={r.id}
              className="hover:shadow-card-hover transition-shadow cursor-pointer"
              onClick={() => r.ai_status === "completed" && setSelectedRecord(r)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground text-sm break-all">{r.title}</span>
                    <div className="flex flex-col gap-1 mt-2">
                      {r.file_names.map((name, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          {i > 0 && (
                            <span className="text-accent font-bold text-[11px] shrink-0 leading-5">VS</span>
                          )}
                          <Badge variant="secondary" className="text-[10px] font-semibold whitespace-normal break-all leading-4 py-1">{name}</Badge>
                        </div>
                      ))}
                    </div>
                    <span className="text-[11px] text-muted-foreground mt-1.5 block">
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.ai_status === "processing" && (
                      <Badge className="bg-blue-100 text-blue-800 gap-1 whitespace-nowrap">
                        <Loader2 className="w-3 h-3 animate-spin" />分析中
                      </Badge>
                    )}
                    {r.ai_status === "completed" && (
                      <Button variant="ghost" size="sm" className="text-xs gap-1 shrink-0">
                        <Eye className="w-3.5 h-3.5" />查看
                      </Button>
                    )}
                    {r.ai_status === "failed" && (
                      <Badge variant="destructive" className="whitespace-nowrap">分析失败</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
