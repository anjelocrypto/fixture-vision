import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus, Target, Flame, Snowflake, Activity } from "lucide-react";
import { useBasketballFixtureAnalysis, type FixtureAnalysis } from "@/hooks/useBasketballFixtureAnalysis";
import { cn } from "@/lib/utils";

interface BasketballFixtureAnalyzerProps {
  gameId: number | null;
}

const LEAGUE_LABELS: Record<string, string> = {
  nba: "NBA",
  euroleague: "EuroLeague",
  eurocup: "EuroCup",
  acb: "ACB",
  bbl: "BBL",
  lnb: "LNB Pro A",
  nbl: "NBL",
  bsl: "BSL",
  vtb: "VTB United",
  adriatic: "ABA League",
};

export function BasketballFixtureAnalyzer({ gameId }: BasketballFixtureAnalyzerProps) {
  const { data: analysis, isLoading, error } = useBasketballFixtureAnalysis(gameId);

  if (!gameId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6">
        <Target className="h-12 w-12 mb-4 opacity-50" />
        <p className="font-medium">Select a game to analyze</p>
        <p className="text-sm">Click on a fixture to see detailed stats</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-destructive p-6">
        <p className="font-medium">Failed to load analysis</p>
        <p className="text-sm">{error?.message || "Game not found"}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <Card className="bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-orange-500/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Badge variant="outline" className="text-orange-500 border-orange-500/50">
              {LEAGUE_LABELS[analysis.league_key] || analysis.league_key}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {format(new Date(analysis.date), "MMM d, HH:mm")}
            </span>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold">
              {analysis.home_team.team_name} vs {analysis.away_team.team_name}
            </h2>
          </div>
        </CardContent>
      </Card>

      {/* Combined Assessment */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Expected Total Points</p>
              <p className="text-2xl font-bold">{analysis.combined.expected_total}</p>
            </div>
            <MatchupBadge assessment={analysis.combined.matchup_assessment} />
          </div>
        </CardContent>
      </Card>

      {/* Team Stats Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TeamStatsCard team={analysis.home_team} isHome />
        <TeamStatsCard team={analysis.away_team} isHome={false} />
      </div>

      {/* Last 5 Games Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Last5GamesCard team={analysis.home_team} />
        <Last5GamesCard team={analysis.away_team} />
      </div>
    </div>
  );
}

function MatchupBadge({ assessment }: { assessment: "HIGH" | "MEDIUM" | "LOW" }) {
  const config = {
    HIGH: { label: "High Scoring", icon: Flame, className: "bg-red-500/10 text-red-500 border-red-500/30" },
    MEDIUM: { label: "Average", icon: Activity, className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30" },
    LOW: { label: "Low Scoring", icon: Snowflake, className: "bg-blue-500/10 text-blue-500 border-blue-500/30" },
  };
  const { label, icon: Icon, className } = config[assessment];

  return (
    <Badge variant="outline" className={cn("px-3 py-1", className)}>
      <Icon className="h-4 w-4 mr-1" />
      {label}
    </Badge>
  );
}

interface TeamStatsCardProps {
  team: FixtureAnalysis["home_team"];
  isHome: boolean;
}

function TeamStatsCard({ team, isHome }: TeamStatsCardProps) {
  const hasEnoughData = team.sample_size >= 3;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="truncate">{team.team_name}</span>
          <Badge variant="outline" className="text-xs shrink-0 ml-2">
            {isHome ? "HOME" : "AWAY"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasEnoughData ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Not enough data yet ({team.sample_size} games)
          </p>
        ) : (
          <>
            {/* Record */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last 5 Record</span>
              <span className="font-semibold">
                <span className="text-green-500">{team.last5_wins}W</span>
                {" - "}
                <span className="text-red-500">{team.last5_losses}L</span>
              </span>
            </div>

            {/* PPG Scored */}
            <StatRow
              label="PPG Scored"
              value={team.last5_ppg_for}
              format="decimal"
              thresholds={{ high: 115, low: 105 }}
            />

            {/* PPG Against */}
            <StatRow
              label="PPG Against"
              value={team.last5_ppg_against}
              format="decimal"
              thresholds={{ high: 115, low: 105 }}
              inverse
            />

            {/* Total PPG */}
            <StatRow
              label="Total PPG"
              value={team.last5_ppg_total}
              format="decimal"
              thresholds={{ high: 225, low: 210 }}
            />

            {/* 3PM */}
            <StatRow
              label="3PM/Game"
              value={team.last5_tpm_avg}
              format="decimal"
              thresholds={{ high: 12, low: 9 }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface StatRowProps {
  label: string;
  value: number;
  format: "decimal" | "integer";
  thresholds: { high: number; low: number };
  inverse?: boolean;
}

function StatRow({ label, value, format, thresholds, inverse }: StatRowProps) {
  const displayValue = format === "decimal" ? value.toFixed(1) : Math.round(value);
  
  let trend: "up" | "down" | "neutral" = "neutral";
  if (value >= thresholds.high) trend = inverse ? "down" : "up";
  else if (value <= thresholds.low) trend = inverse ? "up" : "down";

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500" : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className="font-medium">{displayValue}</span>
        <TrendIcon className={cn("h-3 w-3", trendColor)} />
      </div>
    </div>
  );
}

function Last5GamesCard({ team }: { team: FixtureAnalysis["home_team"] }) {
  if (team.last5_games.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{team.team_name} - Last 5</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">No recent games</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{team.team_name} - Last 5</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-16">Date</TableHead>
              <TableHead className="text-xs">Opp</TableHead>
              <TableHead className="text-xs text-right">Score</TableHead>
              <TableHead className="text-xs text-right w-8">W/L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.last5_games.slice(0, 5).map((game) => (
              <TableRow key={game.game_id}>
                <TableCell className="text-xs py-1.5">
                  {format(new Date(game.date), "M/d")}
                </TableCell>
                <TableCell className="text-xs py-1.5 truncate max-w-[100px]">
                  {game.opponent}
                </TableCell>
                <TableCell className="text-xs py-1.5 text-right font-mono">
                  {game.points_for}-{game.points_against}
                </TableCell>
                <TableCell className="text-xs py-1.5 text-right">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs px-1.5 py-0",
                      game.result === "W"
                        ? "bg-green-500/10 text-green-500 border-green-500/30"
                        : "bg-red-500/10 text-red-500 border-red-500/30"
                    )}
                  >
                    {game.result}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
