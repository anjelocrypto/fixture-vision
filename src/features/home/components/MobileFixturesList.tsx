import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { formatDateWithLocale } from "@/lib/i18nFormatters";
import { useTranslation } from "react-i18next";
import { MobileFixtureCard } from "./MobileFixtureCard";

interface MobileFixturesListProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  league: any | null;
  fixtures: any[];
  loading: boolean;
  onAnalyze: (fixture: any) => void;
}

export function MobileFixturesList({
  selectedDate,
  onSelectDate,
  league,
  fixtures,
  loading,
  onAnalyze,
}: MobileFixturesListProps) {
  const { t, i18n } = useTranslation(['fixtures']);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = Array.from({ length: 2 }, (_, i) => addDays(today, i));

  return (
    <div className="space-y-3">
      {/* Date Strip */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide touch-pan-x -mx-1 px-1">
        {dates.map((date) => (
          <Button
            key={date.toISOString()}
            onClick={() => onSelectDate(date)}
            variant={
              format(date, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd")
                ? "default"
                : "outline"
            }
            className="rounded-full shrink-0 min-w-[80px] h-10"
          >
            <span className="text-xs">{formatDateWithLocale(date, "MMM d", i18n.language)}</span>
          </Button>
        ))}
      </div>

      {/* League Header */}
      {league && (
        <div className="flex items-center gap-2.5">
          <img src={league.logo} alt={league.name} className="w-5 h-5" />
          <h3 className="text-sm font-semibold text-foreground/90">{league.name.replace(/^league_names\./, '')}</h3>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : !league ? (
        <Card className="p-6 text-center border-dashed border-border/50">
          <p className="text-base font-medium mb-1.5">{t('fixtures:select_league', 'Select a league')}</p>
          <p className="text-sm text-muted-foreground">
            {t('fixtures:select_league_hint', 'Use the menu to browse countries and leagues')}
          </p>
        </Card>
      ) : fixtures.length === 0 ? (
        <Card className="p-6 text-center border-dashed border-border/50">
          <p className="text-base font-medium mb-1.5">
            {t('fixtures:no_matches_date', { date: formatDateWithLocale(selectedDate, "MMM d", i18n.language) })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('fixtures:try_different_date', 'Try selecting a different date or league')}
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {fixtures.map((fixture: any, index: number) => (
            <MobileFixtureCard
              key={fixture.id}
              fixture={fixture}
              onAnalyze={onAnalyze}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
}
