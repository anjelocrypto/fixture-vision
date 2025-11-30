import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Activity } from "lucide-react";

interface InjuredPlayer {
  player_name: string;
  position: string | null;
  status: string;
  injury_type: string | null;
  importance?: number;
}

interface InjuriesDisplayProps {
  homeTeam: string;
  awayTeam: string;
  homeInjuries: InjuredPlayer[];
  awayInjuries: InjuredPlayer[];
}

export function InjuriesDisplay({
  homeTeam,
  awayTeam,
  homeInjuries,
  awayInjuries,
}: InjuriesDisplayProps) {
  const hasHomeInjuries = homeInjuries.length > 0;
  const hasAwayInjuries = awayInjuries.length > 0;
  const hasAnyInjuries = hasHomeInjuries || hasAwayInjuries;

  const getStatusColor = (status: string) => {
    const lower = status.toLowerCase();
    if (lower === 'injured') return 'destructive';
    if (lower === 'doubtful') return 'secondary';
    if (lower === 'suspended') return 'outline';
    return 'default';
  };

  const PlayerRow = ({ player }: { player: InjuredPlayer }) => (
    <div className="flex items-start gap-2 py-2 border-b last:border-0">
      <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {player.player_name}
            {player.importance !== undefined && player.importance >= 0.6 && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({(player.importance * 100).toFixed(0)}%)
              </span>
            )}
          </span>
          {player.position && (
            <Badge variant="outline" className="text-xs">
              {player.position}
            </Badge>
          )}
          <Badge variant={getStatusColor(player.status)} className="text-xs">
            {player.status}
          </Badge>
        </div>
        {player.injury_type && (
          <p className="text-xs text-muted-foreground mt-1">
            {player.injury_type}
          </p>
        )}
      </div>
    </div>
  );
  
  // Calculate injury impact message based on player importance
  const getInjuryImpactMessage = (injuries: InjuredPlayer[]) => {
    if (injuries.length === 0) return null;
    
    const maxImportance = Math.max(...injuries.map(inj => inj.importance || 0));
    const count = injuries.length;
    
    if (maxImportance < 0.5) return null; // No impact for bench players
    
    let reduction = 0;
    if (maxImportance < 0.7) reduction = 5;
    else if (maxImportance < 0.85) reduction = 10;
    else reduction = count >= 2 ? 20 : 15;
    
    return `−${reduction}% attacking goals`;
  };

  if (!hasAnyInjuries) {
    return (
      <Card className="p-4 bg-muted/20 border-dashed">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold text-muted-foreground">Injuries & Availability</h4>
        </div>
        <p className="text-xs text-muted-foreground italic">
          No key attacking injuries detected for either team.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-warning/5 border-warning/20">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-warning" />
        <h4 className="text-sm font-semibold">Injuries & Availability</h4>
      </div>

      {/* Home Team Injuries */}
      {hasHomeInjuries && (
        <div className="mb-4 last:mb-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground">{homeTeam}</span>
            {getInjuryImpactMessage(homeInjuries) && (
              <Badge variant="destructive" className="text-xs">
                {getInjuryImpactMessage(homeInjuries)}
              </Badge>
            )}
          </div>
          <div className="space-y-0 bg-background/50 rounded-md p-2">
            {homeInjuries.map((player, idx) => (
              <PlayerRow key={idx} player={player} />
            ))}
          </div>
        </div>
      )}

      {/* Away Team Injuries */}
      {hasAwayInjuries && (
        <div className={hasHomeInjuries ? "pt-4 border-t" : ""}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground">{awayTeam}</span>
            {getInjuryImpactMessage(awayInjuries) && (
              <Badge variant="destructive" className="text-xs">
                {getInjuryImpactMessage(awayInjuries)}
              </Badge>
            )}
          </div>
          <div className="space-y-0 bg-background/50 rounded-md p-2">
            {awayInjuries.map((player, idx) => (
              <PlayerRow key={idx} player={player} />
            ))}
          </div>
        </div>
      )}

      {!hasHomeInjuries && hasAwayInjuries && (
        <div className="mb-3">
          <span className="text-xs text-muted-foreground">{homeTeam}: No key injuries</span>
        </div>
      )}
      {hasHomeInjuries && !hasAwayInjuries && (
        <div className="pt-3 border-t">
          <span className="text-xs text-muted-foreground">{awayTeam}: No key injuries</span>
        </div>
      )}
    </Card>
  );
}
