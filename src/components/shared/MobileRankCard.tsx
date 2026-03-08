import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TeamRankCardProps {
  rank: number;
  teamName: string;
  mainValue: string;
  mainLabel: string;
  secondaryValue: string;
  secondaryLabel: string;
  tertiaryValue?: string;
  tertiaryLabel?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  warning?: React.ReactNode;
  tertiaryClassName?: string;
}

/**
 * Mobile-friendly card for team ranking data.
 * Replaces Table rows on small screens.
 */
export function TeamRankCard({
  rank,
  teamName,
  mainValue,
  mainLabel,
  secondaryValue,
  secondaryLabel,
  tertiaryValue,
  tertiaryLabel,
  badgeVariant = "default",
  warning,
  tertiaryClassName,
}: TeamRankCardProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
      <Badge variant={badgeVariant} className="w-8 h-8 flex items-center justify-center shrink-0 text-sm">
        {rank}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate flex items-center gap-1">
          {teamName}
          {warning}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>{secondaryLabel}: <span className="tabular-nums">{secondaryValue}</span></span>
          {tertiaryValue && (
            <span className={tertiaryClassName}>
              {tertiaryLabel}: <span className="tabular-nums">{tertiaryValue}</span>
            </span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold tabular-nums text-base">{mainValue}</div>
        <div className="text-[10px] text-muted-foreground">{mainLabel}</div>
      </div>
    </div>
  );
}

interface FixtureRankCardProps {
  rank: number;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  probability: string;
  probLabel: string;
  stats: { label: string; value: string }[];
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  qualityIcon?: React.ReactNode;
}

/**
 * Mobile-friendly card for fixture ranking data (SafeZone).
 */
export function FixtureRankCard({
  rank,
  homeTeam,
  awayTeam,
  kickoffTime,
  probability,
  probLabel,
  stats,
  badgeVariant = "default",
  qualityIcon,
}: FixtureRankCardProps) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
      <Badge variant={badgeVariant} className="w-8 h-8 flex items-center justify-center shrink-0 text-sm mt-0.5">
        {rank}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm flex items-center gap-1">
          {homeTeam}
          <span className="text-muted-foreground">vs</span>
          {awayTeam}
          {qualityIcon}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{kickoffTime}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
          {stats.map((s, i) => (
            <span key={i}>
              {s.label}: <span className="tabular-nums font-medium text-foreground">{s.value}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold tabular-nums text-base">{probability}</div>
        <div className="text-[10px] text-muted-foreground">{probLabel}</div>
      </div>
    </div>
  );
}
