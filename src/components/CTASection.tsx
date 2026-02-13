import { Lock, FileText, Brain } from "lucide-react";

const features = [
  {
    icon: Lock,
    title: "数据安全至上",
    desc: "支持私有化部署，敏感数据本地化，全操作日志可追溯。",
  },
  {
    icon: FileText,
    title: "完美格式兼容",
    desc: "WPS与Office互转无忧，Word转PDF不失真，目录自动更新。",
  },
  {
    icon: Brain,
    title: "大模型幻觉控制",
    desc: "严禁编造经历，硬性参数不可修改，确保润色结果真实可靠。",
  },
];

const CTASection = () => {
  return (
    <section className="py-24 bg-background">
      <div className="container">
        {/* Trust features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
          {features.map((f) => (
            <div key={f.title} className="flex gap-4 items-start">
              <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                <f.icon className="w-6 h-6 text-accent" />
              </div>
              <div>
                <h4 className="font-bold text-foreground mb-1">{f.title}</h4>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA Card */}
        <div className="relative rounded-3xl bg-hero p-12 md:p-16 text-center overflow-hidden">
          <div className="absolute inset-0 bg-glow pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
              准备好提升投标胜率了吗？
            </h2>
            <p className="text-primary-foreground/60 mb-8 max-w-lg mx-auto">
              告别熬夜赶标书、告别废标风险、告别千篇一律的简历
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="px-8 py-4 rounded-lg bg-accent text-accent-foreground font-semibold text-lg shadow-hero hover:brightness-110 transition-all duration-300 hover:scale-105">
                免费试用
              </button>
              <button className="px-8 py-4 rounded-lg border border-primary-foreground/20 text-primary-foreground font-medium text-lg hover:bg-primary-foreground/10 transition-all duration-300">
                联系我们
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
