import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  ChevronRight, Trophy, Target, BarChart3, Sparkles, 
  ArrowRight, Info, Lock, Play, Eye
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { DemoProvider, useDemoContext } from "@/contexts/DemoContext";
import { DEMO_FIXTURES, DEMO_METADATA, DemoFixture } from "@/config/demoFixtures";
import ticketLogo from "@/assets/ticket-logo.png";

function DemoContent() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isDemo, demoFixtures } = useDemoContext();
  const [selectedFixture, setSelectedFixture] = useState<DemoFixture | null>(null);
  const [fixtureDetails, setFixtureDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Group fixtures by league
  const fixturesByLeague = demoFixtures.reduce((acc, fixture) => {
    if (!acc[fixture.leagueName]) {
      acc[fixture.leagueName] = [];
    }
    acc[fixture.leagueName].push(fixture);
    return acc;
  }, {} as Record<string, DemoFixture[]>);

  const loadFixtureDetails = async (fixture: DemoFixture) => {
    setSelectedFixture(fixture);
    setLoadingDetails(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('demo-fixtures', {
        body: { mode: 'details', fixture_id: fixture.fixtureId }
      });
      
      if (error) throw error;
      setFixtureDetails(data);
    } catch (error) {
      console.error('Error loading fixture details:', error);
      toast({
        title: "Error loading details",
        description: "Please try again",
        variant: "destructive"
      });
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleSignUpClick = () => {
    toast({
      title: "Ready to start?",
      description: "Create an account to access live tips on today's matches!",
    });
    navigate('/landing');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Demo Mode Banner */}
      <div className="bg-primary/10 border-b border-primary/30 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-primary/20 text-primary border-primary/40">
              <Play className="h-3 w-3 mr-1" />
              DEMO MODE
            </Badge>
            <span className="text-sm text-muted-foreground hidden sm:inline">
              Past matches only – not live tips
            </span>
          </div>
          <Button size="sm" onClick={handleSignUpClick} className="gap-1">
            Get Live Tips
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Header */}
      <header className="border-b border-border/30 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={ticketLogo} alt="Ticket" className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold">TICKET 1.0</span>
            <Badge variant="secondary" className="ml-2">Demo</Badge>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/landing">
              <Button variant="outline" size="sm">Sign In</Button>
            </Link>
            <Link to="/landing">
              <Button size="sm">Create Account</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Intro Section */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">Explore TicketAI</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            This is a demo using historical matches from {DEMO_METADATA.matchday}. 
            Explore the interface and see how our tools analyze fixtures with real statistics.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: Fixture List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Demo Fixtures</h2>
              <Badge variant="outline">{demoFixtures.length} matches</Badge>
            </div>

            <div className="space-y-4">
              {Object.entries(fixturesByLeague).map(([league, fixtures]) => (
                <Card key={league} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Trophy className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">{league}</span>
                  </div>
                  <div className="space-y-2">
                    {fixtures.map((fixture) => (
                      <button
                        key={fixture.fixtureId}
                        onClick={() => loadFixtureDetails(fixture)}
                        className={`w-full text-left p-3 rounded-lg border transition-all hover:border-primary/50 ${
                          selectedFixture?.fixtureId === fixture.fixtureId 
                            ? 'border-primary bg-primary/5' 
                            : 'border-border bg-card'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{fixture.homeTeam}</span>
                          <span className="text-lg font-bold text-primary">
                            {fixture.score.home}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{fixture.awayTeam}</span>
                          <span className="text-lg font-bold text-primary">
                            {fixture.score.away}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <span>⚽ {fixture.score.home + fixture.score.away} goals</span>
                          <span>🎴 {fixture.stats.cardsHome + fixture.stats.cardsAway} cards</span>
                          <span>📐 {fixture.stats.cornersHome + fixture.stats.cornersAway} corners</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Center: Fixture Details */}
          <div className="lg:col-span-2 space-y-4">
            {!selectedFixture ? (
              <Card className="p-12 text-center">
                <Eye className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">Select a Fixture</h3>
                <p className="text-muted-foreground text-sm">
                  Click on any match on the left to see detailed statistics and analysis
                </p>
              </Card>
            ) : loadingDetails ? (
              <Card className="p-12 text-center">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-muted-foreground">Loading match details...</p>
              </Card>
            ) : fixtureDetails ? (
              <div className="space-y-4">
                {/* Match Header */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <Badge variant="outline">{fixtureDetails.fixture?.league_name}</Badge>
                    <Badge variant="secondary">Final Result</Badge>
                  </div>
                  <div className="flex items-center justify-center gap-8">
                    <div className="text-center">
                      <img 
                        src={fixtureDetails.fixture?.home_logo} 
                        alt={fixtureDetails.fixture?.home_team}
                        className="h-16 w-16 mx-auto mb-2 object-contain"
                      />
                      <div className="font-semibold">{fixtureDetails.fixture?.home_team}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-4xl font-bold text-primary">
                        {fixtureDetails.result?.goals_home} - {fixtureDetails.result?.goals_away}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Full Time</div>
                    </div>
                    <div className="text-center">
                      <img 
                        src={fixtureDetails.fixture?.away_logo} 
                        alt={fixtureDetails.fixture?.away_team}
                        className="h-16 w-16 mx-auto mb-2 object-contain"
                      />
                      <div className="font-semibold">{fixtureDetails.fixture?.away_team}</div>
                    </div>
                  </div>
                </Card>

                {/* Match Stats */}
                <Card className="p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Match Statistics
                  </h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Corners', home: fixtureDetails.result?.corners_home, away: fixtureDetails.result?.corners_away },
                      { label: 'Cards', home: fixtureDetails.result?.cards_home, away: fixtureDetails.result?.cards_away },
                      { label: 'Fouls', home: fixtureDetails.result?.fouls_home, away: fixtureDetails.result?.fouls_away },
                    ].map((stat) => (
                      <div key={stat.label} className="flex items-center">
                        <div className="w-12 text-right font-medium">{stat.home ?? '-'}</div>
                        <div className="flex-1 mx-4">
                          <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                            <div 
                              className="bg-primary h-full" 
                              style={{ width: `${((stat.home || 0) / ((stat.home || 0) + (stat.away || 0) + 1)) * 100}%` }}
                            />
                            <div 
                              className="bg-secondary h-full" 
                              style={{ width: `${((stat.away || 0) / ((stat.home || 0) + (stat.away || 0) + 1)) * 100}%` }}
                            />
                          </div>
                          <div className="text-center text-xs text-muted-foreground mt-1">{stat.label}</div>
                        </div>
                        <div className="w-12 text-left font-medium">{stat.away ?? '-'}</div>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Team Form (from stats cache) */}
                {(fixtureDetails.team_stats?.home || fixtureDetails.team_stats?.away) && (
                  <Card className="p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Pre-Match Form (Last 5 Games)
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <div className="text-sm font-medium mb-2">{fixtureDetails.fixture?.home_team}</div>
                        {fixtureDetails.team_stats?.home ? (
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Goals/game</span>
                              <span className="font-medium">{fixtureDetails.team_stats.home.goals?.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Corners/game</span>
                              <span className="font-medium">{fixtureDetails.team_stats.home.corners?.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Cards/game</span>
                              <span className="font-medium">{fixtureDetails.team_stats.home.cards?.toFixed(2)}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No data available</div>
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-2">{fixtureDetails.fixture?.away_team}</div>
                        {fixtureDetails.team_stats?.away ? (
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Goals/game</span>
                              <span className="font-medium">{fixtureDetails.team_stats.away.goals?.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Corners/game</span>
                              <span className="font-medium">{fixtureDetails.team_stats.away.corners?.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Cards/game</span>
                              <span className="font-medium">{fixtureDetails.team_stats.away.cards?.toFixed(2)}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No data available</div>
                        )}
                      </div>
                    </div>
                  </Card>
                )}

                {/* BTTS Analysis */}
                {(fixtureDetails.btts?.home || fixtureDetails.btts?.away) && (
                  <Card className="p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      BTTS History
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <div className="text-sm font-medium mb-2">{fixtureDetails.fixture?.home_team}</div>
                        {fixtureDetails.btts?.home ? (
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">BTTS Rate (5 games)</span>
                              <span className="font-medium">{(fixtureDetails.btts.home.btts_5_rate * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">BTTS Rate (10 games)</span>
                              <span className="font-medium">{(fixtureDetails.btts.home.btts_10_rate * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No data available</div>
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-2">{fixtureDetails.fixture?.away_team}</div>
                        {fixtureDetails.btts?.away ? (
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">BTTS Rate (5 games)</span>
                              <span className="font-medium">{(fixtureDetails.btts.away.btts_5_rate * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">BTTS Rate (10 games)</span>
                              <span className="font-medium">{(fixtureDetails.btts.away.btts_10_rate * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No data available</div>
                        )}
                      </div>
                    </div>
                  </Card>
                )}

                {/* Demo Note */}
                <Card className="p-4 bg-muted/50 border-dashed">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium mb-1">This is historical data</p>
                      <p className="text-muted-foreground">
                        {fixtureDetails.demo_note || "For live predictions on upcoming matches, create an account to access our AI-powered betting tools."}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            ) : null}

            {/* Disabled Features */}
            <Card className="p-6 border-dashed border-muted-foreground/30">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Premium Features (Requires Account)
              </h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { name: 'AI Ticket Creator', desc: 'Auto-generate optimized betting tickets' },
                  { name: 'Filterizer', desc: 'Filter fixtures by statistical criteria' },
                  { name: 'Live Odds', desc: 'Real-time odds from multiple bookmakers' },
                  { name: 'Save Tickets', desc: 'Build and save your own betting tickets' },
                ].map((feature) => (
                  <div key={feature.name} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                    <div className="font-medium text-sm">{feature.name}</div>
                    <div className="text-xs text-muted-foreground">{feature.desc}</div>
                  </div>
                ))}
              </div>
              <Button className="w-full mt-4" onClick={handleSignUpClick}>
                <Sparkles className="h-4 w-4 mr-2" />
                Unlock All Features – Start Free Trial
              </Button>
            </Card>
          </div>
        </div>
      </main>

      {/* Footer CTA */}
      <footer className="border-t border-border/30 mt-12 py-8 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-2">Ready for Real Predictions?</h2>
          <p className="text-muted-foreground mb-4">
            Get AI-powered betting tips for today's matches. Start your free 3-day trial now.
          </p>
          <Button size="lg" onClick={handleSignUpClick} className="gap-2">
            Create Free Account
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

export default function Demo() {
  return (
    <DemoProvider>
      <DemoContent />
    </DemoProvider>
  );
}
