import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

interface MatchAnalysis {
  match_title: string;
  recommended_bet: string;
  analysis: string;
  confidence_level: string;
}

interface GeminiAnalysisProps {
  overallSummary: string;
  matches: MatchAnalysis[];
}

export function GeminiAnalysis({ overallSummary, matches }: GeminiAnalysisProps) {
  const getConfidenceBadgeVariant = (level: string) => {
    const lowerLevel = level.toLowerCase();
    if (lowerLevel.includes('high')) return 'default';
    if (lowerLevel.includes('low')) return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-4 mt-6 border-t pt-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Gemini Analysis</h3>
      </div>

      {/* Overall Summary */}
      <div className="bg-muted/50 rounded-lg p-4">
        <div className="text-sm font-medium mb-2 text-muted-foreground">Overall Summary</div>
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
              <div className="pt-2 pb-2 text-sm text-muted-foreground">
                {match.analysis}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
