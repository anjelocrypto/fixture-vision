import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface InfoTooltipProps {
  tooltipKey: string; // Translation key for the tooltip (e.g. "filterizer", "team_totals")
  className?: string;
}

export function InfoTooltip({ tooltipKey, className = "" }: InfoTooltipProps) {
  const { t } = useTranslation(['tooltips']);
  
  const label = t(`tooltips:${tooltipKey}.label`);
  const description = t(`tooltips:${tooltipKey}.description`);
  const bullets = [
    t(`tooltips:${tooltipKey}.bullet1`),
    t(`tooltips:${tooltipKey}.bullet2`),
    t(`tooltips:${tooltipKey}.bullet3`),
    t(`tooltips:${tooltipKey}.bullet4`),
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors cursor-help ${className}`}
            aria-label={`Help: ${label}`}
          >
            <Info className="w-3 h-3 text-primary" />
          </button>
        </TooltipTrigger>
        <TooltipContent 
          side="right" 
          className="max-w-[280px] bg-card text-foreground border-2 border-primary/20 p-4 shadow-xl z-[100]"
          sideOffset={8}
        >
          <p className="font-semibold mb-2 text-primary">{label}</p>
          <p className="text-sm mb-2">{description}</p>
          <ul className="text-sm space-y-1">
            {bullets.map((bullet, index) => (
              <li key={index} className="flex gap-2">
                <span className="text-primary shrink-0">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
