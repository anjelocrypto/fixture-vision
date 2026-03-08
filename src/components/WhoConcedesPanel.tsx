import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ShieldAlert, Target, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface WhoConcedesPanelProps {
  onClose: () => void;
}

type Mode = 'concedes' | 'scores';

interface TeamRanking {
  rank: number;
  team_id: number;
  team_name: string;
  avg_value: number;
  total_value: number;
  matches_used: number;
  avg_conceded?: number;
  total_conceded?: number;
  avg_scored?: number;
  total_scored?: number;
}

interface LeagueInfo {
  id: number;
  name: string;
  country: string;
}

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

export function WhoConcedesPanel({ onClose }: WhoConcedesPanelProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [mode, setMode] = useState<Mode>('concedes');
  const [selectedCountry, setSelectedCountry] = useState<string>("england");
  const [selectedLeagueId, setSelectedLeagueId] = useState<number>(39);
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
    if (leagues && leagues.length > 0) setSelectedLeagueId(leagues[0].id);
    setResults([]);
    setLeagueInfo(null);
    setGeneratedAt(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("who-concedes", {
        body: { league_id: selectedLeagueId, max_matches: 10, mode },
      });
      if (error) throw error;
      if (!data || !data.rankings) throw new Error("Invalid response from server");
      setResults(data.rankings);
      setLeagueInfo(data.league);
      setGeneratedAt(data.generated_at);
      if (data.rankings.length === 0) {
        toast({ title: t('no_data_available', 'No data available'), description: t('who_concedes_no_data_desc', 'No historical data found for this league') });
      } else {
        toast({ title: t('ranking_generated', 'Ranking generated'), description: t('who_concedes_ranking_desc', '{{count}} teams ranked', { count: data.rankings.length }) });
      }
    } catch (error: any) {
      console.error("Error fetching Who Concedes/Scores data:", error);
      toast({ title: t('error', 'Error'), description: error.message || "Failed to generate ranking", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const getRankBadgeVariant = (rank: number): "destructive" | "secondary" | "outline" => {
    if (rank <= 3) return "destructive";
    if (rank <= 6) return "secondary";
    return "outline";
  };

  const getRankEmoji = (rank: number) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return null;
  };

  return (
    <div className="w-full rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-destructive/15 flex items-center justify-center">
            {mode === 'concedes' ? (
              <ShieldAlert className="h-4 w-4 text-destructive" />
            ) : (
              <Target className="h-4 w-4 text-primary" />
            )}
          </div>
          <div>
            <h2 className="font-semibold text-sm">{t('who_concedes_title', 'Who Concedes / Scores?')}</h2>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {t('who_concedes_subtitle', 'Teams ranked by avg goals (last 10)')}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 active:scale-90 transition-all">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Mode Toggle */}
        <div className="grid grid-cols-2 gap-1.5">
          {(['concedes', 'scores'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={`h-9 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.96] ${
                mode === m
                  ? m === 'concedes'
                    ? "bg-destructive/15 text-destructive border border-destructive/30"
                    : "bg-primary/15 text-primary border border-primary/30"
                  : "bg-muted/40 border border-border/50 text-muted-foreground"
              }`}
            >
              {m === 'concedes' ? <ShieldAlert className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
              {m === 'concedes' ? t('who_concedes_mode_concedes', 'Concedes') : t('who_concedes_mode_scores', 'Scores')}
            </button>
          ))}
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('who_concedes_country', 'Country')}</span>
            <Select value={selectedCountry} onValueChange={handleCountryChange}>
              <SelectTrigger className="h-9 text-xs rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COUNTRY_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>{t(`country_${k}`, k.charAt(0).toUpperCase() + k.slice(1))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('who_concedes_league', 'League')}</span>
            <Select value={selectedLeagueId.toString()} onValueChange={(v) => { setSelectedLeagueId(parseInt(v)); setResults([]); setLeagueInfo(null); setGeneratedAt(null); }}>
              <SelectTrigger className="h-9 text-xs rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableLeagues.map((l) => (
                  <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Generate */}
        <div className="flex gap-2">
          <Button onClick={handleGenerate} disabled={loading} size="sm" className="flex-1 h-10 rounded-xl text-xs font-semibold active:scale-[0.97] transition-transform">
            {loading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t('generating', 'Generating...')}</> : t('show_ranking', 'Show Ranking')}
          </Button>
          {results.length > 0 && (
            <Button onClick={handleGenerate} disabled={loading} variant="outline" size="icon" className="h-10 w-10 rounded-xl active:scale-[0.95]">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                {leagueInfo?.name} · {results.length} teams
              </span>
              {generatedAt && (
                <span className="text-[10px] text-muted-foreground">{new Date(generatedAt).toLocaleTimeString()}</span>
              )}
            </div>

            {isMobile ? (
              <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
                {results.map((team) => {
                  const emoji = getRankEmoji(team.rank);
                  return (
                    <div
                      key={team.team_id}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-colors ${
                        team.rank <= 3 ? "bg-destructive/5 border-destructive/20" : "bg-muted/20 border-border/40"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                        {emoji ? <span className="text-sm">{emoji}</span> : (
                          <span className="text-xs font-bold text-muted-foreground">{team.rank}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs truncate">{team.team_name}</p>
                        <div className="flex gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          <span>Total: <span className="tabular-nums font-medium text-foreground">{team.total_value}</span></span>
                          <span className={team.matches_used < 10 ? "text-amber-500" : ""}>{team.matches_used}/10</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold tabular-nums text-sm">{team.avg_value.toFixed(2)}</p>
                        <p className="text-[9px] text-muted-foreground">avg/match</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-border/40 max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{t('who_concedes_team', 'Team')}</TableHead>
                      <TableHead className="text-right w-20">{t('who_concedes_avg', 'Avg')}</TableHead>
                      <TableHead className="text-right w-16">{t('who_concedes_total', 'Total')}</TableHead>
                      <TableHead className="text-right w-16">{t('who_concedes_used', 'Used')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((team) => (
                      <TableRow key={team.team_id}>
                        <TableCell><Badge variant={getRankBadgeVariant(team.rank)} className="w-8 justify-center">{team.rank}</Badge></TableCell>
                        <TableCell className="font-medium truncate max-w-[140px]">{team.team_name}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums">{team.avg_value.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{team.total_value}</TableCell>
                        <TableCell className="text-right"><span className={team.matches_used < 10 ? "text-amber-500" : "text-muted-foreground"}>{team.matches_used}/10</span></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground text-center">
              {mode === 'concedes'
                ? t('who_concedes_footer_concedes', 'Teams at the top concede the most goals · Last 10 matches')
                : t('who_concedes_footer_scores', 'Teams at the top score the most goals · Last 10 matches')}
            </p>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto">
              <ShieldAlert className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground px-4">
              {t('who_concedes_empty', 'Select a league and click "Show Ranking" to see which teams concede or score the most goals.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
