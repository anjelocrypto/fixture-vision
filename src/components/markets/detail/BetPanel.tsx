import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Coins, TrendingUp, TrendingDown, AlertCircle, Loader2, Clock, ArrowRight, Minus, Target } from "lucide-react";
import { Market, usePlaceBet } from "@/hooks/useMarkets";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Separator } from "@/components/ui/separator";
import { normalizeImpliedProbs } from "./PriceDisplay";

interface BetPanelProps {
  market: Market;
  userBalance: number;
}

const FEE_RATE = 0.02;
const MIN_FEE = 1;
const MIN_STAKE = 10;

export function BetPanel({ market, userBalance }: BetPanelProps) {
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [stake, setStake] = useState("");

  const placeBet = usePlaceBet();

  const stakeNum = Number(stake) || 0;
  const fee = Math.max(MIN_FEE, Math.floor(stakeNum * FEE_RATE));
  const netStake = Math.max(0, stakeNum - fee);
  const odds = outcome === "yes" ? market.odds_yes : market.odds_no;
  const potentialPayout = Math.floor(netStake * odds);
  const potentialProfit = potentialPayout - stakeNum;

  // Use normalized probabilities (YES + NO = 100) for consistency
  const { yesPct, noPct } = normalizeImpliedProbs(market.odds_yes, market.odds_no);

  const isValid = stakeNum >= MIN_STAKE && stakeNum <= userBalance;
  const insufficientBalance = stakeNum > userBalance;

  const closesIn = formatDistanceToNow(new Date(market.closes_at), { addSuffix: true });

  const handleSubmit = async () => {
    if (!isValid) return;

    try {
      await placeBet.mutateAsync({
        market_id: market.id,
        outcome,
        stake: stakeNum,
      });

      toast.success(`Bet placed! Potential payout: ${potentialPayout} coins`);
      setStake("");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to place bet";
      toast.error(errorMessage);
    }
  };

  return (
    <Card className="sticky top-4 border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-lg flex items-center gap-2 font-semibold">
          <Target className="h-5 w-5 text-primary" />
          Place Bet
        </CardTitle>
        <div className="flex items-center gap-1.5 text-xs text-amber-500 mt-1 bg-amber-500/10 px-2 py-1 rounded-md w-fit">
          <Clock className="h-3.5 w-3.5" />
          <span>Closes {closesIn}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 px-5 pb-5">
        {/* Outcome Selection with normalized implied % */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">Choose Outcome</Label>
          <RadioGroup
            value={outcome}
            onValueChange={(v) => setOutcome(v as "yes" | "no")}
            className="grid grid-cols-2 gap-3"
          >
            <Label
              htmlFor="yes-detail"
              className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                outcome === "yes"
                  ? "border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10"
                  : "border-border/50 hover:border-emerald-500/50 hover:bg-emerald-500/5"
              }`}
            >
              <RadioGroupItem value="yes" id="yes-detail" className="sr-only" />
              <TrendingUp className={`h-5 w-5 mb-1 ${outcome === "yes" ? "text-emerald-400" : "text-emerald-500/70"}`} />
              <span className={`text-xs font-bold ${outcome === "yes" ? "text-emerald-400" : "text-emerald-500/70"}`}>YES</span>
              <span className={`text-xl font-bold mt-1 ${outcome === "yes" ? "text-emerald-400" : "text-emerald-500/70"}`}>
                {yesPct}%
              </span>
              <span className={`text-[10px] ${outcome === "yes" ? "text-emerald-400/80" : "text-muted-foreground"}`}>
                @ {market.odds_yes.toFixed(2)} odds
              </span>
            </Label>
            <Label
              htmlFor="no-detail"
              className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                outcome === "no"
                  ? "border-red-500 bg-red-500/10 shadow-lg shadow-red-500/10"
                  : "border-border/50 hover:border-red-500/50 hover:bg-red-500/5"
              }`}
            >
              <RadioGroupItem value="no" id="no-detail" className="sr-only" />
              <TrendingDown className={`h-5 w-5 mb-1 ${outcome === "no" ? "text-red-400" : "text-red-500/70"}`} />
              <span className={`text-xs font-bold ${outcome === "no" ? "text-red-400" : "text-red-500/70"}`}>NO</span>
              <span className={`text-xl font-bold mt-1 ${outcome === "no" ? "text-red-400" : "text-red-500/70"}`}>
                {noPct}%
              </span>
              <span className={`text-[10px] ${outcome === "no" ? "text-red-400/80" : "text-muted-foreground"}`}>
                @ {market.odds_no.toFixed(2)} odds
              </span>
            </Label>
          </RadioGroup>
        </div>

        {/* Stake Input */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">Amount</Label>
          <div className="relative">
            <Coins className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder={`Min ${MIN_STAKE} coins`}
              className="pl-10 h-11 bg-muted/30 border-border/50 focus:border-primary/50 text-lg"
              min={MIN_STAKE}
              max={userBalance}
            />
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Balance: <span className="text-foreground font-medium">{userBalance.toLocaleString()}</span></span>
            <div className="flex gap-1">
              {[25, 50, 100].map((pct) => (
                <Button
                  key={pct}
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  onClick={() =>
                    setStake(String(Math.floor(userBalance * (pct / 100))))
                  }
                >
                  {pct === 100 ? "MAX" : `${pct}%`}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Breakdown */}
        {stakeNum > 0 && (
          <div className="space-y-2 p-3 rounded-xl bg-muted/30 border border-border/30">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Stake</span>
              <span className="font-medium">{stakeNum.toLocaleString()} coins</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Fee (2%)</span>
              <span className="font-medium text-red-400 flex items-center gap-1">
                <Minus className="h-3 w-3" />
                {fee} coins
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Net Stake</span>
              <span className="font-medium">{netStake.toLocaleString()} coins</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Odds</span>
              <span className="font-medium">@ {odds.toFixed(2)}</span>
            </div>
            <Separator className="my-2" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Potential Payout</span>
              <div className="text-right">
                <span className="text-lg font-bold text-emerald-400">{potentialPayout.toLocaleString()}</span>
                <span className="text-xs text-emerald-400/80 ml-1">
                  (+{potentialProfit.toLocaleString()} profit)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Errors */}
        {insufficientBalance && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Insufficient balance</span>
          </div>
        )}

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={!isValid || placeBet.isPending}
          className={`w-full h-12 font-semibold text-base shadow-lg transition-all duration-200 ${
            outcome === "yes"
              ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20"
              : "bg-red-600 hover:bg-red-500 shadow-red-600/20"
          }`}
        >
          {placeBet.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Target className="h-4 w-4 mr-2" />
          )}
          Place Bet on {outcome.toUpperCase()}
        </Button>

        {/* Fixed odds disclaimer */}
        <p className="text-[10px] text-center text-muted-foreground/70 leading-tight">
          Implied % shown are fixed odds set by admins — not live market pricing.
        </p>
      </CardContent>
    </Card>
  );
}
