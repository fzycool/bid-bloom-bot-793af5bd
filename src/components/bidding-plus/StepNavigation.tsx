import React from "react";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StepNavigationProps {
  currentStep: number;
  taskName: string;
  onStepChange: (step: number) => void;
  onBack: () => void;
}

const steps = [
  { step: 1, label: "大纲生成" },
  { step: 2, label: "在线编写" },
];

export default function StepNavigation({ currentStep, taskName, onStepChange, onBack }: StepNavigationProps) {
  return (
    <div className="flex items-center gap-4 shrink-0">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ArrowLeft className="w-4 h-4" /> 返回
      </Button>
      <span className="text-sm font-medium text-foreground truncate max-w-[200px]">{taskName}</span>
      <div className="flex items-center gap-1 ml-4">
        {steps.map((s, i) => (
          <React.Fragment key={s.step}>
            {i > 0 && <div className="w-8 h-px bg-border" />}
            <button
              onClick={() => onStepChange(s.step)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                currentStep === s.step
                  ? "bg-primary text-primary-foreground"
                  : currentStep > s.step
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {currentStep > s.step ? (
                <Check className="w-3 h-3" />
              ) : (
                <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">
                  {s.step}
                </span>
              )}
              {s.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
