import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Sparkles, Filter, Trophy, Target, ShieldAlert, Swords, Users, ShieldCheck, ChevronRight, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRegisterOverlay } from "@/hooks/useRegisterOverlay";
import { RightRail } from "@/components/RightRail";
import { PremiumUpgradeHero } from "@/components/PremiumUpgradeHero";
import { motion } from "framer-motion";

interface ToolDef {
  key: string;
  icon: any;
  labelKey: string;
  fallback: string;
  description: string;
  category: 'predictions' | 'rankings';
}

const TOOLS: ToolDef[] = [
  { key: 'filterizer', icon: Filter, labelKey: 'common:filterizer', fallback: 'Filterizer', description: 'Find value bets by stat filters', category: 'predictions' },
  { key: 'winner', icon: Trophy, labelKey: 'common:winner_1x2', fallback: 'Winner (1X2)', description: 'Match outcome predictions', category: 'predictions' },
  { key: 'teamTotals', icon: Target, labelKey: 'common:team_totals', fallback: 'Team Totals O1.5', description: 'Individual team scoring lines', category: 'predictions' },
  { key: 'whoConcedes', icon: ShieldAlert, labelKey: 'common:who_concedes', fallback: 'Who Concedes', description: 'Defensive weakness rankings', category: 'predictions' },
  { key: 'bttsIndex', icon: Users, labelKey: 'common:btts_index', fallback: 'BTTS Index', description: 'Both teams to score probability', category: 'rankings' },
  { key: 'cardWar', icon: Swords, labelKey: 'common:card_war', fallback: 'Card War', description: 'Yellow & red card rankings', category: 'rankings' },
  { key: 'safeZone', icon: ShieldCheck, labelKey: 'common:safe_zone', fallback: 'Safe Zone', description: 'High-confidence low-risk picks', category: 'rankings' },
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

  const predictions = TOOLS.filter(tool => tool.category === 'predictions');
  const rankings = TOOLS.filter(tool => tool.category === 'rankings');

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
      <SheetContent side="right" className="p-0 flex flex-col w-full sm:w-[400px]">
        <div className="flex flex-col h-full overflow-hidden">
          {/* Premium Header */}
          <div className="px-5 pt-5 pb-4 shrink-0 bg-gradient-to-b from-primary/8 to-transparent">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <h2 className="text-lg font-bold text-foreground">{t('common:analytics_tools')}</h2>
            </div>
            <p className="text-xs text-muted-foreground pl-[42px]">AI-powered prediction tools</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* AI Ticket Creator — Hero CTA */}
            <div className="px-5 pb-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
              >
                <Button
                  className="w-full gap-2.5 h-14 rounded-2xl font-bold text-base shadow-lg shadow-primary/25 relative overflow-hidden"
                  variant="default"
                  onClick={() => {
                    onOpenTicketCreator();
                    onOpenChange(false);
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary-foreground/5 to-primary/0 animate-pulse" />
                  <Sparkles className="h-5 w-5 relative z-10" />
                  <span className="relative z-10">{t('common:ai_ticket_creator')}</span>
                </Button>
              </motion.div>
            </div>

            {/* Predictions Section */}
            <div className="px-5 pb-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2.5 px-0.5">
                {t('common:predictions', 'Predictions')}
              </p>
              <div className="space-y-1.5">
                {predictions.map((tool, idx) => {
                  const isActive = toolStates[tool.key];
                  const Icon = tool.icon;
                  return (
                    <motion.div
                      key={tool.key}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.04 }}
                    >
                      <Card
                        className={`p-0 overflow-hidden border transition-all touch-manipulation active:scale-[0.98] cursor-pointer ${
                          isActive 
                            ? "border-primary/40 bg-primary/8 shadow-sm shadow-primary/10" 
                            : "border-border/50 hover:border-border"
                        }`}
                        onClick={() => {
                          openToolExclusive(tool.key);
                          onOpenChange(false);
                        }}
                      >
                        <div className="flex items-center gap-3 px-3.5 py-3">
                          <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                            isActive ? "bg-primary/20" : "bg-secondary/70"
                          }`}>
                            <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold leading-tight ${isActive ? "text-primary" : "text-foreground"}`}>
                              {t(tool.labelKey, tool.fallback)}
                            </p>
                            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
                              {tool.description}
                            </p>
                          </div>
                          <ChevronRight className={`h-4 w-4 shrink-0 ${isActive ? "text-primary/60" : "text-muted-foreground/30"}`} />
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Rankings Section */}
            <div className="px-5 pb-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2.5 px-0.5">
                {t('common:rankings', 'Rankings')}
              </p>
              <div className="space-y-1.5">
                {rankings.map((tool, idx) => {
                  const isActive = toolStates[tool.key];
                  const Icon = tool.icon;
                  return (
                    <motion.div
                      key={tool.key}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: (predictions.length + idx) * 0.04 }}
                    >
                      <Card
                        className={`p-0 overflow-hidden border transition-all touch-manipulation active:scale-[0.98] cursor-pointer ${
                          isActive 
                            ? "border-primary/40 bg-primary/8 shadow-sm shadow-primary/10" 
                            : "border-border/50 hover:border-border"
                        }`}
                        onClick={() => {
                          openToolExclusive(tool.key);
                          onOpenChange(false);
                        }}
                      >
                        <div className="flex items-center gap-3 px-3.5 py-3">
                          <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                            isActive ? "bg-primary/20" : "bg-secondary/70"
                          }`}>
                            <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold leading-tight ${isActive ? "text-primary" : "text-foreground"}`}>
                              {t(tool.labelKey, tool.fallback)}
                            </p>
                            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
                              {tool.description}
                            </p>
                          </div>
                          <ChevronRight className={`h-4 w-4 shrink-0 ${isActive ? "text-primary/60" : "text-muted-foreground/30"}`} />
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="mx-5 border-t border-border/30 mb-2" />

            {/* Analysis Results */}
            <div className="pb-6">
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
