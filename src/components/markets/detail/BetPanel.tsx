import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Coins, TrendingUp, AlertCircle, Loader2, Clock } from "lucide-react";
import { Market, usePlaceBet } from "@/hooks/useMarkets";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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
  const netStake = stakeNum - fee;
  const odds = outcome === "yes" ? market.odds_yes : market.odds_no;
  const potentialPayout = Math.floor(netStake * odds);

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
    <Card className="sticky top-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Coins className="h-5 w-5 text-primary" />
          Place Bet
        </CardTitle>
        <div className="flex items-center gap-1 text-xs text-yellow-600">
          <Clock className="h-3 w-3" />
          Closes {closesIn}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Outcome Selection */}
        <div className="space-y-2">
          <Label>Your Prediction</Label>
          <RadioGroup
            value={outcome}
            onValueChange={(v) => setOutcome(v as "yes" | "no")}
            className="grid grid-cols-2 gap-2"
          >
            <Label
              htmlFor="yes-detail"
              className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                outcome === "yes"
                  ? "border-green-500 bg-green-500/10"
                  : "border-muted hover:border-green-500/50"
              }`}
            >
              <RadioGroupItem value="yes" id="yes-detail" className="sr-only" />
              <TrendingUp className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium text-green-600">YES</span>
              <Badge variant="outline" className="mt-1 text-xs">
                @ {market.odds_yes.toFixed(2)}
              </Badge>
            </Label>
            <Label
              htmlFor="no-detail"
              className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                outcome === "no"
                  ? "border-red-500 bg-red-500/10"
                  : "border-muted hover:border-red-500/50"
              }`}
            >
              <RadioGroupItem value="no" id="no-detail" className="sr-only" />
              <TrendingUp className="h-5 w-5 text-red-600 rotate-180" />
              <span className="text-sm font-medium text-red-600">NO</span>
              <Badge variant="outline" className="mt-1 text-xs">
                @ {market.odds_no.toFixed(2)}
              </Badge>
            </Label>
          </RadioGroup>
        </div>

        {/* Stake Input */}
        <div className="space-y-2">
          <Label>Stake Amount</Label>
          <div className="relative">
            <Coins className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder={`Min ${MIN_STAKE} coins`}
              className="pl-10"
              min={MIN_STAKE}
              max={userBalance}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Balance: {userBalance.toLocaleString()}</span>
            <div className="flex gap-1">
              {[25, 50, 100].map((pct) => (
                <Button
                  key={pct}
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-xs"
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

        {/* Summary */}
        {stakeNum > 0 && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stake</span>
              <span>{stakeNum.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fee (2%)</span>
              <span className="text-orange-500">-{fee}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net Stake</span>
              <span>{netStake.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Odds</span>
              <span>{odds.toFixed(2)}x</span>
            </div>
            <div className="border-t pt-1 flex justify-between font-medium">
              <span>Potential Payout</span>
              <span className="text-green-600">
                {potentialPayout.toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {/* Errors */}
        {insufficientBalance && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="h-4 w-4" />
            Insufficient balance
          </div>
        )}

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={!isValid || placeBet.isPending}
          className={`w-full ${
            outcome === "yes"
              ? "bg-green-600 hover:bg-green-700"
              : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {placeBet.isPending && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          )}
          Place {outcome.toUpperCase()} Bet
        </Button>
      </CardContent>
    </Card>
  );
}
