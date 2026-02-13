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
            © 2026 智标工场 · 招投标全流程智能协作平台
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
