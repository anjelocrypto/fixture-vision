import { useState, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { AppHeader } from "@/components/AppHeader";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { useHockeyIceEdge } from "@/hooks/useHockeyIceEdge";
import { IceEdgeHero } from "@/components/hockey/IceEdgeHero";
import { IceEdgeSummaryBar } from "@/components/hockey/IceEdgeSummaryBar";
import { IceEdgeFilters, type IceEdgeFilter } from "@/components/hockey/IceEdgeFilters";
import { IceEdgeCard } from "@/components/hockey/IceEdgeCard";
import { IceEdgeDetailDrawer } from "@/components/hockey/IceEdgeDetailDrawer";
import type { IceEdgeGame } from "@/hooks/useHockeyIceEdge";
import { Loader2, Snowflake } from "lucide-react";

export default function Hockey() {
  const { data: games, isLoading, error } = useHockeyIceEdge();
  const [filter, setFilter] = useState<IceEdgeFilter>("all");
  const [selectedGame, setSelectedGame] = useState<IceEdgeGame | null>(null);

  const filtered = useMemo(() => {
    if (!games) return [];
    switch (filter) {
      case "high": return games.filter(g => g.confidence_tier === "high");
      case "value": return games.filter(g => g.value_score > 0.3);
      case "chaos": return games.filter(g => g.chaos_score > 0.5);
      case "p1hot": return games.filter(g => g.p1_heat > 0.5);
      default: return games;
    }
  }, [games, filter]);

  const counts = useMemo(() => ({
    all: games?.length ?? 0,
    high: games?.filter(g => g.confidence_tier === "high").length ?? 0,
    value: games?.filter(g => g.value_score > 0.3).length ?? 0,
    chaos: games?.filter(g => g.chaos_score > 0.5).length ?? 0,
    p1hot: games?.filter(g => g.p1_heat > 0.5).length ?? 0,
  }), [games]);

  return (
    <>
      <Helmet>
        <title>Hockey IceEdge | TICKET AI</title>
        <meta name="description" content="Hockey analytics powered by IceEdge — projected totals, value signals, and smart market recommendations." />
      </Helmet>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <AppHeader />
        <main className="flex-1 p-3 md:p-6 pb-20 lg:pb-6 max-w-3xl mx-auto w-full space-y-4">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-[hsl(200,60%,50%)]" />
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center py-20">
              <div className="text-center space-y-2">
                <Snowflake className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-muted-foreground text-sm">Failed to load IceEdge data</p>
              </div>
            </div>
          ) : (
            <>
              <IceEdgeHero gameCount={games?.length ?? 0} />
              <IceEdgeSummaryBar games={games ?? []} />
              <IceEdgeFilters active={filter} onChange={setFilter} counts={counts} />
              
              {filtered.length === 0 ? (
                <div className="text-center py-12">
                  <Snowflake className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">
                    {games?.length === 0 ? "No upcoming games in the next 48h" : "No games match this filter"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map(game => (
                    <IceEdgeCard
                      key={game.game_id}
                      game={game}
                      onClick={() => setSelectedGame(game)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
        <MobileBottomNav />
      </div>

      <IceEdgeDetailDrawer
        game={selectedGame}
        open={!!selectedGame}
        onClose={() => setSelectedGame(null)}
      />
    </>
  );
}
