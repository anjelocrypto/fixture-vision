import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, X, Swords, AlertTriangle } from "lucide-react";
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

interface CardWarPanelProps {
  onClose: () => void;
}

type Mode = 'cards' | 'fouls';

interface TeamRanking {
  rank: number;
  team_id: number;
  team_name: string;
  avg_value: number;
  total_value: number;
  matches_used: number;
}

interface LeagueInfo {
  id: number;
  name: string;
  country: string;
}

// Supported leagues grouped by country (same as Who Concedes / Scores)
const LEAGUES_BY_COUNTRY: Record<string, { id: number; name: string }[]> = {
  england: [
    { id: 39, name: "Premier League" },
    { id: 40, name: "Championship" },
    { id: 41, name: "League One" },
    { id: 42, name: "League Two" },
  ],
  spain: [
    { id: 140, name: "La Liga" },
    { id: 141, name: "La Liga 2" },
  ],
  germany: [
    { id: 78, name: "Bundesliga" },
    { id: 79, name: "2. Bundesliga" },
  ],
  italy: [
    { id: 135, name: "Serie A" },
    { id: 136, name: "Serie B" },
  ],
  netherlands: [
    { id: 88, name: "Eredivisie" },
    { id: 89, name: "Eerste Divisie" },
  ],
};

const COUNTRY_KEYS = Object.keys(LEAGUES_BY_COUNTRY);

export function CardWarPanel({ onClose }: CardWarPanelProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>('cards');
  const [selectedCountry, setSelectedCountry] = useState<string>("england");
  const [selectedLeagueId, setSelectedLeagueId] = useState<number>(39); // Premier League default
  const [maxMatches, setMaxMatches] = useState<number>(10);
  const [results, setResults] = useState<TeamRanking[]>([]);
  const [leagueInfo, setLeagueInfo] = useState<LeagueInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const availableLeagues = LEAGUES_BY_COUNTRY[selectedCountry] || [];

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setResults([]);
    setLeagueInfo(null);
    setGeneratedAt(null);
  };

  const handleCountryChange = (country: string) => {
    setSelectedCountry(country);
    const leagues = LEAGUES_BY_COUNTRY[country];
    if (leagues && leagues.length > 0) {
      setSelectedLeagueId(leagues[0].id);
    }
    setResults([]);
    setLeagueInfo(null);
    setGeneratedAt(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("card-war", {
        body: { 
          league_id: selectedLeagueId,
          max_matches: maxMatches,
          mode,
        },
      });

      if (error) throw error;

      if (!data || !data.rankings) {
        throw new Error("Invalid response from server");
      }

      setResults(data.rankings);
      setLeagueInfo(data.league);
      setGeneratedAt(data.generated_at);

      if (data.rankings.length === 0) {
        toast({
          title: t('card_war_no_data_title', 'Not enough data'),
          description: t('card_war_no_data_desc', 'There is not enough card/foul data for this league yet. Try another one.'),
        });
      } else {
        toast({
          title: t('ranking_generated', 'Ranking generated'),
          description: t('card_war_ranking_desc', '{{count}} teams ranked by {{mode}}', { 
            count: data.rankings.length,
            mode: mode === 'cards' ? t('card_war_mode_cards', 'Cards') : t('card_war_mode_fouls', 'Fouls')
          }),
        });
      }
    } catch (error: any) {
      console.error("Error fetching Card War data:", error);
      toast({
        title: t('error', 'Error'),
        description: error.message || "Failed to generate ranking",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    if (selectedLeagueId) {
      handleGenerate();
    }
  };

  // Get color class based on rank (top teams are most aggressive)
  const getRankBadgeVariant = (rank: number): "destructive" | "secondary" | "outline" => {
    if (rank <= 3) return "destructive"; // Top 3 (most aggressive)
    if (rank <= 6) return "secondary";
    return "outline";
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Swords className="h-5 w-5 text-destructive" />
            {t('card_war_title', 'Card War – Cards & Fouls Radar')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('card_war_description', 'Find the most aggressive teams by cards and fouls in each league.')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode Toggle */}
        <div className="flex gap-2">
          <Button
            variant={mode === 'cards' ? 'default' : 'outline'}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => handleModeChange('cards')}
          >
            <AlertTriangle className="h-4 w-4" />
            {t('card_war_mode_cards', 'Cards')}
          </Button>
          <Button
            variant={mode === 'fouls' ? 'default' : 'outline'}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => handleModeChange('fouls')}
          >
            <Swords className="h-4 w-4" />
            {t('card_war_mode_fouls', 'Fouls')}
          </Button>
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-2 gap-3">
          {/* Country Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('who_concedes_country', 'Country')}
            </label>
            <Select value={selectedCountry} onValueChange={handleCountryChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('who_concedes_country', 'Country')} />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_KEYS.map((countryKey) => (
                  <SelectItem key={countryKey} value={countryKey}>
                    {t(`country_${countryKey}`, countryKey.charAt(0).toUpperCase() + countryKey.slice(1))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* League Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('who_concedes_league', 'League')}
            </label>
            <Select 
              value={selectedLeagueId.toString()} 
              onValueChange={(v) => {
                setSelectedLeagueId(parseInt(v));
                setResults([]);
                setLeagueInfo(null);
                setGeneratedAt(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('who_concedes_league', 'League')} />
              </SelectTrigger>
              <SelectContent>
                {availableLeagues.map((league) => (
                  <SelectItem key={league.id} value={league.id.toString()}>
                    {league.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Matches Span Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t('card_war_matches_span', 'Matches span')}
          </label>
          <Select 
            value={maxMatches.toString()} 
            onValueChange={(v) => {
              setMaxMatches(parseInt(v));
              setResults([]);
              setLeagueInfo(null);
              setGeneratedAt(null);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 {t('matches', 'matches')}</SelectItem>
              <SelectItem value="10">10 {t('matches', 'matches')}</SelectItem>
              <SelectItem value="15">15 {t('matches', 'matches')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button onClick={handleGenerate} disabled={loading} className="flex-1 gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('generating', 'Generating...')}
              </>
            ) : (
              t('card_war_generate', 'Show ranking')
            )}
          </Button>
          {results.length > 0 && (
            <Button
              onClick={handleRefresh}
              disabled={loading}
              variant="outline"
              size="icon"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Results Table */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">
                {leagueInfo?.name} • {t('who_concedes_teams_count', '{{count}} teams', { count: results.length })}
              </span>
              {generatedAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(generatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            
            <div className="rounded-md border max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>{t('card_war_table_team', 'Team')}</TableHead>
                    <TableHead className="text-right w-20">{t('card_war_table_avg', 'Avg')}</TableHead>
                    <TableHead className="text-right w-16">{t('card_war_table_total', 'Total')}</TableHead>
                    <TableHead className="text-right w-16">{t('card_war_table_used', 'Used')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((team) => (
                    <TableRow key={team.team_id}>
                      <TableCell>
                        <Badge variant={getRankBadgeVariant(team.rank)} className="w-8 justify-center">
                          {team.rank}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium truncate max-w-[140px]">
                        {team.team_name}
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {team.avg_value.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {team.total_value}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={team.matches_used < maxMatches ? "text-amber-500" : "text-muted-foreground"}>
                          {team.matches_used}/{maxMatches}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {mode === 'cards' 
                ? t('card_war_footer_cards', 'Teams at the top receive the most cards • Based on last {{count}} matches', { count: maxMatches })
                : t('card_war_footer_fouls', 'Teams at the top commit the most fouls • Based on last {{count}} matches', { count: maxMatches })
              }
            </p>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t('card_war_empty', 'Select a league and click "Show ranking" to see which teams get the most cards and fouls.')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
