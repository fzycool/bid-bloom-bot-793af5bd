const stats = [
  { value: "98%", label: "废标项识别准确率" },
  { value: "10x", label: "简历润色效率提升" },
  { value: "85%", label: "标书编写时间节省" },
  { value: "100+", label: "服务企业客户" },
];

const StatsSection = () => {
  return (
    <section className="py-20 bg-hero relative overflow-hidden">
      <div className="absolute inset-0 bg-glow pointer-events-none" />
      <div className="container relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-4xl md:text-5xl font-black text-accent mb-2">{s.value}</div>
              <p className="text-sm text-primary-foreground/60">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
