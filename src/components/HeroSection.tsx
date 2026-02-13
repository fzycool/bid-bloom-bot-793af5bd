import { Shield, Zap, TrendingUp } from "lucide-react";

const values = [
  {
    icon: Shield,
    title: "合规避险",
    desc: "杜绝废标，识别陷阱，逻辑自检",
  },
  {
    icon: Zap,
    title: "降本增效",
    desc: "从「人找资料」变为「资料配人」",
  },
  {
    icon: TrendingUp,
    title: "提档升级",
    desc: "千人千面，智能润色人员简历",
  },
];

const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-hero min-h-[90vh] flex items-center">
      {/* Glow overlay */}
      <div className="absolute inset-0 bg-glow pointer-events-none" />
      
      {/* Floating decorative elements */}
      <div className="absolute top-20 right-[15%] w-72 h-72 rounded-full bg-accent/5 blur-3xl animate-float" />
      <div className="absolute bottom-20 left-[10%] w-96 h-96 rounded-full bg-accent/3 blur-3xl animate-float" style={{ animationDelay: "1.5s" }} />
      
      <div className="container relative z-10 py-20">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent/20 bg-accent/10 mb-8 opacity-0 animate-fade-up">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-sm font-medium text-accent">招投标全流程智能协作平台</span>
          </div>

          {/* Main heading */}
          <h1 className="text-5xl md:text-7xl font-black text-primary-foreground leading-tight mb-6 opacity-0 animate-fade-up" style={{ animationDelay: "0.15s" }}>
            智标
            <span className="text-gradient-accent">工场</span>
          </h1>

          <p className="text-xl md:text-2xl text-primary-foreground/70 max-w-2xl mx-auto mb-12 font-light opacity-0 animate-fade-up" style={{ animationDelay: "0.3s" }}>
            AI驱动的招投标全流程智能协作平台
            <br />
            从读标、写人到组卷审查，一站式搞定
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center opacity-0 animate-fade-up" style={{ animationDelay: "0.45s" }}>
            <button className="px-8 py-4 rounded-lg bg-accent text-accent-foreground font-semibold text-lg shadow-hero hover:brightness-110 transition-all duration-300 hover:scale-105">
              立即体验
            </button>
            <button className="px-8 py-4 rounded-lg border border-primary-foreground/20 text-primary-foreground font-medium text-lg hover:bg-primary-foreground/10 transition-all duration-300">
              预约演示
            </button>
          </div>

          {/* Value props */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20 opacity-0 animate-fade-up" style={{ animationDelay: "0.6s" }}>
            {values.map((v) => (
              <div key={v.title} className="flex flex-col items-center gap-3 p-6 rounded-xl bg-primary-foreground/5 backdrop-blur-sm border border-primary-foreground/10">
                <v.icon className="w-8 h-8 text-accent" />
                <h3 className="text-lg font-bold text-primary-foreground">{v.title}</h3>
                <p className="text-sm text-primary-foreground/60">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
