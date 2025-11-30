import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { FixtureStatsDisplay } from "./FixtureStatsDisplay";

interface MatchAnalysis {
  match_title: string;
  recommended_bet: string;
  analysis: string;
  confidence_level: string;
  home_team?: string;
  away_team?: string;
  home_stats?: any;
  away_stats?: any;
  h2h_stats?: any;
  combined_snapshot?: Record<string, number>;
  home_injuries?: Array<{ player_name: string; position: string | null; status: string; injury_type: string | null }>;
  away_injuries?: Array<{ player_name: string; position: string | null; status: string; injury_type: string | null }>;
}

interface GeminiAnalysisProps {
  overallSummary: string;
  matches: MatchAnalysis[];
}

export function GeminiAnalysis({ overallSummary, matches }: GeminiAnalysisProps) {
  const { t } = useTranslation('common');
  
  const getConfidenceBadgeVariant = (level: string) => {
    const lowerLevel = level.toLowerCase();
    if (lowerLevel.includes('high') || lowerLevel.includes('მაღალი')) return 'default';
    if (lowerLevel.includes('low') || lowerLevel.includes('დაბალი')) return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-4 mt-6 border-t pt-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">{t('gemini_analysis')}</h3>
        <InfoTooltip tooltipKey="ai_analysis" />
      </div>

      {/* Overall Summary */}
      <div className="bg-muted/50 rounded-lg p-4">
        <div className="text-sm font-medium mb-2 text-muted-foreground">{t('overall_summary')}</div>
        <p className="text-sm">{overallSummary}</p>
      </div>

      {/* Match-by-Match Analysis */}
      <Accordion type="single" collapsible className="space-y-2">
        {matches.map((match, index) => (
          <AccordionItem 
            key={index} 
            value={`match-${index}`}
            className="border rounded-lg px-4"
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center justify-between w-full pr-4">
                <div className="text-left">
                  <div className="text-sm font-medium leading-snug">{match.match_title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {match.recommended_bet}
                  </div>
                </div>
                <Badge variant={getConfidenceBadgeVariant(match.confidence_level)} className="shrink-0">
                  {match.confidence_level}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              {/* Team Statistics Display */}
              {(match.home_stats || match.away_stats || match.h2h_stats || match.combined_snapshot) && (
                <FixtureStatsDisplay
                  homeTeam={match.home_team || "Home"}
                  awayTeam={match.away_team || "Away"}
                  homeStats={match.home_stats}
                  awayStats={match.away_stats}
                  h2hStats={match.h2h_stats}
                  combinedSnapshot={match.combined_snapshot || {}}
                  homeInjuries={match.home_injuries || []}
                  awayInjuries={match.away_injuries || []}
                />
              )}
              
              {/* AI Analysis */}
              <div className="pt-4 mt-4 border-t">
                <div className="text-xs font-medium text-muted-foreground mb-2">AI Analysis</div>
                <div className="text-sm text-muted-foreground">
                  {match.analysis}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
