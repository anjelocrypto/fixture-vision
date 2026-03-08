import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { formatDateWithLocale } from "@/lib/i18nFormatters";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

interface MobileFixtureCardProps {
  fixture: any;
  onAnalyze: (fixture: any) => void;
  index: number;
}

export function MobileFixtureCard({ fixture, onAnalyze, index }: MobileFixtureCardProps) {
  const { t, i18n } = useTranslation(['fixtures']);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
    >
      <Card
        className="p-0 overflow-hidden border-border/50 hover:border-primary/30 transition-all active:scale-[0.99] touch-manipulation"
        onClick={() => onAnalyze(fixture)}
      >
        <div className="p-3.5">
          {/* Kickoff time badge */}
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              {format(new Date(fixture.timestamp * 1000), "HH:mm")} •{" "}
              {formatDateWithLocale(new Date(fixture.timestamp * 1000), "MMM d", i18n.language)}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          </div>

          {/* Teams */}
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <img
                src={fixture.teams_home.logo}
                alt={fixture.teams_home.name}
                className="w-6 h-6 rounded-sm"
              />
              <span className="font-medium text-sm leading-tight">{fixture.teams_home.name}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <img
                src={fixture.teams_away.logo}
                alt={fixture.teams_away.name}
                className="w-6 h-6 rounded-sm"
              />
              <span className="font-medium text-sm leading-tight">{fixture.teams_away.name}</span>
            </div>
          </div>

          {/* Stat preview */}
          {fixture.stat_preview && (
            <div className="mt-2.5 pt-2.5 border-t border-border/30 flex gap-3 text-[11px] text-muted-foreground">
              <span className="tabular-nums">⚽ {fixture.stat_preview.combined.goals.toFixed(1)}</span>
              <span className="tabular-nums">🟨 {fixture.stat_preview.combined.cards.toFixed(1)}</span>
              <span className="tabular-nums">🏁 {fixture.stat_preview.combined.corners.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Analyze CTA bar */}
        <div className="border-t border-border/30 bg-primary/5 px-3.5 py-2 flex items-center justify-center">
          <span className="text-xs font-semibold text-primary">{t('fixtures:analyze')}</span>
        </div>
      </Card>
    </motion.div>
  );
}
