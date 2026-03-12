import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ClipboardList,
  FileDown,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Save,
  FolderOpen,
  Clock,
  Upload,
  BookTemplate,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

interface CheckItem {
  id: string;
  category: string;
  title: string;
  description: string;
  status: "unchecked" | "pass" | "fail" | "warning";
  notes: string;
  severity: "critical" | "major" | "minor";
}

interface CheckList {
  id: string;
  name: string;
  projectName: string;
  items: CheckItem[];
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_CATEGORIES = [
  "格式规范",
  "封面与目录",
  "资质证明",
  "人员配置",
  "技术方案",
  "报价部分",
  "承诺函件",
  "附件材料",
];

const DEFAULT_CHECK_ITEMS: Omit<CheckItem, "id">[] = [
  { category: "格式规范", title: "页码连续且正确", description: "检查全文页码是否连续，目录页码与实际页码是否一致", status: "unchecked", notes: "", severity: "major" },
  { category: "格式规范", title: "字体字号统一", description: "正文、标题、表格等字体字号是否符合招标文件要求", status: "unchecked", notes: "", severity: "minor" },
  { category: "格式规范", title: "装订顺序正确", description: "各章节装订顺序是否与目录一致", status: "unchecked", notes: "", severity: "major" },
  { category: "封面与目录", title: "封面信息完整", description: "项目名称、投标人名称、日期、联系方式等是否齐全且正确", status: "unchecked", notes: "", severity: "critical" },
  { category: "封面与目录", title: "目录与正文对应", description: "目录标题与正文章节标题是否完全一致", status: "unchecked", notes: "", severity: "major" },
  { category: "资质证明", title: "营业执照在有效期内", description: "营业执照是否在有效期内，经营范围是否覆盖本项目", status: "unchecked", notes: "", severity: "critical" },
  { category: "资质证明", title: "资质等级满足要求", description: "相关资质证书等级是否满足招标文件最低要求", status: "unchecked", notes: "", severity: "critical" },
  { category: "资质证明", title: "业绩证明材料齐全", description: "类似项目业绩的合同、验收报告是否齐全", status: "unchecked", notes: "", severity: "major" },
  { category: "人员配置", title: "项目经理资格达标", description: "项目经理学历、证书、工作年限是否满足招标要求", status: "unchecked", notes: "", severity: "critical" },
  { category: "人员配置", title: "人员数量满足要求", description: "各岗位人员配置数量是否达到招标文件最低要求", status: "unchecked", notes: "", severity: "major" },
  { category: "人员配置", title: "简历信息一致", description: "简历中的姓名、证书编号与正文引用是否一致", status: "unchecked", notes: "", severity: "major" },
  { category: "技术方案", title: "响应招标技术要求", description: "技术方案是否逐条响应了招标文件的技术参数要求", status: "unchecked", notes: "", severity: "critical" },
  { category: "技术方案", title: "实施计划合理", description: "项目实施进度计划是否合理，关键节点是否明确", status: "unchecked", notes: "", severity: "major" },
  { category: "技术方案", title: "无敏感信息泄露", description: "是否含有其他项目名称、甲方名称等敏感信息", status: "unchecked", notes: "", severity: "critical" },
  { category: "报价部分", title: "报价金额一致", description: "大小写金额是否一致，分项合计是否等于总价", status: "unchecked", notes: "", severity: "critical" },
  { category: "报价部分", title: "报价格式正确", description: "报价表格式是否按招标文件要求填写", status: "unchecked", notes: "", severity: "major" },
  { category: "承诺函件", title: "法人授权书齐全", description: "法人授权委托书是否签字盖章，授权人信息是否正确", status: "unchecked", notes: "", severity: "critical" },
  { category: "承诺函件", title: "各类承诺函签章完整", description: "廉洁承诺、服务承诺等是否全部签字盖章", status: "unchecked", notes: "", severity: "critical" },
  { category: "附件材料", title: "所有附件齐全", description: "招标文件要求的所有附件是否全部提供", status: "unchecked", notes: "", severity: "major" },
  { category: "附件材料", title: "扫描件清晰可辨", description: "资质证书、业绩证明等扫描件是否清晰可辨认", status: "unchecked", notes: "", severity: "minor" },
];

// V2.0 专业技术标质量检查模板 - 基于实际行业标准
const V2_TEMPLATE_ITEMS: Omit<CheckItem, "id">[] = [
  { category: "技术标框架检查", title: "评分标准符合度检查", description: "逐字逐句检查评分标准是否在标书中有对应内容。技术评分标准的每一句话都作为技术方案的一个子章节名称（特例：若招标文件有要求的固定格式以招标文件为准）", status: "unchecked", notes: "", severity: "critical" },
  { category: "技术标框架检查", title: "投标文件结构要求对应", description: "招标文件中若有对投标文件结构的要求，一定完全对应", status: "unchecked", notes: "", severity: "critical" },
  { category: "技术标框架检查", title: "技术需求应答章节覆盖", description: "招标文件中技术需求中提供的内容，需要用技术方案应答的，在框架中有对应章节的书写", status: "unchecked", notes: "", severity: "critical" },
  { category: "技术需求理解", title: "需求点对点应答", description: "技术需求理解作为技术方案的第一部分内容，表达对客户需求的理解。针对技术需求书的每一段话在需求理解中有对应内容。如果有对应章节需写明详见章节", status: "unchecked", notes: "", severity: "major" },
  { category: "技术偏离表", title: "偏离表逐一应答", description: "若要求逐一应答必须与技术需求书完全一致；偏离表格式需按照招标文件给定格式不得修改；响应内容列需严格按照招标文件要求；表头和落款信息填写完整", status: "unchecked", notes: "", severity: "critical" },
  { category: "技术方案内容检查", title: "内容完整性检查", description: "所有各级章节均已完成相应文字的编写。评分标准中要求的实质性响应、星号、关键重点条款需严格按照要求进行应答。框架中有需要技术补充字样的地方必须有补充内容", status: "unchecked", notes: "", severity: "critical" },
  { category: "技术方案内容检查", title: "内容合理性与准确性", description: "编写的内容是否合理：无文不对题、无不合理重复内容、说明文字充分（多维度阐述）、无语病、无其他不合适之处", status: "unchecked", notes: "", severity: "critical" },
  { category: "技术方案内容检查", title: "内容逻辑与一致性", description: "工作量投入计划数字核对准确；同一内容上下文一致（人员规模、工作日、百分比、入场时间等）；无歧义描述；章节互相引用正确；公司人数全文一致；技术支持邮件地址和热线电话正确", status: "unchecked", notes: "", severity: "major" },
  { category: "客户与公司名称", title: "客户称谓准确一致", description: "非银行客户不得出现本行、行方、我行等银行字样；银行客户不得出现保险、国债、证券等字样；当前客户简称全文一致", status: "unchecked", notes: "", severity: "critical" },
  { category: "客户与公司名称", title: "全文无其他客户名称", description: "成功案例和简历除外，技术标书中不能出现由于摘抄其他标书而带入的其他客户名字", status: "unchecked", notes: "", severity: "critical" },
  { category: "客户与公司名称", title: "我司名称正确且一致", description: "公司简称统一（如捷科、润和软件等）；描述我司时不能出现本行、行方、我行等", status: "unchecked", notes: "", severity: "major" },
  { category: "格式与排版", title: "排版字体版式检查", description: "排版规范清晰、无错别字；已删除招标文件评分标准相关文字（涂黄色/红色字体）；无多余分节符；复查时无修订记录和批注。正文宋体小四行距1.5倍首行空两格；表格宋体五号行距1.0倍", status: "unchecked", notes: "", severity: "major" },
  { category: "承诺与服务", title: "服务承诺完整", description: "全文搜索招标文件中承诺字样，确认技术相关承诺逐一全部应答且内容完整无遗漏。针对技术需求书中的服务指标要求应编写服务承诺书章节。承诺须有抬头（客户方全称）和落款（公司全称和投标日期）落款后空至少三行", status: "unchecked", notes: "", severity: "critical" },
  { category: "承诺与服务", title: "增值服务内容", description: "只要客户在招标文件中提到过增值服务，无论是否在评分标准中均需编写。对要求的每一条增值服务均要有对应内容", status: "unchecked", notes: "", severity: "major" },
  { category: "承诺与服务", title: "培训方案", description: "资源池标书一般都放。若招标文件中有具体要求一定要按照客户要求逐一对应细化编写和个性化补充（如培训次数、培训针对人群、课程覆盖等）", status: "unchecked", notes: "", severity: "major" },
  { category: "合同与索引", title: "合同项检查", description: "投标须知、技术需求、技术偏离表（含备注）、技术方案格式要求中提到合同的情况下，检查需求理解或技术方案中是否有相应内容与合同相关内容匹配", status: "unchecked", notes: "", severity: "minor" },
  { category: "合同与索引", title: "索引表正确完整", description: "有相应的文字说明且言简意赅，相应章节正确", status: "unchecked", notes: "", severity: "major" },
  { category: "质量提升项", title: "过渡句检查", description: "章节有过渡句要提到客户名称，让阅读者感觉标书为本次招标所写。过渡句应贴合招标要求编写，提到客户相应需求、客户名称、本项目关注点。每个评分项都需增加过渡句", status: "unchecked", notes: "", severity: "major" },
  { category: "质量提升项", title: "运行项目总结", description: "对于运行中的项目（老客户续签招采），一定要有针对该项目的总结，说明我方对客户项目特点及管理要求等的理解，建议放在技术需求理解章节单独子章节", status: "unchecked", notes: "", severity: "major" },
  { category: "质量提升项", title: "标书质量水平检查", description: "技术需求内容应在标书中有所体现；应突出本项目专属特色；方案表述应专业务实、逻辑严谨，避免过度AI化文风，确保贴合项目实际、可读性强", status: "unchecked", notes: "", severity: "major" },
  { category: "篇幅与页数", title: "技术标总页数要求", description: "邀标/单一来源/竞争性谈判无硬性要求。公开招标资源型项目：21家系统重要性银行等大行不少于1000页，其他500页以上。公开招标项目型项目：完全公开招标300页，其余不做硬性要求", status: "unchecked", notes: "", severity: "major" },
  { category: "篇幅与页数", title: "评分项对应页数保证", description: "评分标准技术评分项对应的技术标书内容应保证一定页数（某评分项得分2分则至少3页内容对应）。覆盖评分标准和技术需求的技术内容应占总体标书60%以上", status: "unchecked", notes: "", severity: "major" },
  { category: "人员相关", title: "人员评分项应答", description: "评分项需要有对应章节且章节内容不允许为空。文字描述内容完整覆盖评分点（如团队持证情况章节需有文字概括描述，不确定的数据应标黄）", status: "unchecked", notes: "", severity: "major" },
];

interface ChecklistTemplate {
  id: string;
  name: string;
  description: string;
  items: Omit<CheckItem, "id">[];
}

const BUILTIN_TEMPLATES: ChecklistTemplate[] = [
  {
    id: "default",
    name: "通用检查模板",
    description: "涵盖格式规范、资质证明、人员配置、报价等8大类20项基本检查",
    items: DEFAULT_CHECK_ITEMS,
  },
  {
    id: "v2-professional",
    name: "技术标质量检查 V2.0",
    description: "专业级技术标质量检查，含21项核心检查项（满分100分），覆盖框架、需求理解、偏离表、内容完整性、逻辑一致性、格式排版、承诺服务、篇幅要求等",
    items: V2_TEMPLATE_ITEMS,
  },
];

const genId = () => crypto.randomUUID();

const STORAGE_KEY = "tech-bid-checklists";

const TechnicalBidCheck = () => {
  const { user } = useAuth();
  const [checklists, setChecklists] = useState<CheckList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(DEFAULT_CATEGORIES));
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [newItemMode, setNewItemMode] = useState(false);
  const [newItem, setNewItem] = useState({ category: "", title: "", description: "", severity: "major" as CheckItem["severity"] });
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Load from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`${STORAGE_KEY}-${user?.id}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as CheckList[];
        setChecklists(parsed);
        if (parsed.length > 0 && !activeListId) setActiveListId(parsed[0].id);
      } catch { /* ignore */ }
    }
  }, [user?.id]);

  // Save to localStorage
  useEffect(() => {
    if (user?.id && checklists.length > 0) {
      localStorage.setItem(`${STORAGE_KEY}-${user.id}`, JSON.stringify(checklists));
    }
  }, [checklists, user?.id]);

  const activeList = checklists.find((c) => c.id === activeListId) || null;

  const createFromTemplate = (template: ChecklistTemplate) => {
    const id = genId();
    const newList: CheckList = {
      id,
      name: template.name,
      projectName: "",
      items: template.items.map((item) => ({ ...item, id: genId() })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setChecklists((prev) => [newList, ...prev]);
    setActiveListId(id);
    setShowTemplatePicker(false);
    toast.success(`已基于「${template.name}」创建检查清单，共${template.items.length}个检查项`);
  };

  const deleteChecklist = (id: string) => {
    setChecklists((prev) => prev.filter((c) => c.id !== id));
    if (activeListId === id) setActiveListId(checklists.find((c) => c.id !== id)?.id || null);
    toast.success("已删除检查清单");
  };

  const updateList = (updater: (list: CheckList) => CheckList) => {
    if (!activeListId) return;
    setChecklists((prev) =>
      prev.map((c) => (c.id === activeListId ? updater({ ...c, updatedAt: new Date().toISOString() }) : c))
    );
  };

  const updateItemStatus = (itemId: string, status: CheckItem["status"]) => {
    updateList((list) => ({
      ...list,
      items: list.items.map((item) => (item.id === itemId ? { ...item, status } : item)),
    }));
  };

  const updateItemNotes = (itemId: string, notes: string) => {
    updateList((list) => ({
      ...list,
      items: list.items.map((item) => (item.id === itemId ? { ...item, notes } : item)),
    }));
  };

  const removeItem = (itemId: string) => {
    updateList((list) => ({
      ...list,
      items: list.items.filter((item) => item.id !== itemId),
    }));
  };

  const addCustomItem = () => {
    if (!newItem.title.trim()) return toast.error("请输入检查项标题");
    if (!newItem.category.trim()) return toast.error("请选择或输入分类");
    updateList((list) => ({
      ...list,
      items: [
        ...list.items,
        { id: genId(), ...newItem, status: "unchecked" as const, notes: "" },
      ],
    }));
    setNewItem({ category: "", title: "", description: "", severity: "major" });
    setNewItemMode(false);
    toast.success("已添加检查项");
  };

  const resetAllItems = () => {
    updateList((list) => ({
      ...list,
      items: list.items.map((item) => ({ ...item, status: "unchecked", notes: "" })),
    }));
    toast.success("已重置所有检查项");
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

        if (rows.length === 0) return toast.error("Excel文件为空");

        const severityMap: Record<string, CheckItem["severity"]> = {
          "关键": "critical", "critical": "critical",
          "重要": "major", "major": "major",
          "一般": "minor", "minor": "minor",
        };

        const items: CheckItem[] = rows
          .filter((r) => (r["检查项"] || r["标题"] || r["title"] || "").trim())
          .map((r) => ({
            id: genId(),
            category: (r["分类"] || r["类别"] || r["category"] || "未分类").trim(),
            title: (r["检查项"] || r["标题"] || r["title"] || "").trim(),
            description: (r["说明"] || r["描述"] || r["description"] || "").trim(),
            severity: severityMap[(r["严重程度"] || r["severity"] || "major").trim().toLowerCase()] || "major",
            status: "unchecked" as const,
            notes: "",
          }));

        if (items.length === 0) return toast.error("未识别到有效检查项，请确认列名包含「检查项」或「标题」");

        if (activeList) {
          // Append to current checklist
          updateList((list) => ({ ...list, items: [...list.items, ...items] }));
          toast.success(`已从Excel导入 ${items.length} 个检查项`);
        } else {
          // Create new checklist from upload
          const id = genId();
          const newList: CheckList = {
            id,
            name: file.name.replace(/\.(xlsx?|csv)$/i, ""),
            projectName: "",
            items,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setChecklists((prev) => [newList, ...prev]);
          setActiveListId(id);
          toast.success(`已从Excel创建检查清单，共 ${items.length} 个检查项`);
        }
      } catch (err: any) {
        console.error("Excel parse error:", err);
        toast.error("Excel解析失败：" + (err.message || "未知错误"));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  // Filtered items
  const filteredItems = activeList?.items.filter((item) => {
    if (filterStatus === "all") return true;
    return item.status === filterStatus;
  }) || [];

  // Group by category
  const categories = [...new Set(filteredItems.map((i) => i.category))];

  // Stats
  const totalItems = activeList?.items.length || 0;
  const passCount = activeList?.items.filter((i) => i.status === "pass").length || 0;
  const failCount = activeList?.items.filter((i) => i.status === "fail").length || 0;
  const warningCount = activeList?.items.filter((i) => i.status === "warning").length || 0;
  const uncheckedCount = activeList?.items.filter((i) => i.status === "unchecked").length || 0;
  const progress = totalItems > 0 ? Math.round(((totalItems - uncheckedCount) / totalItems) * 100) : 0;

  const statusIcon = (status: CheckItem["status"]) => {
    switch (status) {
      case "pass": return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "fail": return <XCircle className="w-5 h-5 text-destructive" />;
      case "warning": return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      default: return <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  const severityBadge = (severity: CheckItem["severity"]) => {
    const map = {
      critical: { label: "关键", className: "bg-destructive/10 text-destructive border-destructive/20" },
      major: { label: "重要", className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" },
      minor: { label: "一般", className: "bg-muted text-muted-foreground border-border" },
    };
    const s = map[severity];
    return <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.className}`}>{s.label}</Badge>;
  };

  // No active list - show list view
  if (!activeList) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">技术标质量检查</h2>
            <p className="text-sm text-muted-foreground mt-1">创建检查清单，逐项确认标书质量</p>
          </div>
          <Button onClick={createNewChecklist} className="gap-1.5">
            <Plus className="w-4 h-4" />
            新建检查清单
          </Button>
          <label>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcelUpload} />
            <Button variant="outline" className="gap-1.5" asChild>
              <span><Upload className="w-4 h-4" />导入Excel</span>
            </Button>
          </label>
        </div>

        {checklists.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">暂无检查清单</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                创建一份质量检查清单，系统将预置常用检查项，您也可以自定义添加
              </p>
              <Button onClick={createNewChecklist} className="gap-1.5">
                <Plus className="w-4 h-4" />
                创建第一份检查清单
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {checklists.map((cl) => {
              const total = cl.items.length;
              const checked = cl.items.filter((i) => i.status !== "unchecked").length;
              const fails = cl.items.filter((i) => i.status === "fail").length;
              const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
              return (
                <Card
                  key={cl.id}
                  className="cursor-pointer hover:shadow-card-hover transition-shadow"
                  onClick={() => setActiveListId(cl.id)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{cl.name}</CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); deleteChecklist(cl.id); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {cl.projectName && <p className="text-xs text-muted-foreground">{cl.projectName}</p>}
                  </CardHeader>
                  <CardContent>
                    <Progress value={pct} className="h-2 mb-3" />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{checked}/{total} 已检查</span>
                      {fails > 0 && <span className="text-destructive font-medium">{fails} 项不通过</span>}
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-2">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {new Date(cl.updatedAt).toLocaleString("zh-CN")}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setActiveListId(null)} className="gap-1">
            <FolderOpen className="w-4 h-4" />
            返回列表
          </Button>
          <div>
            <Input
              value={activeList.name}
              onChange={(e) => updateList((l) => ({ ...l, name: e.target.value }))}
              className="text-lg font-bold border-none shadow-none p-0 h-auto focus-visible:ring-0"
            />
            <Input
              value={activeList.projectName}
              onChange={(e) => updateList((l) => ({ ...l, projectName: e.target.value }))}
              placeholder="输入关联项目名称（可选）"
              className="text-xs text-muted-foreground border-none shadow-none p-0 h-auto mt-0.5 focus-visible:ring-0"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcelUpload} />
            <Button variant="outline" size="sm" className="gap-1" asChild>
              <span><Upload className="w-3.5 h-3.5" />导入Excel</span>
            </Button>
          </label>
          <Button variant="outline" size="sm" onClick={resetAllItems} className="gap-1">
            <RotateCcw className="w-3.5 h-3.5" />
            重置
          </Button>
          <Button variant="outline" size="sm" onClick={() => setNewItemMode(true)} className="gap-1">
            <Plus className="w-3.5 h-3.5" />
            添加检查项
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">检查进度</p>
          <div className="flex items-center gap-2 mt-1">
            <Progress value={progress} className="h-2 flex-1" />
            <span className="text-sm font-bold text-foreground">{progress}%</span>
          </div>
        </Card>
        <Card className="p-3 cursor-pointer hover:bg-secondary/50" onClick={() => setFilterStatus("all")}>
          <p className="text-xs text-muted-foreground">总计</p>
          <p className="text-xl font-bold text-foreground">{totalItems}</p>
        </Card>
        <Card className="p-3 cursor-pointer hover:bg-secondary/50" onClick={() => setFilterStatus("pass")}>
          <p className="text-xs text-muted-foreground">通过</p>
          <p className="text-xl font-bold text-green-500">{passCount}</p>
        </Card>
        <Card className="p-3 cursor-pointer hover:bg-secondary/50" onClick={() => setFilterStatus("fail")}>
          <p className="text-xs text-muted-foreground">不通过</p>
          <p className="text-xl font-bold text-destructive">{failCount}</p>
        </Card>
        <Card className="p-3 cursor-pointer hover:bg-secondary/50" onClick={() => setFilterStatus("warning")}>
          <p className="text-xs text-muted-foreground">需注意</p>
          <p className="text-xl font-bold text-yellow-500">{warningCount}</p>
        </Card>
      </div>

      {/* Add new item form */}
      {newItemMode && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">分类</label>
                <Select value={newItem.category} onValueChange={(v) => setNewItem((p) => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="选择分类" /></SelectTrigger>
                  <SelectContent>
                    {DEFAULT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">标题</label>
                <Input value={newItem.title} onChange={(e) => setNewItem((p) => ({ ...p, title: e.target.value }))} placeholder="检查项名称" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">严重程度</label>
                <Select value={newItem.severity} onValueChange={(v: any) => setNewItem((p) => ({ ...p, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">关键</SelectItem>
                    <SelectItem value="major">重要</SelectItem>
                    <SelectItem value="minor">一般</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Textarea
              value={newItem.description}
              onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))}
              placeholder="检查说明（可选）"
              rows={2}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setNewItemMode(false)}>取消</Button>
              <Button size="sm" onClick={addCustomItem} className="gap-1"><Plus className="w-3.5 h-3.5" />添加</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {[
          { value: "all", label: "全部" },
          { value: "unchecked", label: "待检查" },
          { value: "pass", label: "通过" },
          { value: "fail", label: "不通过" },
          { value: "warning", label: "需注意" },
        ].map((f) => (
          <Button
            key={f.value}
            variant={filterStatus === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus(f.value)}
            className="text-xs h-7"
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Checklist items grouped by category */}
      <div className="space-y-3">
        {categories.map((cat) => {
          const catItems = filteredItems.filter((i) => i.category === cat);
          const expanded = expandedCategories.has(cat);
          const catPass = catItems.filter((i) => i.status === "pass").length;
          return (
            <Card key={cat}>
              <button
                className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/30 transition-colors"
                onClick={() => toggleCategory(cat)}
              >
                <div className="flex items-center gap-2">
                  {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <h3 className="font-semibold text-foreground">{cat}</h3>
                  <Badge variant="secondary" className="text-[10px]">{catPass}/{catItems.length}</Badge>
                </div>
              </button>
              {expanded && (
                <CardContent className="pt-0 space-y-2">
                  {catItems.map((item) => (
                    <div key={item.id} className={`rounded-lg border p-3 transition-colors ${
                      item.status === "fail" ? "border-destructive/30 bg-destructive/5" :
                      item.status === "pass" ? "border-green-500/20 bg-green-500/5" :
                      item.status === "warning" ? "border-yellow-500/20 bg-yellow-500/5" :
                      "border-border"
                    }`}>
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col gap-1 pt-0.5">
                          <button onClick={() => updateItemStatus(item.id, item.status === "pass" ? "unchecked" : "pass")} title="通过">
                            {statusIcon(item.status)}
                          </button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-foreground">{item.title}</span>
                            {severityBadge(item.severity)}
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                          )}
                          <div className="flex items-center gap-1 mt-2">
                            <Button
                              variant={item.status === "pass" ? "default" : "outline"}
                              size="sm"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={() => updateItemStatus(item.id, "pass")}
                            >
                              <CheckCircle2 className="w-3 h-3" />通过
                            </Button>
                            <Button
                              variant={item.status === "warning" ? "default" : "outline"}
                              size="sm"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={() => updateItemStatus(item.id, "warning")}
                            >
                              <AlertTriangle className="w-3 h-3" />需注意
                            </Button>
                            <Button
                              variant={item.status === "fail" ? "destructive" : "outline"}
                              size="sm"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={() => updateItemStatus(item.id, "fail")}
                            >
                              <XCircle className="w-3 h-3" />不通过
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 ml-auto text-muted-foreground hover:text-destructive"
                              onClick={() => removeItem(item.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                          <Textarea
                            value={item.notes}
                            onChange={(e) => updateItemNotes(item.id, e.target.value)}
                            placeholder="添加备注..."
                            className="mt-2 text-xs min-h-[32px] h-8 resize-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default TechnicalBidCheck;
