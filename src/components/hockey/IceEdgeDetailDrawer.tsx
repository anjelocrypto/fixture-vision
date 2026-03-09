import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Shield, Flame, Zap, Clock, TrendingUp, Target, AlertTriangle } from "lucide-react";
import type { IceEdgeGame } from "@/hooks/useHockeyIceEdge";
import { format } from "date-fns";

interface IceEdgeDetailDrawerProps {
  game: IceEdgeGame | null;
  open: boolean;
  onClose: () => void;
}

function tierBadge(tier: string) {
  const map: Record<string, string> = {
    high: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    low: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  return map[tier] || map.low;
}

export function IceEdgeDetailDrawer({ game, open, onClose }: IceEdgeDetailDrawerProps) {
  if (!game) return null;

  const homeName = game.home_team?.short_name || game.home_team?.name || `Team ${game.home_team_id}`;
  const awayName = game.away_team?.short_name || game.away_team?.name || `Team ${game.away_team_id}`;
  const puckDrop = new Date(game.puck_drop);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md bg-background border-border overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2 mb-1">
            {game.iceedge_rank && (
              <span className="w-7 h-7 rounded-lg bg-[hsl(200,50%,18%)] text-[hsl(200,60%,70%)] text-sm font-bold flex items-center justify-center font-mono">
                #{game.iceedge_rank}
              </span>
            )}
            <Badge variant="outline" className={`${tierBadge(game.confidence_tier)}`}>
              {game.confidence_tier} confidence
            </Badge>
          </div>
          <SheetTitle className="text-lg text-foreground">
            {homeName} vs {awayName}
          </SheetTitle>
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Clock className="h-3.5 w-3.5" />
            {format(puckDrop, "EEEE, MMM d · HH:mm")}
          </div>
          {game.home_league && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {game.home_league.logo && <img src={game.home_league.logo} className="h-4 w-4" alt="" />}
              {game.home_league.name}
            </div>
          )}
        </SheetHeader>

        <Separator className="my-3" />

        {/* Core projection */}
        <div className="text-center py-4">
          <div className="text-4xl font-bold font-mono text-[hsl(200,70%,75%)]">
            {game.projected_total}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Projected Total Goals</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {game.regulation_lean === "toss-up" ? "No clear lean" : `${game.regulation_lean === "home" ? homeName : awayName} lean`}
          </div>
        </div>

        <Separator className="my-3" />

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-3 py-2">
          <MetricBlock
            icon={<Zap className="h-4 w-4 text-emerald-400" />}
            label="Value Score"
            value={game.value_score.toFixed(3)}
            description="Edge vs market line"
          />
          <MetricBlock
            icon={<Shield className="h-4 w-4 text-purple-400" />}
            label="Chaos Score"
            value={game.chaos_score.toFixed(3)}
            description="Unpredictability"
          />
          <MetricBlock
            icon={<Flame className="h-4 w-4 text-orange-400" />}
            label="P1 Heat"
            value={game.p1_heat.toFixed(3)}
            description="1st period scoring"
          />
          <MetricBlock
            icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
            label="OT Risk"
            value={`${(game.ot_risk * 100).toFixed(0)}%`}
            description="Overtime probability"
          />
        </div>

        {/* Recommended markets */}
        {game.recommended_markets.length > 0 && (
          <>
            <Separator className="my-3" />
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5" />
                Recommended Markets
              </h3>
              <div className="space-y-1.5">
                {game.recommended_markets.map((m, i) => (
                  <div key={i} className="flex items-center justify-between bg-secondary/40 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {m.market.replace(/_/g, " ")} — {m.side}
                        {m.line !== undefined && <span className="text-muted-foreground ml-1">({m.line})</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{m.reason}</div>
                    </div>
                    <TrendingUp className="h-4 w-4 text-[hsl(200,60%,60%)]" />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Reasoning */}
        {game.reasoning && (
          <>
            <Separator className="my-3" />
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Analysis</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{game.reasoning}</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MetricBlock({ icon, label, value, description }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="bg-card/60 border border-border/50 rounded-xl p-3 space-y-1">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold font-mono text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{description}</div>
    </div>
  );
}
