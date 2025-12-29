import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertTriangle, Target, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BasketballSafeZonePanelProps {
  selectedCompetition: string | null;
}

interface GameResult {
  game_id: number;
  league_key: string;
  league_name: string;
  date: string;
  time: string;
  home_team: string;
  away_team: string;
  home_ppg: number;
  away_ppg: number;
  home_papg: number;
  away_papg: number;
  mu_points: number;
  book_line: number | null;
  safe_zone_prob: number;
  data_quality: "high" | "medium" | "low";
}

const LEAGUE_OPTIONS = [
  { key: "nba", name: "NBA", emoji: "🏀" },
  { key: "nba_gleague", name: "G-League", emoji: "🏀" },
  { key: "euroleague", name: "EuroLeague", emoji: "🇪🇺" },
  { key: "eurocup", name: "EuroCup", emoji: "🇪🇺" },
  { key: "spain_acb", name: "Liga ACB", emoji: "🇪🇸" },
  { key: "germany_bbl", name: "BBL", emoji: "🇩🇪" },
  { key: "italy_lba", name: "Lega A", emoji: "🇮🇹" },
];

export function BasketballSafeZonePanel({ selectedCompetition }: BasketballSafeZonePanelProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();

  const [leagueKey, setLeagueKey] = useState<string>(selectedCompetition || "nba");
  const [daysAhead, setDaysAhead] = useState<string>("3");
  const [results, setResults] = useState<GameResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<any>(null);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("basketball-safe-zone", {
        body: {
          league_key: leagueKey,
          days_ahead: parseInt(daysAhead),
          limit: 30,
        },
      });

      if (error) throw error;

      if (!data || !data.games) {
        throw new Error("Invalid response from server");
      }

      setResults(data.games);
      setMeta(data.meta);

      if (data.games.length === 0) {
        toast({
          title: "No Games Found",
          description: `No upcoming games found for ${data.league_name}`,
        });
      } else {
        toast({
          title: "Rankings Generated",
          description: `${data.games.length} games ranked by total points probability`,
        });
      }
    } catch (error: any) {
      console.error("Error fetching basketball safe zone data:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to generate rankings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getProbBadgeVariant = (prob: number): "destructive" | "default" | "secondary" | "outline" => {
    if (prob >= 0.65) return "destructive"; // Hot
    if (prob >= 0.55) return "default";
    if (prob >= 0.45) return "secondary";
    return "outline";
  };

  const formatProbability = (prob: number) => `${Math.round(prob * 100)}%`;

  const formatDateTime = (date: string, time: string) => {
    const dateObj = new Date(`${date}T${time}`);
    return dateObj.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getDataQualityIcon = (quality: string) => {
    if (quality === "low") {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            </TooltipTrigger>
            <TooltipContent>Low sample size - less reliable</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return null;
  };

  // Update league when prop changes
  if (selectedCompetition && selectedCompetition !== leagueKey) {
    setLeagueKey(selectedCompetition);
    setResults([]);
    setMeta(null);
  }

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-orange-500" />
            Points Safe Zone
          </CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Games ranked by probability of high total points
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="grid grid-cols-2 gap-3">
          {/* League Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Competition
            </label>
            <Select value={leagueKey} onValueChange={(v) => {
              setLeagueKey(v);
              setResults([]);
              setMeta(null);
            }}>
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder="Select league" />
              </SelectTrigger>
              <SelectContent className="bg-popover border border-border z-50">
                {LEAGUE_OPTIONS.map((league) => (
                  <SelectItem key={league.key} value={league.key}>
                    <span className="flex items-center gap-2">
                      <span>{league.emoji}</span>
                      <span>{league.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Days Ahead Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Days Ahead
            </label>
            <Select value={daysAhead} onValueChange={setDaysAhead}>
              <SelectTrigger className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border border-border z-50">
                <SelectItem value="1">Today</SelectItem>
                <SelectItem value="2">2 days</SelectItem>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="5">5 days</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Generate Button */}
        <div className="flex gap-2">
          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="flex-1 gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <TrendingUp className="h-4 w-4" />
                Show Rankings
              </>
            )}
          </Button>
          {results.length > 0 && (
            <Button variant="outline" size="icon" onClick={handleGenerate} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>

        {/* Results Table */}
        {results.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[180px]">Match</TableHead>
                  <TableHead className="text-center w-[100px]">Date/Time</TableHead>
                  <TableHead className="text-right w-16">Prob</TableHead>
                  <TableHead className="text-right w-20">xPoints</TableHead>
                  <TableHead className="text-right w-20">Line</TableHead>
                  <TableHead className="text-center w-20">PPG</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((game, idx) => (
                  <TableRow 
                    key={game.game_id} 
                    className={idx === 0 ? "bg-primary/5" : ""}
                  >
                    <TableCell className="py-3">
                      <div className="flex flex-col gap-0.5">
                        <div className="font-medium text-sm flex items-center gap-1">
                          {game.home_team}
                          {getDataQualityIcon(game.data_quality)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          vs {game.away_team}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground">
                      {formatDateTime(game.date, game.time)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge 
                        variant={getProbBadgeVariant(game.safe_zone_prob)}
                        className="font-bold tabular-nums"
                      >
                        {formatProbability(game.safe_zone_prob)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {game.mu_points}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {game.book_line || "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="text-xs tabular-nums">
                              {game.home_ppg} / {game.away_ppg}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <p>Home PPG: {game.home_ppg} | PAPG: {game.home_papg}</p>
                              <p>Away PPG: {game.away_ppg} | PAPG: {game.away_papg}</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Target className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Select a competition and click "Show Rankings"</p>
            <p className="text-xs mt-1">to see games ranked by high scoring probability</p>
          </div>
        )}

        {/* Meta Info */}
        {meta && (
          <div className="text-xs text-muted-foreground text-center pt-2 border-t">
            Generated at {new Date(meta.generated_at).toLocaleTimeString()} • 
            {meta.teams_with_stats} teams with stats • 
            {meta.processing_ms}ms
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-xs text-muted-foreground/60 text-center">
          Probabilities are estimates based on season averages. Not financial advice.
        </div>
      </CardContent>
    </Card>
  );
}
