import { TrendingUp, TrendingDown } from "lucide-react";

interface PriceDisplayProps {
  odds: number;
  outcome: "yes" | "no";
  size?: "sm" | "md" | "lg";
  showOdds?: boolean;
}

/**
 * Displays implied probability as "price" in cents (Polymarket-style)
 * p = 1/odds, displayed as cents (e.g., 56¢ = 56% implied probability)
 */
export function PriceDisplay({ odds, outcome, size = "md", showOdds = true }: PriceDisplayProps) {
  // Calculate implied probability: p = 1/odds
  const impliedProb = 1 / odds;
  const priceInCents = Math.round(impliedProb * 100);
  
  const isYes = outcome === "yes";
  const Icon = isYes ? TrendingUp : TrendingDown;
  
  const sizeClasses = {
    sm: {
      container: "p-3",
      icon: "h-5 w-5",
      price: "text-2xl",
      label: "text-xs",
      odds: "text-xs",
    },
    md: {
      container: "p-4",
      icon: "h-6 w-6",
      price: "text-3xl",
      label: "text-sm",
      odds: "text-xs",
    },
    lg: {
      container: "p-5",
      icon: "h-7 w-7",
      price: "text-4xl",
      label: "text-base",
      odds: "text-sm",
    },
  };

  const classes = sizeClasses[size];
  
  const colorClasses = isYes
    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
    : "border-red-500/50 bg-red-500/10 text-red-400";

  return (
    <div className={`flex flex-col items-center ${classes.container} rounded-xl border-2 ${colorClasses} transition-all`}>
      <Icon className={`${classes.icon} mb-1`} />
      <span className={`${classes.label} font-bold uppercase tracking-wide`}>
        {outcome}
      </span>
      <span className={`${classes.price} font-bold mt-1`}>
        {priceInCents}¢
      </span>
      {showOdds && (
        <span className={`${classes.odds} text-muted-foreground mt-1`}>
          @ {odds.toFixed(2)} odds
        </span>
      )}
    </div>
  );
}

/**
 * Normalizes YES/NO implied probabilities to sum to 100%
 */
export function normalizeImpliedProbs(oddsYes: number, oddsNo: number): { yesPct: number; noPct: number } {
  const rawYes = 1 / oddsYes;
  const rawNo = 1 / oddsNo;
  const total = rawYes + rawNo;
  
  return {
    yesPct: Math.round((rawYes / total) * 100),
    noPct: Math.round((rawNo / total) * 100),
  };
}
