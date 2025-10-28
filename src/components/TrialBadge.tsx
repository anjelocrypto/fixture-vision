import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

interface TrialBadgeProps {
  creditsRemaining: number | null;
  isWhitelisted: boolean;
  hasAccess: boolean;
}

export const TrialBadge = ({ creditsRemaining, isWhitelisted, hasAccess }: TrialBadgeProps) => {
  // Don't show badge if user has paid access or is whitelisted
  if (hasAccess || isWhitelisted) {
    return null;
  }

  // Don't show if credits data hasn't loaded yet
  if (creditsRemaining === null) {
    return null;
  }

  return (
    <Badge 
      variant={creditsRemaining > 0 ? "default" : "secondary"} 
      className="gap-1 text-xs"
    >
      <Sparkles className="h-3 w-3" />
      {creditsRemaining > 0 ? `${creditsRemaining} free uses left` : 'Trial expired'}
    </Badge>
  );
};
