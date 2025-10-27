import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TicketPlus, TicketCheck } from "lucide-react";
import { useTicket, TicketLeg } from "@/stores/useTicket";
import { useToast } from "@/hooks/use-toast";

interface AddToTicketButtonProps {
  leg: TicketLeg;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost";
}

export function AddToTicketButton({ leg, size = "icon", variant = "ghost" }: AddToTicketButtonProps) {
  const { addLeg, removeLeg, hasLeg } = useTicket();
  const { toast } = useToast();
  const isAdded = hasLeg(leg.fixtureId, leg.market);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isAdded) {
      removeLeg(leg.id);
      toast({
        title: "Removed from ticket",
        description: `${leg.market} ${leg.side} ${leg.line} removed`,
      });
    } else {
      addLeg(leg);
      toast({
        title: "Added to ticket",
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
              {isAdded ? "Added" : "Add to Ticket"}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isAdded ? "Remove from My Ticket" : "Add to My Ticket"}
      </TooltipContent>
    </Tooltip>
  );
}
