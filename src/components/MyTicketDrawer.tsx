import { useTicket } from "@/stores/useTicket";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, RefreshCw, Copy, Ticket } from "lucide-react";
import { format } from "date-fns";
import { formatDateWithLocale } from "@/lib/i18nFormatters";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";

interface MyTicketDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MyTicketDrawer({ open, onOpenChange }: MyTicketDrawerProps) {
  const { legs, stake, setStake, removeLeg, clear, refreshOdds } = useTicket();
  const { toast } = useToast();
  const { t, i18n } = useTranslation('common');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });
  }, []);

  const totalOdds = legs.reduce((acc, leg) => acc * leg.odds, 1);
  const potentialReturn = stake * totalOdds;

  const handleRefreshOdds = async () => {
    setIsRefreshing(true);
    try {
      await refreshOdds();
      toast({
        title: t('odds_refreshed'),
        description: t('odds_updated_description'),
      });
    } catch (error) {
      toast({
        title: t('refresh_failed'),
        description: t('refresh_failed_description'),
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopy = () => {
    const ticketText = legs.map((leg, i) => 
      `${i + 1}. ${leg.homeTeam} vs ${leg.awayTeam}\n   ${leg.market.toUpperCase()} ${leg.side} ${leg.line} @ ${leg.odds.toFixed(2)} (${leg.bookmaker})\n   Kickoff: ${formatDateWithLocale(new Date(leg.kickoffUtc), "MMM d, HH:mm", i18n.language)}`
    ).join('\n\n');

    const summary = `\n\nTotal Odds: ${totalOdds.toFixed(2)}\nStake: ${stake}\nPotential Return: ${potentialReturn.toFixed(2)}`;

    navigator.clipboard.writeText(ticketText + summary);
    toast({
      title: t('copied_to_clipboard'),
      description: t('ticket_copied_description'),
    });
  };

  const handleClear = () => {
    clear();
    toast({
      title: t('ticket_cleared'),
      description: t('ticket_cleared_description'),
    });
  };

  // Auto-refresh on open
  useEffect(() => {
    if (open && legs.length > 0) {
      handleRefreshOdds();
    }
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            {t('my_ticket_title')}
            {legs.length > 0 && (
              <Badge variant="secondary">{t(legs.length === 1 ? 'legs' : 'legs_plural', { count: legs.length })}</Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {t('build_ticket_description')}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {legs.length === 0 ? (
            <div className="text-center py-12">
              <Ticket className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-lg font-medium mb-2">{t('ticket_empty')}</p>
              <p className="text-sm text-muted-foreground">
                {t('add_selections_prompt')}
              </p>
            </div>
          ) : (
            <>
              {/* Actions Bar */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshOdds}
                  disabled={isRefreshing}
                  className="flex-1"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                  {t('refresh_odds')}
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopy} className="flex-1">
                  <Copy className="h-4 w-4 mr-2" />
                  {t('copy')}
                </Button>
                <Button variant="outline" size="sm" onClick={handleClear}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Legs List */}
              <div className="space-y-3">
                {legs.map((leg) => (
                  <Card key={leg.id} className="p-4">
                    <div className="space-y-2">
                      {/* Fixture */}
                      <div>
                        <h4 className="font-semibold text-sm leading-tight">
                          {leg.homeTeam} <span className="text-muted-foreground">{t('vs')}</span> {leg.awayTeam}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDateWithLocale(new Date(leg.kickoffUtc), "MMM d, HH:mm", i18n.language)}
                        </p>
                      </div>

                      {/* Market & Selection */}
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="text-xs">
                          {leg.market.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {leg.side} {leg.line}
                        </Badge>
                        {leg.isLive && (
                          <Badge variant="destructive" className="text-xs">
                            {t('live')}
                          </Badge>
                        )}
                      </div>

                      {/* Odds & Bookmaker */}
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-lg font-bold text-primary tabular-nums">
                            {leg.odds.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">{leg.bookmaker}</div>
                        </div>
                        {leg.combinedAvg && (
                          <div className="text-right text-xs text-muted-foreground">
                            {t('combined')}: {leg.combinedAvg.toFixed(2)}
                          </div>
                        )}
                      </div>

                      {/* Remove Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLeg(leg.id)}
                        className="w-full text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3 mr-2" />
                        {t('remove')}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Stake & Totals */}
              <Card className="p-4 bg-accent/50">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="stake" className="text-sm">
                      {t('stake')}
                    </Label>
                    <Input
                      id="stake"
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                      min={0}
                      step={5}
                      className="mt-1"
                    />
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('total_odds')}</span>
                      <span className="font-bold tabular-nums">{totalOdds.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold">
                      <span>{t('potential_return')}</span>
                      <span className="text-primary tabular-nums">{potentialReturn.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Note */}
              <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-lg">
                <strong>{t('note')}</strong> {t('odds_range_note')}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
