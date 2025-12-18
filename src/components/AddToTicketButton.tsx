import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TicketPlus, TicketCheck } from "lucide-react";
import { useTicket, TicketLeg } from "@/stores/useTicket";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useNavigate } from "react-router-dom";

interface AddToTicketButtonProps {
  leg: TicketLeg;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost";
}

export function AddToTicketButton({ leg, size = "icon", variant = "ghost" }: AddToTicketButtonProps) {
  const { addLeg, removeLeg, hasLeg } = useTicket();
  const { toast } = useToast();
  const { t } = useTranslation('common');
  const { isDemo } = useDemoMode();
  const navigate = useNavigate();
  const isAdded = hasLeg(leg.fixtureId, leg.market);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Demo mode: show CTA instead of adding to ticket
    if (isDemo) {
      toast({
        title: "Demo Mode",
        description: "Create an account to save real betting tickets!",
        action: <Button size="sm" onClick={() => navigate('/landing')}>Sign Up</Button>,
      });
      return;
    }

    if (isAdded) {
      removeLeg(leg.id);
      toast({
        title: t('removed_from_ticket'),
        description: `${leg.market} ${leg.side} ${leg.line} ${t('remove').toLowerCase()}`,
      });
    } else {
      addLeg(leg);
      toast({
        title: t('added_to_ticket'),
        description: `${leg.market} ${leg.side} ${leg.line} @ ${leg.odds.toFixed(2)}`,
      });
    }
  };

  const showText = size === "sm" || size === "default";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          onClick={handleClick}
          className={`${isAdded ? "text-primary border-primary bg-primary/5" : ""} transition-all`}
        >
          {isAdded ? <TicketCheck className="h-4 w-4" /> : <TicketPlus className="h-4 w-4" />}
          {showText && (
            <span className="ml-2">
              {isAdded ? t('ticket_added', { defaultValue: 'Added' }) : t('add_to_ticket', { defaultValue: 'Add to Ticket' })}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isAdded ? t('remove_from_ticket', { defaultValue: 'Remove from My Ticket' }) : t('add_to_my_ticket', { defaultValue: 'Add to My Ticket' })}
      </TooltipContent>
    </Tooltip>
  );
}
