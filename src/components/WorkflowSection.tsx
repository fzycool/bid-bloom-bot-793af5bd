import { FileUp, UserCheck, ClipboardCheck } from "lucide-react";

const steps = [
  {
    icon: FileUp,
    phase: "A",
    title: "读标阶段",
    desc: "上传招标文件，AI自动解析废标项、评分标准、人员关键词，生成《标书重点洞察报告》。",
    color: "bg-accent",
  },
  {
    icon: UserCheck,
    phase: "B",
    title: "写人阶段",
    desc: "智能筛选高匹配人员，针对评分点润色简历描述，生成《拟投入人员情况表》。",
    color: "bg-primary",
  },
  {
    icon: ClipboardCheck,
    phase: "C",
    title: "组卷审查",
    desc: "自动填充方案文件，执行废标自检、材料完整性自检、语义逻辑自检，生成健康度评分。",
    color: "bg-accent",
  },
];

const WorkflowSection = () => {
  return (
    <section className="py-24 bg-secondary/50 relative overflow-hidden">
      <div className="container relative z-10">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-accent tracking-widest uppercase mb-3">工作流程</p>
          <h2 className="text-4xl md:text-5xl font-bold text-foreground">三大闭环流程</h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            从读标到组卷，每一步都有智能辅助
          </p>
        </div>

        <div className="relative max-w-4xl mx-auto">
          {/* Connector line */}
          <div className="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-border -translate-y-1/2 z-0" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
            {steps.map((step, i) => (
              <div key={step.phase} className="flex flex-col items-center text-center group">
                {/* Phase circle */}
                <div className={`w-20 h-20 rounded-full ${step.color} flex items-center justify-center mb-6 shadow-hero group-hover:scale-110 transition-transform duration-300`}>
                  <step.icon className="w-9 h-9 text-primary-foreground" />
                </div>

                {/* Phase label */}
                <span className="text-xs font-bold text-accent tracking-widest mb-2">流程 {step.phase}</span>
                <h3 className="text-xl font-bold text-foreground mb-3">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>

                {/* Arrow on mobile */}
                {i < steps.length - 1 && (
                  <div className="md:hidden w-0.5 h-8 bg-border mt-6" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default WorkflowSection;
