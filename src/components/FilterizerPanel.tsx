import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Filter, X, Globe, MapPin, Calendar, Target, Hash, SlidersHorizontal, Cpu, Sparkles, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMarketLabel } from "@/lib/i18nFormatters";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { cn } from "@/lib/utils";

interface FilterizerPanelProps {
  onApplyFilters: (filters: FilterCriteria) => void;
  onClearFilters: () => void;
  isActive: boolean;
}

export interface FilterCriteria {
  market: string;
  side: "over" | "under";
  line: number;
  minOdds: number;
  showAllOdds: boolean;
  includeModelOnly?: boolean;
  allLeagues?: boolean;
  dayRange?: "all" | "today" | "tomorrow";
}

const MARKET_OPTIONS = [
  { id: "goals", label: "Goals", icon: "⚽", lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5] },
  { id: "corners", label: "Corners", icon: "🚩", lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5] },
  { id: "cards", label: "Cards", icon: "🟨", lines: [1.5, 2.5, 3.5, 4.5, 5.5] },
];

const DAY_RANGES = [
  { id: "all" as const, label: "day_range_all", icon: "📅" },
  { id: "today" as const, label: "day_range_today", icon: "☀️" },
  { id: "tomorrow" as const, label: "day_range_tomorrow", icon: "🌙" },
];

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

export function FilterizerPanel({ onApplyFilters, onClearFilters, isActive }: FilterizerPanelProps) {
  const { t, i18n } = useTranslation(["filterizer"]);
  const [selectedMarket, setSelectedMarket] = useState<string>("goals");
  const [selectedLine, setSelectedLine] = useState<number>(2.5);
  const [minOdds, setMinOdds] = useState<number>(1.50);
  const [includeModelOnly, setIncludeModelOnly] = useState<boolean>(true);
  const [allLeaguesMode, setAllLeaguesMode] = useState<boolean>(false);
  const [dayRange, setDayRange] = useState<"all" | "today" | "tomorrow">("all");

  const currentMarketOption = MARKET_OPTIONS.find((m) => m.id === selectedMarket);

  const handleMarketSelect = (marketId: string) => {
    setSelectedMarket(marketId);
    const market = MARKET_OPTIONS.find((m) => m.id === marketId);
    if (market) setSelectedLine(market.lines[0]);
  };

  const handleApply = () => {
    onApplyFilters({
      market: selectedMarket,
      side: "over",
      line: selectedLine,
      minOdds,
      showAllOdds: false,
      includeModelOnly,
      allLeagues: allLeaguesMode,
      dayRange,
    });
  };

  const handleClear = () => {
    setSelectedMarket("goals");
    setSelectedLine(2.5);
    setMinOdds(1.50);
    setIncludeModelOnly(true);
    setAllLeaguesMode(false);
    setDayRange("all");
    onClearFilters();
  };

  return (
    <div className="mb-4 rounded-2xl overflow-hidden border border-border/60 bg-gradient-to-b from-card via-card to-background shadow-xl">
      {/* ── Header ── */}
      <div className="relative px-5 pt-5 pb-4">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-transparent" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 border border-primary/20">
              <Filter className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-foreground tracking-tight">{t("filterizer:title")}</h3>
                <InfoTooltip tooltipKey="filterizer" />
                <AnimatePresence>
                  {isActive && (
                    <motion.span
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="text-[10px] font-semibold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-full border border-primary/30"
                    >
                      {t("filterizer:active")}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Find value bets by stat filters</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-5 pb-5 space-y-1">
        {/* Section 1: Scope */}
        <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible" className="py-4">
          <SectionLabel icon={<Globe className="h-3.5 w-3.5" />} text={t("filterizer:scope_label")} />
          <div className="grid grid-cols-2 gap-2 mt-3">
            <ToggleChip
              active={!allLeaguesMode}
              onClick={() => setAllLeaguesMode(false)}
              icon={<MapPin className="h-3.5 w-3.5" />}
              label={t("filterizer:scope_selected_league")}
            />
            <ToggleChip
              active={allLeaguesMode}
              onClick={() => setAllLeaguesMode(true)}
              icon={<Globe className="h-3.5 w-3.5" />}
              label={t("filterizer:scope_all_leagues")}
            />
          </div>
          <AnimatePresence>
            {allLeaguesMode && (
              <motion.p
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="text-[11px] text-muted-foreground mt-2 overflow-hidden"
              >
                {t("filterizer:all_leagues_caption")}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        <div className="h-px bg-border/50" />

        {/* Section 2: Day Range */}
        <motion.div custom={1} variants={sectionVariants} initial="hidden" animate="visible" className="py-4">
          <SectionLabel icon={<Calendar className="h-3.5 w-3.5" />} text={t("filterizer:match_day_range")} />
          <div className="grid grid-cols-3 gap-2 mt-3">
            {DAY_RANGES.map((range) => (
              <ToggleChip
                key={range.id}
                active={dayRange === range.id}
                onClick={() => setDayRange(range.id)}
                icon={<span className="text-sm">{range.icon}</span>}
                label={t(`filterizer:${range.label}`)}
                compact
              />
            ))}
          </div>
        </motion.div>

        <div className="h-px bg-border/50" />

        {/* Section 3: Market */}
        <motion.div custom={2} variants={sectionVariants} initial="hidden" animate="visible" className="py-4">
          <SectionLabel icon={<Target className="h-3.5 w-3.5" />} text={t("filterizer:select_market")} />
          <div className="grid grid-cols-3 gap-2 mt-3">
            {MARKET_OPTIONS.map((market) => (
              <button
                key={market.id}
                onClick={() => handleMarketSelect(market.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-xs font-medium transition-all duration-200 active:scale-[0.96]",
                  selectedMarket === market.id
                    ? "bg-primary/15 border-primary/40 text-primary shadow-[0_0_12px_hsl(var(--primary)/0.15)]"
                    : "bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:border-border"
                )}
              >
                <span className="text-lg">{market.icon}</span>
                <span>{formatMarketLabel(market.label, i18n.language)}</span>
              </button>
            ))}
          </div>
        </motion.div>

        <div className="h-px bg-border/50" />

        {/* Section 4: Line */}
        {currentMarketOption && (
          <motion.div custom={3} variants={sectionVariants} initial="hidden" animate="visible" className="py-4">
            <SectionLabel icon={<Hash className="h-3.5 w-3.5" />} text={t("filterizer:select_line")} />
            <div className="flex flex-wrap gap-2 mt-3">
              {currentMarketOption.lines.map((line) => (
                <button
                  key={line}
                  onClick={() => setSelectedLine(line)}
                  className={cn(
                    "h-10 min-w-[48px] px-3.5 rounded-xl text-sm font-semibold tabular-nums border transition-all duration-200 active:scale-[0.94]",
                    selectedLine === line
                      ? "bg-primary text-primary-foreground border-primary shadow-[0_0_16px_hsl(var(--primary)/0.3)]"
                      : "bg-muted/30 text-foreground border-border/50 hover:bg-muted/50"
                  )}
                >
                  {line}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <div className="h-px bg-border/50" />

        {/* Section 5: Min Odds */}
        <motion.div custom={4} variants={sectionVariants} initial="hidden" animate="visible" className="py-4">
          <div className="flex items-center justify-between">
            <SectionLabel icon={<SlidersHorizontal className="h-3.5 w-3.5" />} text={t("filterizer:min_odds")} />
            <span className="text-base font-bold text-primary tabular-nums bg-primary/10 px-3 py-1 rounded-lg border border-primary/20">
              {minOdds.toFixed(2)}
            </span>
          </div>
          <div className="mt-4 px-1">
            <Slider
              value={[minOdds]}
              onValueChange={(value) => setMinOdds(value[0])}
              min={1.10}
              max={3.00}
              step={0.05}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-2 tabular-nums">
              <span>1.10</span>
              <span>2.00</span>
              <span>3.00</span>
            </div>
          </div>
        </motion.div>

        <div className="h-px bg-border/50" />

        {/* Section 6: Model-only toggle */}
        <motion.div custom={5} variants={sectionVariants} initial="hidden" animate="visible" className="py-4">
          <button
            onClick={() => setIncludeModelOnly(!includeModelOnly)}
            className={cn(
              "w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 active:scale-[0.98]",
              includeModelOnly
                ? "bg-primary/10 border-primary/30"
                : "bg-muted/20 border-border/50"
            )}
          >
            <div className={cn(
              "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
              includeModelOnly ? "bg-primary/20" : "bg-muted/40"
            )}>
              <Cpu className={cn("h-4 w-4", includeModelOnly ? "text-primary" : "text-muted-foreground")} />
            </div>
            <div className="flex-1 text-left">
              <p className={cn("text-sm font-medium", includeModelOnly ? "text-foreground" : "text-muted-foreground")}>
                Include model-only picks
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Show picks without bookmaker odds
              </p>
            </div>
            <div className={cn(
              "w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0",
              includeModelOnly ? "bg-primary" : "bg-muted"
            )}>
              <div className={cn(
                "absolute top-1 w-4 h-4 rounded-full bg-background shadow-sm transition-transform duration-200",
                includeModelOnly ? "translate-x-6" : "translate-x-1"
              )} />
            </div>
          </button>
        </motion.div>

        {/* ── Actions ── */}
        <motion.div custom={6} variants={sectionVariants} initial="hidden" animate="visible" className="pt-2 pb-1 grid grid-cols-[1fr_auto] gap-3">
          <Button
            onClick={handleApply}
            className="h-12 rounded-xl text-sm font-semibold gap-2 shadow-[0_4px_20px_hsl(var(--primary)/0.25)] active:scale-[0.97] transition-transform"
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="truncate">{t("filterizer:apply_filters")}</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleClear}
            className="h-12 rounded-xl text-sm font-medium gap-2 px-4 active:scale-[0.97] transition-transform whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            {t("filterizer:clear")}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

/* ── Reusable sub-components ── */

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{text}</Label>
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  icon,
  label,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-xl border text-xs font-medium transition-all duration-200 active:scale-[0.96]",
        compact ? "py-2.5 px-2" : "py-3 px-3",
        active
          ? "bg-primary/15 border-primary/40 text-primary"
          : "bg-muted/20 border-border/50 text-muted-foreground hover:bg-muted/40"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
