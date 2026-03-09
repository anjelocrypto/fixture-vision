import { Shield, Flame, Zap, TrendingUp, Clock, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { IceEdgeGame } from "@/hooks/useHockeyIceEdge";
import { format } from "date-fns";

interface IceEdgeCardProps {
  game: IceEdgeGame;
  onClick: () => void;
}

function tierColor(tier: string) {
  if (tier === "high") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (tier === "medium") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
}

function leanLabel(lean: string) {
  if (lean === "home") return "Home lean";
  if (lean === "away") return "Away lean";
  return "Toss-up";
}

export function IceEdgeCard({ game, onClick }: IceEdgeCardProps) {
  const homeName = game.home_team?.short_name || game.home_team?.name || `Team ${game.home_team_id}`;
  const awayName = game.away_team?.short_name || game.away_team?.name || `Team ${game.away_team_id}`;
  const puckDrop = new Date(game.puck_drop);
  const timeStr = format(puckDrop, "HH:mm");
  const dateStr = format(puckDrop, "MMM d");

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card/70 hover:bg-card border border-border/50 hover:border-[hsl(200,40%,30%)] rounded-xl p-4 transition-all duration-200 group"
    >
      {/* Top row: rank + time + confidence */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {game.iceedge_rank && (
            <span className="w-6 h-6 rounded-md bg-[hsl(200,50%,18%)] text-[hsl(200,60%,70%)] text-xs font-bold flex items-center justify-center font-mono">
              {game.iceedge_rank}
            </span>
          )}
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="text-xs">{dateStr} · {timeStr}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] h-5 ${tierColor(game.confidence_tier)}`}>
            {game.confidence_tier}
          </Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
        </div>
      </div>

      {/* Teams */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            {game.home_team?.logo && (
              <img src={game.home_team.logo} alt="" className="w-5 h-5 object-contain" />
            )}
            <span className={`text-sm font-semibold ${game.regulation_lean === "home" ? "text-[hsl(200,70%,75%)]" : "text-foreground"}`}>
              {homeName}
            </span>
            {game.regulation_lean === "home" && <TrendingUp className="h-3 w-3 text-[hsl(200,70%,60%)]" />}
          </div>
          <div className="flex items-center gap-2">
            {game.away_team?.logo && (
              <img src={game.away_team.logo} alt="" className="w-5 h-5 object-contain" />
            )}
            <span className={`text-sm font-semibold ${game.regulation_lean === "away" ? "text-[hsl(200,70%,75%)]" : "text-foreground"}`}>
              {awayName}
            </span>
            {game.regulation_lean === "away" && <TrendingUp className="h-3 w-3 text-[hsl(200,70%,60%)]" />}
          </div>
        </div>

        {/* Projected total */}
        <div className="text-center px-3 py-1.5 rounded-lg bg-[hsl(200,40%,12%)] border border-[hsl(200,30%,20%)]">
          <div className="text-lg font-bold font-mono text-[hsl(200,70%,75%)]">{game.projected_total}</div>
          <div className="text-[9px] text-[hsl(200,20%,50%)] uppercase tracking-wider">Proj Total</div>
        </div>
      </div>

      {/* Metrics bar */}
      <div className="grid grid-cols-4 gap-1.5">
        <MetricPill icon={<Zap className="h-3 w-3" />} label="Value" value={game.value_score} color="emerald" />
        <MetricPill icon={<Flame className="h-3 w-3" />} label="P1" value={game.p1_heat} color="orange" />
        <MetricPill icon={<Shield className="h-3 w-3" />} label="Chaos" value={game.chaos_score} color="purple" />
        <MetricPill label="OT" value={game.ot_risk} color="amber" suffix="%" multiply={100} />
      </div>

      {/* Recommended markets */}
      {game.recommended_markets.length > 0 && (
        <div className="flex gap-1 mt-2.5 flex-wrap">
          {game.recommended_markets.slice(0, 3).map((m, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(200,40%,15%)] text-[hsl(200,30%,65%)] border border-[hsl(200,30%,22%)]">
              {m.market.replace("_", " ")} {m.side}{m.line ? ` ${m.line}` : ""}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function MetricPill({ icon, label, value, color, suffix, multiply }: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  color: string;
  suffix?: string;
  multiply?: number;
}) {
  const display = multiply ? (value * multiply).toFixed(0) : value.toFixed(2);
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-400",
    orange: "text-orange-400",
    purple: "text-purple-400",
    amber: "text-amber-400",
  };

  return (
    <div className="flex items-center gap-1 bg-secondary/40 rounded-md px-1.5 py-1 justify-center">
      {icon && <span className={colorMap[color] || "text-muted-foreground"}>{icon}</span>}
      <span className={`text-[11px] font-mono font-medium ${colorMap[color]}`}>
        {display}{suffix || ""}
      </span>
    </div>
  );
}
