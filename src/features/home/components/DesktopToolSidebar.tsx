import { Button } from "@/components/ui/button";
import { Sparkles, Filter, Trophy, Target, ShieldAlert, Swords, Users, ShieldCheck, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RightRail } from "@/components/RightRail";

interface DesktopToolSidebarProps {
  analysis: any;
  loadingAnalysis: boolean;
  valueAnalysis: any;
  onAddToTicket: (market: any) => void;
  onOpenTicketCreator: () => void;
  openToolExclusive: (tool: string) => void;
  toolStates: Record<string, boolean>;
}

export function DesktopToolSidebar({
  analysis, loadingAnalysis, valueAnalysis,
  onAddToTicket, onOpenTicketCreator,
  openToolExclusive, toolStates,
}: DesktopToolSidebarProps) {
  const { t } = useTranslation(['common']);

  const tools = [
    { key: 'dailyInsights', icon: Eye, label: 'Daily Signals', tutorial: 'daily-insights-btn' },
    { key: 'filterizer', icon: Filter, label: t('common:filterizer'), tutorial: 'filterizer-btn' },
    { key: 'winner', icon: Trophy, label: t('common:winner_1x2'), tutorial: 'winner-btn' },
    { key: 'teamTotals', icon: Target, label: t('common:team_totals'), tutorial: 'team-totals-btn' },
    { key: 'whoConcedes', icon: ShieldAlert, label: t('common:who_concedes'), tutorial: 'who-concedes-btn' },
    { key: 'cardWar', icon: Swords, label: t('common:card_war'), tutorial: 'card-war-btn' },
    { key: 'bttsIndex', icon: Users, label: t('common:btts_index'), tutorial: 'btts-index-btn' },
    { key: 'safeZone', icon: ShieldCheck, label: 'Safe Zone', tutorial: 'safe-zone-btn' },
  ];

  return (
    <div className="hidden lg:flex w-[360px] flex-col overflow-hidden border-l border-border">
      {/* AI Ticket Creator */}
      <div className="p-4 border-b bg-card/30 backdrop-blur-sm shrink-0">
        <Button
          className="w-full gap-2"
          variant="default"
          onClick={onOpenTicketCreator}
          data-tutorial="ticket-creator-btn"
        >
          <Sparkles className="h-4 w-4" />
          {t('common:ai_ticket_creator')}
        </Button>
      </div>

      {/* Tool Buttons */}
      <div className="p-4 border-b bg-card/30 backdrop-blur-sm shrink-0 space-y-2">
        {tools.map((tool) => (
          <Button
            key={tool.key}
            className="w-full gap-2"
            variant={toolStates[tool.key] ? "default" : "outline"}
            onClick={() => openToolExclusive(tool.key)}
            data-tutorial={tool.tutorial}
          >
            <tool.icon className="h-4 w-4" />
            {tool.label}
          </Button>
        ))}
      </div>

      {/* Analysis */}
      <div className="flex-1 overflow-y-auto">
        <RightRail
          analysis={analysis}
          loading={loadingAnalysis}
          suggested_markets={valueAnalysis?.edges?.slice(0, 4) || []}
          onAddToTicket={onAddToTicket}
        />
      </div>
    </div>
  );
}
