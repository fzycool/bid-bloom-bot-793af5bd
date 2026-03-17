import TechCheckProjects from "@/components/TechCheckProjects";

const TechnicalBidCheck = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">技术标质量检查</h2>
        <p className="text-sm text-muted-foreground mt-1">管理质检项目，上传招标文件和技术方案</p>
      </div>

      <TechCheckProjects />
    </div>
  );
};

export default TechnicalBidCheck;
