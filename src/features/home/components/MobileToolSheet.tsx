import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Sparkles, Filter, Trophy, Target, ShieldAlert, Swords, Users, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRegisterOverlay } from "@/hooks/useRegisterOverlay";
import { RightRail } from "@/components/RightRail";
import { PremiumUpgradeHero } from "@/components/PremiumUpgradeHero";

interface ToolDef {
  key: string;
  icon: any;
  labelKey: string;
  fallback: string;
  category: 'predictions' | 'rankings';
}

const TOOLS: ToolDef[] = [
  { key: 'filterizer', icon: Filter, labelKey: 'common:filterizer', fallback: 'Filterizer', category: 'predictions' },
  { key: 'winner', icon: Trophy, labelKey: 'common:winner_1x2', fallback: 'Winner 1X2', category: 'predictions' },
  { key: 'teamTotals', icon: Target, labelKey: 'common:team_totals', fallback: 'Team Totals', category: 'predictions' },
  { key: 'whoConcedes', icon: ShieldAlert, labelKey: 'common:who_concedes', fallback: 'Who Concedes', category: 'predictions' },
  { key: 'bttsIndex', icon: Users, labelKey: 'common:btts_index', fallback: 'BTTS Index', category: 'rankings' },
  { key: 'cardWar', icon: Swords, labelKey: 'common:card_war', fallback: 'Card War', category: 'rankings' },
  { key: 'safeZone', icon: ShieldCheck, labelKey: 'common:safe_zone', fallback: 'Safe Zone', category: 'rankings' },
];

interface MobileToolSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPaidAccess: boolean;
  analysis: any;
  loadingAnalysis: boolean;
  valueAnalysis: any;
  onAddToTicket: (market: any) => void;
  onOpenTicketCreator: () => void;
  openToolExclusive: (tool: string) => void;
  toolStates: Record<string, boolean>;
}

export function MobileToolSheet({
  open, onOpenChange, hasPaidAccess,
  analysis, loadingAnalysis, valueAnalysis,
  onAddToTicket, onOpenTicketCreator,
  openToolExclusive, toolStates,
}: MobileToolSheetProps) {
  const { t } = useTranslation(['common']);
  useRegisterOverlay("home-right-sheet", open, () => onOpenChange(false));

  const predictions = TOOLS.filter(t => t.category === 'predictions');
  const rankings = TOOLS.filter(t => t.category === 'rankings');

  if (!hasPaidAccess) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="p-0 flex flex-col">
          <div className="flex-1 flex items-center justify-center p-6">
            <PremiumUpgradeHero />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 flex flex-col">
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="px-4 pt-3 pb-2.5 border-b bg-card/50 backdrop-blur-sm shrink-0">
            <h2 className="text-base font-semibold text-primary">{t('common:analytics_tools')}</h2>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* AI Ticket Creator */}
            <div className="px-4 py-3 border-b bg-card/30">
              <Button
                className="w-full gap-2 h-11 rounded-xl font-semibold"
                variant="default"
                onClick={() => {
                  onOpenTicketCreator();
                  onOpenChange(false);
                }}
              >
                <Sparkles className="h-4 w-4" />
                {t('common:ai_ticket_creator')}
              </Button>
            </div>

            {/* Tool Grid */}
            <div className="px-4 py-3 border-b bg-card/30 space-y-3">
              {/* Predictions */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1">
                  {t('common:predictions', 'Predictions')}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {predictions.map((tool) => (
                    <Button
                      key={tool.key}
                      className="gap-1.5 h-10 text-xs justify-start rounded-lg"
                      variant={toolStates[tool.key] ? "default" : "outline"}
                      onClick={() => {
                        openToolExclusive(tool.key);
                        onOpenChange(false);
                      }}
                    >
                      <tool.icon className="h-3.5 w-3.5" />
                      {t(tool.labelKey, tool.fallback)}
                    </Button>
                  ))}
                </div>
              </div>
              {/* Rankings */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1">
                  {t('common:rankings', 'Rankings')}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {rankings.map((tool) => (
                    <Button
                      key={tool.key}
                      className="gap-1.5 h-10 text-xs justify-start rounded-lg"
                      variant={toolStates[tool.key] ? "default" : "outline"}
                      onClick={() => {
                        openToolExclusive(tool.key);
                        onOpenChange(false);
                      }}
                    >
                      <tool.icon className="h-3.5 w-3.5" />
                      {t(tool.labelKey, tool.fallback)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Analysis Results */}
            <div className="pb-4">
              <RightRail
                analysis={analysis}
                loading={loadingAnalysis}
                suggested_markets={valueAnalysis?.edges?.slice(0, 4) || []}
                onAddToTicket={(market) => {
                  onAddToTicket(market);
                  onOpenChange(false);
                }}
              />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
