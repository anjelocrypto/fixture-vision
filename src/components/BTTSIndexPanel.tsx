import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Users, X, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

interface BTTSIndexPanelProps {
  onClose: () => void;
}

type Window = 5 | 10 | 15;

interface TeamBTTS {
  rank: number;
  team_id: number;
  team_name: string;
  btts_rate: number;
  btts_count: number;
  matches: number;
  sample_warning: string | null;
}

interface LeagueInfo {
  name: string;
  country: string;
}

const LEAGUES_BY_COUNTRY: Record<string, { id: number; name: string }[]> = {
  england: [{ id: 39, name: "Premier League" }, { id: 40, name: "Championship" }],
  spain: [{ id: 140, name: "La Liga" }, { id: 141, name: "La Liga 2" }],
  germany: [{ id: 78, name: "Bundesliga" }, { id: 79, name: "2. Bundesliga" }],
  italy: [{ id: 135, name: "Serie A" }, { id: 136, name: "Serie B" }],
  france: [{ id: 61, name: "Ligue 1" }, { id: 62, name: "Ligue 2" }],
};

const COUNTRY_KEYS = Object.keys(LEAGUES_BY_COUNTRY);

export function BTTSIndexPanel({ onClose }: BTTSIndexPanelProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [window, setWindow] = useState<Window>(10);
  const [selectedCountry, setSelectedCountry] = useState<string>("england");
  const [selectedLeagueId, setSelectedLeagueId] = useState<number>(39);
  const [results, setResults] = useState<TeamBTTS[]>([]);
  const [leagueInfo, setLeagueInfo] = useState<LeagueInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const availableLeagues = LEAGUES_BY_COUNTRY[selectedCountry] || [];

  const handleCountryChange = (country: string) => {
    setSelectedCountry(country);
    const leagues = LEAGUES_BY_COUNTRY[country];
    if (leagues && leagues.length > 0) setSelectedLeagueId(leagues[0].id);
    setResults([]); setLeagueInfo(null); setGeneratedAt(null);
  };

  const handleWindowChange = (w: number) => {
    setWindow(w as Window);
    setResults([]); setLeagueInfo(null); setGeneratedAt(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("btts-index", {
        body: { mode: "league_rankings", league_id: selectedLeagueId, window },
      });
      if (error) throw error;
      if (!data || !data.teams) throw new Error("Invalid response from server");
      setResults(data.teams);
      setLeagueInfo(data.league);
      setGeneratedAt(data.generated_at);
      if (data.teams.length === 0) {
        toast({ title: t('no_data_available', 'No data available'), description: t('btts_no_data_desc', 'No historical data found for this league') });
      } else {
        toast({ title: t('ranking_generated', 'Ranking generated'), description: t('btts_ranking_desc', '{{count}} teams ranked by BTTS rate', { count: data.teams.length }) });
      }
    } catch (error: any) {
      console.error("Error fetching BTTS data:", error);
      toast({ title: t('error', 'Error'), description: error.message || "Failed to generate ranking", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const getBTTSColor = (rate: number) => {
    if (rate >= 70) return "text-red-400";
    if (rate >= 50) return "text-primary";
    if (rate >= 30) return "text-muted-foreground";
    return "text-muted-foreground/60";
  };

  const getBTTSBadgeVariant = (rate: number): "destructive" | "default" | "secondary" | "outline" => {
    if (rate >= 70) return "destructive";
    if (rate >= 50) return "default";
    if (rate >= 30) return "secondary";
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
          <div className="h-8 w-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">{t('btts_title', 'BTTS Index')}</h2>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {t('btts_subtitle', 'Both Teams To Score percentage')}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 active:scale-90 transition-all">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Window Toggle */}
        <div className="grid grid-cols-3 gap-1.5">
          {[5, 10, 15].map((w) => (
            <button
              key={w}
              onClick={() => handleWindowChange(w)}
              className={`h-9 rounded-xl text-xs font-medium transition-all active:scale-[0.96] ${
                window === w
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                  : "bg-muted/40 border border-border/50 text-muted-foreground"
              }`}
            >
              {t('btts_last_n', 'Last {{n}}', { n: w })}
            </button>
          ))}
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('btts_country', 'Country')}</span>
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
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('btts_league', 'League')}</span>
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
              {generatedAt && <span className="text-[10px] text-muted-foreground">{new Date(generatedAt).toLocaleTimeString()}</span>}
            </div>

            {isMobile ? (
              <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
                {results.map((team) => {
                  const emoji = getRankEmoji(team.rank);
                  return (
                    <div
                      key={team.team_id}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-colors ${
                        team.btts_rate >= 70 ? "bg-destructive/5 border-destructive/20" : team.btts_rate >= 50 ? "bg-primary/5 border-primary/20" : "bg-muted/20 border-border/40"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                        {emoji ? <span className="text-sm">{emoji}</span> : <span className="text-xs font-bold text-muted-foreground">{team.rank}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs truncate flex items-center gap-1">
                          {team.team_name}
                          {team.sample_warning && <AlertTriangle className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />}
                        </p>
                        <div className="flex gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          <span>BTTS: <span className="tabular-nums font-medium text-foreground">{team.btts_count}/{team.matches}</span></span>
                          <span className={team.matches < window ? "text-amber-500" : ""}>{team.matches}/{window}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-bold tabular-nums text-sm ${getBTTSColor(team.btts_rate)}`}>{team.btts_rate.toFixed(0)}%</p>
                        <div className="w-12 h-1.5 rounded-full bg-muted/60 mt-1 overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(team.btts_rate, 100)}%` }} />
                        </div>
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
                      <TableHead>{t('btts_team', 'Team')}</TableHead>
                      <TableHead className="text-right w-20">{t('btts_rate', 'BTTS %')}</TableHead>
                      <TableHead className="text-right w-16">{t('btts_count', 'BTTS')}</TableHead>
                      <TableHead className="text-right w-16">{t('btts_matches', 'Games')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((team) => (
                      <TableRow key={team.team_id}>
                        <TableCell><Badge variant={getBTTSBadgeVariant(team.btts_rate)} className="w-8 justify-center">{team.rank}</Badge></TableCell>
                        <TableCell className="font-medium truncate max-w-[140px]">
                          <div className="flex items-center gap-1">
                            {team.team_name}
                            {team.sample_warning && (
                              <TooltipProvider><Tooltip><TooltipTrigger><AlertTriangle className="h-3 w-3 text-amber-500" /></TooltipTrigger><TooltipContent>{t('btts_low_sample', 'Low sample size')}</TooltipContent></Tooltip></TooltipProvider>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">{team.btts_rate.toFixed(1)}%</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{team.btts_count}/{team.matches}</TableCell>
                        <TableCell className="text-right"><span className={team.matches < window ? "text-amber-500" : "text-muted-foreground"}>{team.matches}/{window}</span></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground text-center">
              {t('btts_footer', 'Teams at the top have the highest BTTS rate in their last {{n}} matches', { n: window })}
            </p>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto">
              <Users className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground px-4">
              {t('btts_empty', 'Select a league and click "Show Ranking" to see BTTS rates.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
