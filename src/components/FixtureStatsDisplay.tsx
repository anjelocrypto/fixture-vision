import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InjuriesDisplay } from "./InjuriesDisplay";

interface TeamStats {
  goals: number;
  corners: number | null;
  cards: number | null;
  fouls: number | null;
  offsides: number | null;
  sample_size: number;
}

interface H2HStats {
  goals: number;
  corners: number | null;
  cards: number | null;
  fouls: number | null;
  offsides: number | null;
  sample_size: number;
}

interface InjuredPlayer {
  player_name: string;
  position: string | null;
  status: string;
  injury_type: string | null;
}

interface FixtureStatsDisplayProps {
  homeTeam: string;
  awayTeam: string;
  homeStats: TeamStats | null;
  awayStats: TeamStats | null;
  h2hStats: H2HStats | null;
  combinedSnapshot: Record<string, number>;
  homeInjuries?: InjuredPlayer[];
  awayInjuries?: InjuredPlayer[];
}

export function FixtureStatsDisplay({
  homeTeam,
  awayTeam,
  homeStats,
  awayStats,
  h2hStats,
  combinedSnapshot,
  homeInjuries = [],
  awayInjuries = [],
}: FixtureStatsDisplayProps) {
  const { t } = useTranslation('common');

  const StatRow = ({ 
    label, 
    value, 
    className = "" 
  }: { 
    label: string; 
    value: number | null | undefined; 
    className?: string 
  }) => {
    let display: string;
    
    if (value === null || value === undefined || Number.isNaN(value)) {
      display = '—';
    } else {
      display = value.toFixed(2);
    }
    
    return (
      <div className="flex justify-between items-center py-1.5 border-b last:border-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-sm font-semibold ${className}`}>{display}</span>
      </div>
    );
  };

  return (
    <div className="space-y-3 mt-4">
      {/* Home Team Stats */}
      {homeStats && (
        homeStats.sample_size < 3 ? (
          <Card className="p-4 bg-muted/20 border-dashed">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold text-muted-foreground">{homeTeam} - Last 5 Matches</h4>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Insufficient data available. Team has only {homeStats.sample_size} completed {homeStats.sample_size === 1 ? 'match' : 'matches'} in the current season (minimum 3 required for reliable stats).
            </p>
          </Card>
        ) : (
          <Card className="p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">{homeTeam} - Last 5 Matches</h4>
              <Badge variant="outline" className="text-xs ml-auto">
                {homeStats.sample_size} games
              </Badge>
            </div>
            <div className="space-y-0">
              <StatRow label="Goals" value={homeStats.goals} className="text-primary" />
              <StatRow label="Corners" value={homeStats.corners} />
              <StatRow label="Cards" value={homeStats.cards} />
              <StatRow label="Fouls" value={homeStats.fouls} />
              <StatRow label="Offsides" value={homeStats.offsides} />
            </div>
          </Card>
        )
      )}

      {/* Away Team Stats */}
      {awayStats && (
        awayStats.sample_size < 3 ? (
          <Card className="p-4 bg-muted/20 border-dashed">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold text-muted-foreground">{awayTeam} - Last 5 Matches</h4>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Insufficient data available. Team has only {awayStats.sample_size} completed {awayStats.sample_size === 1 ? 'match' : 'matches'} in the current season (minimum 3 required for reliable stats).
            </p>
          </Card>
        ) : (
          <Card className="p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">{awayTeam} - Last 5 Matches</h4>
              <Badge variant="outline" className="text-xs ml-auto">
                {awayStats.sample_size} games
              </Badge>
            </div>
            <div className="space-y-0">
              <StatRow label="Goals" value={awayStats.goals} className="text-primary" />
              <StatRow label="Corners" value={awayStats.corners} />
              <StatRow label="Cards" value={awayStats.cards} />
              <StatRow label="Fouls" value={awayStats.fouls} />
              <StatRow label="Offsides" value={awayStats.offsides} />
            </div>
          </Card>
        )
      )}

      {/* H2H Stats */}
      {h2hStats && h2hStats.sample_size >= 3 ? (
        <Card className="p-4 bg-primary/5 border-primary/20">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Head-to-Head Averages (Last 5 Matches)</h4>
            <Badge variant="default" className="text-xs ml-auto">
              {h2hStats.sample_size} H2H games
            </Badge>
          </div>
          <div className="space-y-0">
            <StatRow label="Goals" value={h2hStats.goals} className="text-primary" />
            <StatRow label="Corners" value={h2hStats.corners} />
            <StatRow label="Cards" value={h2hStats.cards} />
            <StatRow label="Fouls" value={h2hStats.fouls} />
            <StatRow label="Offsides" value={h2hStats.offsides} />
          </div>
        </Card>
      ) : (
        <Card className="p-4 bg-muted/20 border-dashed">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold text-muted-foreground">Head-to-Head Averages</h4>
          </div>
          <p className="text-xs text-muted-foreground italic">
            No recent head-to-head data available.
          </p>
        </Card>
      )}

      {/* Injuries & Availability - New card inserted before Combined */}
      <InjuriesDisplay
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        homeInjuries={homeInjuries}
        awayInjuries={awayInjuries}
      />

      {/* Combined Stats */}
      {combinedSnapshot && Object.keys(combinedSnapshot).length > 0 && (
        <Card className="p-4 bg-secondary/10 border-secondary/30">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-secondary-foreground" />
            <h4 className="text-sm font-semibold">Combined Averages (Model Formula)</h4>
          </div>
          <div className="space-y-0">
            {combinedSnapshot.goals !== undefined && (
              <StatRow label="Goals" value={combinedSnapshot.goals} className="text-secondary-foreground" />
            )}
            {combinedSnapshot.corners !== undefined && (
              <StatRow label="Corners" value={combinedSnapshot.corners} />
            )}
            {combinedSnapshot.cards !== undefined && (
              <StatRow label="Cards" value={combinedSnapshot.cards} />
            )}
            {combinedSnapshot.fouls !== undefined && (
              <StatRow label="Fouls" value={combinedSnapshot.fouls} />
            )}
            {combinedSnapshot.offsides !== undefined && (
              <StatRow label="Offsides" value={combinedSnapshot.offsides} />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
