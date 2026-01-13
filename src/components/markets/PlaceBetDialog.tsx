import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Coins, TrendingUp, AlertCircle, Loader2 } from "lucide-react";
import { Market, usePlaceBet } from "@/hooks/useMarkets";
import { toast } from "sonner";

interface PlaceBetDialogProps {
  market: Market | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userBalance: number;
}

const FEE_RATE = 0.02;
const MIN_FEE = 1;
const MIN_STAKE = 10;

export function PlaceBetDialog({ market, open, onOpenChange, userBalance }: PlaceBetDialogProps) {
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [stake, setStake] = useState("");
  
  const placeBet = usePlaceBet();

  // Reset form when market changes
  useEffect(() => {
    if (open) {
      setOutcome("yes");
      setStake("");
    }
  }, [open, market?.id]);

  if (!market) return null;

  const stakeNum = Number(stake) || 0;
  const fee = Math.max(MIN_FEE, Math.floor(stakeNum * FEE_RATE));
  const netStake = stakeNum - fee;
  const odds = outcome === "yes" ? market.odds_yes : market.odds_no;
  const potentialPayout = Math.floor(netStake * odds);

  const isValid = stakeNum >= MIN_STAKE && stakeNum <= userBalance;
  const insufficientBalance = stakeNum > userBalance;

  const handleSubmit = async () => {
    if (!isValid) return;

    try {
      await placeBet.mutateAsync({
        market_id: market.id,
        outcome,
        stake: stakeNum,
      });
      
      toast.success(`Bet placed! Potential payout: ${potentialPayout} coins`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to place bet");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Place Your Bet</DialogTitle>
          <DialogDescription className="text-sm">
            {market.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Outcome Selection */}
          <div className="space-y-2">
            <Label>Your Prediction</Label>
            <RadioGroup
              value={outcome}
              onValueChange={(v) => setOutcome(v as "yes" | "no")}
              className="grid grid-cols-2 gap-2"
            >
              <Label
                htmlFor="yes"
                className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  outcome === "yes"
                    ? "border-green-500 bg-green-500/10"
                    : "border-muted hover:border-green-500/50"
                }`}
              >
                <RadioGroupItem value="yes" id="yes" className="sr-only" />
                <div className="text-center">
                  <TrendingUp className="h-5 w-5 mx-auto text-green-600" />
                  <span className="text-sm font-medium text-green-600">YES</span>
                  <Badge variant="outline" className="ml-1">
                    @ {market.odds_yes.toFixed(2)}
                  </Badge>
                </div>
              </Label>
              <Label
                htmlFor="no"
                className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  outcome === "no"
                    ? "border-red-500 bg-red-500/10"
                    : "border-muted hover:border-red-500/50"
                }`}
              >
                <RadioGroupItem value="no" id="no" className="sr-only" />
                <div className="text-center">
                  <TrendingUp className="h-5 w-5 mx-auto text-red-600 rotate-180" />
                  <span className="text-sm font-medium text-red-600">NO</span>
                  <Badge variant="outline" className="ml-1">
                    @ {market.odds_no.toFixed(2)}
                  </Badge>
                </div>
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
              <span>Available: {userBalance.toLocaleString()}</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-xs"
                  onClick={() => setStake(String(Math.floor(userBalance * 0.25)))}
                >
                  25%
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-xs"
                  onClick={() => setStake(String(Math.floor(userBalance * 0.5)))}
                >
                  50%
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-xs"
                  onClick={() => setStake(String(userBalance))}
                >
                  MAX
                </Button>
              </div>
            </div>
          </div>

          {/* Summary */}
          {stakeNum > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stake</span>
                <span>{stakeNum.toLocaleString()} coins</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee (2%)</span>
                <span className="text-orange-500">-{fee} coins</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net Stake</span>
                <span>{netStake.toLocaleString()} coins</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Odds</span>
                <span>{odds.toFixed(2)}x</span>
              </div>
              <div className="border-t pt-1 flex justify-between font-medium">
                <span>Potential Payout</span>
                <span className="text-green-600">{potentialPayout.toLocaleString()} coins</span>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || placeBet.isPending}
            className={outcome === "yes" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
          >
            {placeBet.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Place {outcome.toUpperCase()} Bet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
