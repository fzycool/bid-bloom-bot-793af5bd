import { Database, FileSearch, Users, PenTool, CheckCircle } from "lucide-react";

const modules = [
  {
    icon: Database,
    title: "私有化知识库中枢",
    subtitle: "企业记忆体",
    desc: "多模态数据入库，自动打标分类，向量化切片检索。历史标书、资质证书、报价单智能管理。",
    tags: ["自动打标", "向量检索", "报价解构"],
  },
  {
    icon: FileSearch,
    title: "招标文件解析引擎",
    subtitle: "智能读标",
    desc: "像资深标书专员一样「读题」，自动提取评分表、废标项、陷阱条款，生成关键词词典。",
    tags: ["废标预警", "陷阱识别", "关键词工厂"],
  },
  {
    icon: Users,
    title: "简历智能工场",
    subtitle: "核心攻坚",
    desc: "千人千面的智能简历润色，匹配度分析，时间线稽查，杜绝逻辑冲突与千篇一律。",
    tags: ["智能润色", "匹配分析", "逻辑校验"],
  },
  {
    icon: PenTool,
    title: "智能投标助手",
    subtitle: "从0到1",
    desc: "自动生成投标文件框架，证明材料智能补全与溯源，告别空白页恐惧。",
    tags: ["框架生成", "材料补全", "智能溯源"],
  },
  {
    icon: CheckCircle,
    title: "全息检查与逻辑自证",
    subtitle: "逆向审查",
    desc: "模拟甲方评委挑刺视角，响应性检查、逻辑一致性校验、语义连贯性审查。",
    tags: ["废标自检", "逻辑校验", "语义审查"],
  },
];

const ModulesSection = () => {
  return (
    <section className="py-24 bg-background relative">
      <div className="container">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-accent tracking-widest uppercase mb-3">核心功能</p>
          <h2 className="text-4xl md:text-5xl font-bold text-foreground">五大智能模块</h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            覆盖招投标全生命周期，每一环节都有AI助力
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((m, i) => (
            <div
              key={m.title}
              className={`group relative p-8 rounded-2xl bg-gradient-card border border-border shadow-card hover:shadow-card-hover transition-all duration-500 hover:-translate-y-1 ${
                i === 2 ? "md:col-span-2 lg:col-span-1 lg:row-span-1" : ""
              }`}
            >
              {/* Icon */}
              <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center mb-6 group-hover:bg-accent/20 transition-colors duration-300">
                <m.icon className="w-7 h-7 text-accent" />
              </div>

              {/* Content */}
              <p className="text-xs font-semibold text-accent tracking-wider uppercase mb-2">{m.subtitle}</p>
              <h3 className="text-xl font-bold text-foreground mb-3">{m.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">{m.desc}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-2">
                {m.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 text-xs font-medium rounded-full bg-secondary text-secondary-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ModulesSection;
