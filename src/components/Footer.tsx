const Footer = () => {
  return (
    <footer className="py-12 bg-primary border-t border-primary-foreground/10">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black text-primary-foreground">智标</span>
            <span className="text-2xl font-black text-accent">工场</span>
          </div>
          <p className="text-sm text-primary-foreground/40">
            © 2026 润和捷科AI智标工厂 由 AI代码开发 润和AI中心
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
