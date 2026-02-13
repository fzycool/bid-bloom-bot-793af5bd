import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  FileSearch,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Eye,
  Tag,
  Users,
  BarChart3,
  Trash2,
  Plus,
  Upload,
  FileText,
} from "lucide-react";

interface BidAnalysis {
  id: string;
  project_name: string | null;
  scoring_table: any[];
  disqualification_items: any[];
  trap_items: any[];
  technical_keywords: string[];
  business_keywords: string[];
  responsibility_keywords: string[];
  personnel_requirements: any[];
  summary: string | null;
  risk_score: number | null;
  ai_status: string;
  created_at: string;
}

export default function BidParser() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [analyses, setAnalyses] = useState<BidAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [content, setContent] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [selectedAnalysis, setSelectedAnalysis] = useState<BidAnalysis | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetchAnalyses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("bid_analyses")
      .select("*")
      .order("created_at", { ascending: false });
    setAnalyses((data as BidAnalysis[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAnalyses(); }, [fetchAnalyses]);

  const handleAnalyze = async () => {
    if (inputMode === "text" && !content.trim()) {
      toast({ title: "请粘贴招标文件内容", variant: "destructive" });
      return;
    }
    if (inputMode === "file" && !uploadedFile) {
      toast({ title: "请上传招标文件", variant: "destructive" });
      return;
    }
    if (!user) return;

    setAnalyzing(true);
    let filePath: string | undefined;

    // Upload file to storage if in file mode
    if (inputMode === "file" && uploadedFile) {
      const storagePath = `${user.id}/${Date.now()}-${uploadedFile.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("knowledge-base")
        .upload(storagePath, uploadedFile);
      if (uploadErr) {
        toast({ title: "文件上传失败", description: uploadErr.message, variant: "destructive" });
        setAnalyzing(false);
        return;
      }
      filePath = storagePath;
    }

    const { data: analysis, error: insertErr } = await supabase
      .from("bid_analyses")
      .insert({ user_id: user.id, project_name: projectName || uploadedFile?.name || "未命名项目" })
      .select()
      .single();

    if (insertErr || !analysis) {
      toast({ title: "创建失败", description: insertErr?.message, variant: "destructive" });
      setAnalyzing(false);
      return;
    }

    try {
      const body: any = {
        analysisId: analysis.id,
        projectName: projectName || uploadedFile?.name || "未命名项目",
      };
      if (filePath) {
        body.filePath = filePath;
        body.fileType = uploadedFile?.type || "";
      } else {
        body.content = content.substring(0, 30000);
      }

      const { error: fnErr } = await supabase.functions.invoke("parse-bid", { body });
      if (fnErr) throw fnErr;

      toast({ title: "解析完成", description: "招标文件已完成智能解析" });
      setContent("");
      setProjectName("");
      setUploadedFile(null);
      setShowForm(false);
      await fetchAnalyses();

      const { data: updated } = await supabase
        .from("bid_analyses")
        .select("*")
        .eq("id", analysis.id)
        .single();
      if (updated) setSelectedAnalysis(updated as BidAnalysis);
    } catch (err: any) {
      toast({ title: "解析失败", description: err.message, variant: "destructive" });
    }
    setAnalyzing(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("bid_analyses").delete().eq("id", id);
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
    if (selectedAnalysis?.id === id) setSelectedAnalysis(null);
    toast({ title: "已删除" });
  };

  const severityConfig: Record<string, { color: string; label: string }> = {
    critical: { color: "bg-red-100 text-red-800 border-red-200", label: "必废标" },
    high: { color: "bg-orange-100 text-orange-800 border-orange-200", label: "极高风险" },
    medium: { color: "bg-yellow-100 text-yellow-800 border-yellow-200", label: "较高风险" },
  };

  const riskColor = (score: number) => {
    if (score >= 70) return "text-red-600";
    if (score >= 40) return "text-orange-500";
    return "text-green-600";
  };

  if (selectedAnalysis) {
    const a = selectedAnalysis;
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => setSelectedAnalysis(null)}
              className="text-sm text-accent hover:underline mb-1"
            >
              ← 返回列表
            </button>
            <h2 className="text-xl font-bold text-foreground">{a.project_name}</h2>
            <p className="text-sm text-muted-foreground">
              解析于 {new Date(a.created_at).toLocaleString("zh-CN")}
            </p>
          </div>
          {a.risk_score !== null && (
            <div className="text-center">
              <div className={`text-3xl font-bold ${riskColor(a.risk_score)}`}>{a.risk_score}</div>
              <div className="text-xs text-muted-foreground">风险评分</div>
            </div>
          )}
        </div>

        {a.summary && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-foreground leading-relaxed">{a.summary}</p>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="disqualification">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="disqualification" className="text-xs gap-1">
              <ShieldAlert className="w-3.5 h-3.5" />
              废标项
              {a.disqualification_items?.length > 0 && (
                <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0 h-4">{a.disqualification_items.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="traps" className="text-xs gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              陷阱项
            </TabsTrigger>
            <TabsTrigger value="scoring" className="text-xs gap-1">
              <BarChart3 className="w-3.5 h-3.5" />
              评分表
            </TabsTrigger>
            <TabsTrigger value="keywords" className="text-xs gap-1">
              <Tag className="w-3.5 h-3.5" />
              关键词
            </TabsTrigger>
            <TabsTrigger value="personnel" className="text-xs gap-1">
              <Users className="w-3.5 h-3.5" />
              人员要求
            </TabsTrigger>
          </TabsList>

          {/* Disqualification items */}
          <TabsContent value="disqualification" className="space-y-3 mt-4">
            {(a.disqualification_items as any[])?.length > 0 ? (
              (a.disqualification_items as any[]).map((item: any, i: number) => {
                const sev = severityConfig[item.severity] || severityConfig.medium;
                return (
                  <Card key={i} className="border-l-4" style={{ borderLeftColor: item.severity === "critical" ? "#ef4444" : item.severity === "high" ? "#f97316" : "#eab308" }}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                            <span className="font-medium text-foreground text-sm">{item.item}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${sev.color}`}>{sev.label}</span>
                          </div>
                          {item.source_text && (
                            <p className="text-xs text-muted-foreground mt-1 bg-muted/50 p-2 rounded italic">
                              「{item.source_text}」
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            ) : (
              <p className="text-center text-muted-foreground py-8">未识别到废标项</p>
            )}
          </TabsContent>

          {/* Trap items */}
          <TabsContent value="traps" className="space-y-3 mt-4">
            {(a.trap_items as any[])?.length > 0 ? (
              (a.trap_items as any[]).map((item: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className={`w-4 h-4 ${item.risk_level === "high" ? "text-red-500" : item.risk_level === "medium" ? "text-orange-500" : "text-yellow-500"}`} />
                      <span className="font-medium text-foreground text-sm">{item.item}</span>
                      <Badge variant="outline" className="text-xs">
                        {item.risk_level === "high" ? "高风险" : item.risk_level === "medium" ? "中风险" : "低风险"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{item.description}</p>
                    {item.suggestion && (
                      <div className="text-xs bg-accent/10 text-accent-foreground p-2 rounded">
                        💡 建议: {item.suggestion}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">未识别到陷阱项</p>
            )}
          </TabsContent>

          {/* Scoring table */}
          <TabsContent value="scoring" className="mt-4">
            {(a.scoring_table as any[])?.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-3 font-medium">分类</th>
                      <th className="text-left p-3 font-medium">评分项</th>
                      <th className="text-left p-3 font-medium w-20">分值</th>
                      <th className="text-left p-3 font-medium">评分细则</th>
                      <th className="text-left p-3 font-medium">佐证材料</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a.scoring_table as any[]).map((row: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="p-3 text-xs">{row.category}</td>
                        <td className="p-3 text-xs font-medium">{row.item}</td>
                        <td className="p-3 text-xs font-bold text-accent">{row.weight}</td>
                        <td className="p-3 text-xs">{row.criteria}</td>
                        <td className="p-3 text-xs text-muted-foreground">{row.evidence_required || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">未识别到评分表</p>
            )}
          </TabsContent>

          {/* Keywords */}
          <TabsContent value="keywords" className="mt-4 space-y-6">
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                🔧 专业技能关键词
              </h4>
              <div className="flex flex-wrap gap-2">
                {(a.technical_keywords as string[])?.length > 0 ? (
                  (a.technical_keywords as string[]).map((kw: string, i: number) => (
                    <Badge key={i} className="bg-blue-100 text-blue-800 hover:bg-blue-200">{kw}</Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">无</span>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                💼 业务技能关键词
              </h4>
              <div className="flex flex-wrap gap-2">
                {(a.business_keywords as string[])?.length > 0 ? (
                  (a.business_keywords as string[]).map((kw: string, i: number) => (
                    <Badge key={i} className="bg-green-100 text-green-800 hover:bg-green-200">{kw}</Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">无</span>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                📋 工作职责关键词
              </h4>
              <div className="flex flex-wrap gap-2">
                {(a.responsibility_keywords as string[])?.length > 0 ? (
                  (a.responsibility_keywords as string[]).map((kw: string, i: number) => (
                    <Badge key={i} className="bg-purple-100 text-purple-800 hover:bg-purple-200">{kw}</Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">无</span>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Personnel */}
          <TabsContent value="personnel" className="space-y-3 mt-4">
            {(a.personnel_requirements as any[])?.length > 0 ? (
              (a.personnel_requirements as any[]).map((p: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-accent" />
                      <span className="font-medium text-foreground">{p.role}</span>
                      {p.count && <Badge variant="secondary">{p.count}人</Badge>}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {p.qualifications && (
                        <div><span className="text-muted-foreground">学历/资质: </span><span className="text-foreground">{p.qualifications}</span></div>
                      )}
                      {p.experience_years && (
                        <div><span className="text-muted-foreground">经验要求: </span><span className="text-foreground">{p.experience_years}年以上</span></div>
                      )}
                      {p.certifications?.length > 0 && (
                        <div className="sm:col-span-2">
                          <span className="text-muted-foreground">所需证书: </span>
                          {p.certifications.map((c: string, ci: number) => (
                            <Badge key={ci} variant="outline" className="text-xs mr-1 mt-1">{c}</Badge>
                          ))}
                        </div>
                      )}
                      {p.specific_requirements && (
                        <div className="sm:col-span-2"><span className="text-muted-foreground">特殊要求: </span><span className="text-foreground">{p.specific_requirements}</span></div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">未识别到人员要求</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileSearch className="w-6 h-6 text-accent" />
            招标文件解析引擎
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            像资深标书专员一样读题，自动提取评分表、废标项、陷阱项和关键词
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="w-4 h-4" />
          新建解析
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label>项目名称（可选）</Label>
              <Input
                placeholder="例如：XX市智慧城市建设项目"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>

            {/* Input mode toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setInputMode("file")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === "file"
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                <Upload className="w-4 h-4" />
                上传文件
              </button>
              <button
                onClick={() => setInputMode("text")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === "text"
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                <FileText className="w-4 h-4" />
                粘贴文本
              </button>
            </div>

            {inputMode === "file" ? (
              <div className="space-y-2">
                <Label>上传招标文件</Label>
                <div
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent/50 hover:bg-accent/5 transition-colors"
                  onClick={() => document.getElementById("bid-file-upload")?.click()}
                >
                  <input
                    type="file"
                    id="bid-file-upload"
                    className="hidden"
                    accept=".pdf,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setUploadedFile(file);
                        if (!projectName) setProjectName(file.name.replace(/\.(pdf|docx?|txt)$/i, ""));
                      }
                      e.target.value = "";
                    }}
                  />
                  {uploadedFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileText className="w-8 h-8 text-accent" />
                      <div className="text-left">
                        <p className="font-medium text-foreground">{uploadedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(uploadedFile.size / (1024 * 1024)).toFixed(2)} MB · 点击更换文件
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm font-medium text-foreground">点击上传招标文件</p>
                      <p className="text-xs text-muted-foreground mt-1">支持 PDF、Word 格式，最大 20MB</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>招标文件内容</Label>
                <Textarea
                  placeholder="请粘贴招标文件的关键内容（评分标准、资格要求、人员配置等章节）..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[200px]"
                />
                <p className="text-xs text-muted-foreground">
                  建议粘贴评分标准表、投标人资格要求、人员配置要求等核心章节，最大支持30000字
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleAnalyze} disabled={analyzing} className="gap-2">
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
                {analyzing ? "AI解析中..." : "开始解析"}
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setContent(""); setProjectName(""); setUploadedFile(null); }}>
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
      ) : analyses.length === 0 && !showForm ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileSearch className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">暂无解析记录</p>
            <p className="text-sm">点击「新建解析」粘贴招标文件内容开始</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {analyses.map((a) => (
            <Card
              key={a.id}
              className="hover:shadow-card-hover transition-shadow cursor-pointer"
              onClick={() => a.ai_status === "completed" && setSelectedAnalysis(a)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{a.project_name}</span>
                      {a.ai_status === "processing" && (
                        <Badge className="bg-blue-100 text-blue-800 gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />解析中
                        </Badge>
                      )}
                      {a.ai_status === "completed" && a.risk_score !== null && (
                        <Badge className={`${a.risk_score >= 70 ? "bg-red-100 text-red-800" : a.risk_score >= 40 ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}`}>
                          风险: {a.risk_score}
                        </Badge>
                      )}
                      {a.ai_status === "failed" && (
                        <Badge variant="destructive">解析失败</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{new Date(a.created_at).toLocaleString("zh-CN")}</span>
                      {a.ai_status === "completed" && (
                        <>
                          <span>废标项: {(a.disqualification_items as any[])?.length || 0}</span>
                          <span>陷阱项: {(a.trap_items as any[])?.length || 0}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.ai_status === "completed" && (
                      <Button variant="ghost" size="sm" className="text-xs gap-1">
                        <Eye className="w-3.5 h-3.5" />查看
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
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
