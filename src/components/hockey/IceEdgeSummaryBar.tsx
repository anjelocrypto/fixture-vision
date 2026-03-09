import type { IceEdgeGame } from "@/hooks/useHockeyIceEdge";

interface IceEdgeSummaryBarProps {
  games: IceEdgeGame[];
}

export function IceEdgeSummaryBar({ games }: IceEdgeSummaryBarProps) {
  const highConf = games.filter(g => g.confidence_tier === "high").length;
  const avgTotal = games.length > 0 
    ? (games.reduce((s, g) => s + g.projected_total, 0) / games.length).toFixed(1) 
    : "0";
  const avgOtRisk = games.length > 0
    ? (games.reduce((s, g) => s + g.ot_risk, 0) / games.length * 100).toFixed(0)
    : "0";
  const hotP1 = games.filter(g => g.p1_heat > 0.5).length;

  const stats = [
    { label: "High Conf", value: `${highConf}/${games.length}`, color: "text-emerald-400" },
    { label: "Avg Proj Total", value: avgTotal, color: "text-[hsl(200,70%,70%)]" },
    { label: "Avg OT Risk", value: `${avgOtRisk}%`, color: "text-amber-400" },
    { label: "Hot P1", value: String(hotP1), color: "text-orange-400" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="bg-card/60 border border-border/50 rounded-xl px-3 py-2.5 text-center">
          <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
