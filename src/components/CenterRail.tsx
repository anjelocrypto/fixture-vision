import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { format, addDays } from "date-fns";
import { Loader2 } from "lucide-react";

interface Fixture {
  id: number;
  date: string;
  timestamp: number;
  teams_home: { id: number; name: string; logo: string };
  teams_away: { id: number; name: string; logo: string };
  status: string;
  stat_preview?: {
    combined: {
      goals: number;
      cards: number;
      corners: number;
      fouls: number;
      offsides: number;
    };
    home: any;
    away: any;
  };
}

interface League {
  id: number;
  name: string;
  logo: string;
}

interface CenterRailProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  league: League | null;
  fixtures: Fixture[];
  loading: boolean;
  onAnalyze: (fixture: Fixture) => void;
}

export function CenterRail({
  selectedDate,
  onSelectDate,
  league,
  fixtures,
  loading,
  onAnalyze,
}: CenterRailProps) {
  const dates = Array.from({ length: 5 }, (_, i) => addDays(new Date(), i));

  return (
    <>
      {/* Date Strip */}
      <div className="flex gap-2 overflow-x-auto pb-4 border-b border-border/50 mb-4">
        {dates.map((date) => (
          <Button
            key={date.toISOString()}
            onClick={() => onSelectDate(date)}
            variant={
              format(date, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd")
                ? "default"
                : "outline"
            }
            className="rounded-full shrink-0"
          >
            {format(date, "MMM d")}
          </Button>
        ))}
      </div>

      {/* League Header */}
      {league && (
        <div className="flex items-center gap-3 mb-4">
          <img src={league.logo} alt={league.name} className="w-8 h-8" />
          <h2 className="text-xl font-semibold">{league.name}</h2>
        </div>
      )}

      {/* Fixtures List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : fixtures.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground mb-4">No fixtures for this date.</p>
          <Button variant="outline" onClick={() => onSelectDate(addDays(selectedDate, 1))}>
            Show next day
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {fixtures.map((fixture) => (
            <Card
              key={fixture.id}
              className="p-4 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 space-y-3">
                  {/* Time */}
                  <div className="text-sm text-muted-foreground">
                    {format(new Date(fixture.timestamp * 1000), "HH:mm")} •{" "}
                    {format(new Date(fixture.timestamp * 1000), "MMM d")}
                  </div>

                  {/* Teams */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <img
                        src={fixture.teams_home.logo}
                        alt={fixture.teams_home.name}
                        className="w-6 h-6"
                      />
                      <span className="font-medium">{fixture.teams_home.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <img
                        src={fixture.teams_away.logo}
                        alt={fixture.teams_away.name}
                        className="w-6 h-6"
                      />
                      <span className="font-medium">{fixture.teams_away.name}</span>
                    </div>
                  </div>

                  {/* Show stat preview if available (from Filterizer) */}
                  {fixture.stat_preview && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <div className="text-xs text-muted-foreground mb-1">Combined Averages:</div>
                      <div className="flex gap-3 text-xs">
                        <span className="tabular-nums">⚽ {fixture.stat_preview.combined.goals.toFixed(1)}</span>
                        <span className="tabular-nums">🟨 {fixture.stat_preview.combined.cards.toFixed(1)}</span>
                        <span className="tabular-nums">🏁 {fixture.stat_preview.combined.corners.toFixed(1)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Analyze Button */}
                <Button
                  onClick={() => onAnalyze(fixture)}
                  className="rounded-full"
                >
                  Analyse
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
