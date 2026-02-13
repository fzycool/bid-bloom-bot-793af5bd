import HeroSection from "@/components/HeroSection";
import ModulesSection from "@/components/ModulesSection";
import WorkflowSection from "@/components/WorkflowSection";
import StatsSection from "@/components/StatsSection";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen">
      <HeroSection />
      <ModulesSection />
      <WorkflowSection />
      <StatsSection />
      <CTASection />
      <Footer />
    </div>
  );
};

export default Index;
