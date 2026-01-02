import { format, isToday, isTomorrow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, ChevronRight, Activity } from "lucide-react";
import { useBasketballFixtures, groupGamesByDate, type BasketballGame } from "@/hooks/useBasketballFixtures";
import { cn } from "@/lib/utils";

interface BasketballCenterRailProps {
  selectedCompetition: string | null;
  selectedDate: "today" | "tomorrow";
  onSelectDate: (date: "today" | "tomorrow") => void;
  onAnalyze: (game: BasketballGame) => void;
  selectedGameId?: number | null;
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

export function BasketballCenterRail({
  selectedCompetition,
  selectedDate,
  onSelectDate,
  onAnalyze,
  selectedGameId,
}: BasketballCenterRailProps) {
  const { data: games = [], isLoading } = useBasketballFixtures({ leagueKey: selectedCompetition });
  const grouped = groupGamesByDate(games);
  const displayGames = selectedDate === "today" ? grouped.today : grouped.tomorrow;

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return (
    <div className="flex flex-col h-full">
      {/* Date Strip */}
      <div className="flex items-center gap-2 p-3 border-b border-border bg-card/30">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-2">
          <Button
            variant={selectedDate === "today" ? "default" : "outline"}
            size="sm"
            onClick={() => onSelectDate("today")}
            className="text-xs"
          >
            Today · {format(today, "MMM d")}
          </Button>
          <Button
            variant={selectedDate === "tomorrow" ? "default" : "outline"}
            size="sm"
            onClick={() => onSelectDate("tomorrow")}
            className="text-xs"
          >
            Tomorrow · {format(tomorrow, "MMM d")}
          </Button>
        </div>
        {grouped.today.length + grouped.tomorrow.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {grouped.today.length + grouped.tomorrow.length} games in 48h
          </span>
        )}
      </div>

      {/* Games List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!selectedCompetition && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Activity className="h-12 w-12 mb-4 opacity-50" />
            <p className="font-medium">Select a league</p>
            <p className="text-sm">Choose a competition from the left panel</p>
          </div>
        )}

        {selectedCompetition && isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {selectedCompetition && !isLoading && displayGames.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Calendar className="h-12 w-12 mb-4 opacity-50" />
            <p className="font-medium">No games scheduled</p>
            <p className="text-sm">
              No {LEAGUE_LABELS[selectedCompetition] || selectedCompetition} games{" "}
              {selectedDate === "today" ? "today" : "tomorrow"}
            </p>
          </div>
        )}

        {displayGames.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            onAnalyze={() => onAnalyze(game)}
            isSelected={selectedGameId === game.id}
          />
        ))}
      </div>
    </div>
  );
}

interface GameCardProps {
  game: BasketballGame;
  onAnalyze: () => void;
  isSelected?: boolean;
}

function GameCard({ game, onAnalyze, isSelected }: GameCardProps) {
  const gameDate = new Date(game.date);
  const timeStr = format(gameDate, "HH:mm");

  return (
    <Card
      className={cn(
        "p-3 hover:bg-accent/50 transition-colors cursor-pointer",
        isSelected && "ring-2 ring-primary bg-accent/30"
      )}
      onClick={onAnalyze}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-orange-500 uppercase">
              {LEAGUE_LABELS[game.league_key] || game.league_key}
            </span>
            <span className="text-xs text-muted-foreground">{timeStr}</span>
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-sm truncate">{game.home_team_name}</p>
            <p className="text-sm text-muted-foreground truncate">vs {game.away_team_name}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0 ml-2">
          Analyze
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  );
}
