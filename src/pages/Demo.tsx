import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { 
  ChevronRight, Trophy, ArrowRight, Play
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DemoProvider } from "@/contexts/DemoContext";
import { DEMO_METADATA } from "@/config/demoFixtures";
import { DemoFilterizerPanel, DemoFilterCriteria } from "@/components/DemoFilterizerPanel";
import { DemoFilterizerResults } from "@/components/DemoFilterizerResults";
import { DemoTicketCreatorDialog, DemoTicket } from "@/components/DemoTicketCreatorDialog";
import { DemoTicketDisplay } from "@/components/DemoTicketDisplay";
import { DemoBTTSPanel } from "@/components/DemoBTTSPanel";
import { DemoWhoScoresPanel } from "@/components/DemoWhoScoresPanel";
import { DEMO_SELECTIONS, DemoSelection } from "@/config/demoSelections";
import ticketLogo from "@/assets/ticket-logo.png";

type ActiveFeature = 'none' | 'filterizer' | 'ticket' | 'btts' | 'whoscores' | 'fixtures';

const DEMO_FEATURES = [
  {
    id: 'ticket' as const,
    title: 'AI Ticket Creator',
    description: 'Generate optimized betting tickets with AI',
  },
  {
    id: 'filterizer' as const,
    title: 'Filterizer',
    description: 'Filter picks by market, odds, and line',
  },
  {
    id: 'btts' as const,
    title: 'BTTS Index',
    description: 'Both Teams To Score rankings',
  },
  {
    id: 'whoscores' as const,
    title: 'Cards & Fouls',
    description: 'Team cards and fouls stats',
  },
  {
    id: 'fixtures' as const,
    title: 'Match Analysis',
    description: 'Detailed fixture stats & form',
  },
];

function DemoContent() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>('none');
  
  // Filterizer state
  const [filterizerActive, setFilterizerActive] = useState(false);
  const [filteredSelections, setFilteredSelections] = useState<DemoSelection[]>([]);
  
  // Ticket Creator state
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [generatedTicket, setGeneratedTicket] = useState<DemoTicket | null>(null);

  const handleSignUpClick = () => {
    toast({
      title: "Ready to start?",
      description: "Create an account to access live tips on today's matches!",
    });
    navigate('/landing');
  };

  const handleFeatureClick = (featureId: ActiveFeature) => {
    if (featureId === 'ticket') {
      setTicketDialogOpen(true);
    } else {
      setActiveFeature(featureId);
    }
  };

  const closeFeature = () => {
    setActiveFeature('none');
    setFilterizerActive(false);
    setFilteredSelections([]);
  };

  // Filterizer handlers
  const handleApplyFilters = (filters: DemoFilterCriteria) => {
    const filtered = DEMO_SELECTIONS.filter(s => 
      s.market === filters.market &&
      s.side === filters.side &&
      s.line === filters.line &&
      s.odds >= filters.minOdds &&
      s.result.hit // Only show winning picks
    );
    setFilteredSelections(filtered);
    setFilterizerActive(true);
  };

  const handleClearFilters = () => {
    setFilteredSelections([]);
    setFilterizerActive(false);
  };

  // Ticket Creator handlers
  const handleGenerateTicket = (ticket: DemoTicket) => {
    setGeneratedTicket(ticket);
    setActiveFeature('ticket');
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
              Historical matches – explore our features
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

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Intro Section */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">Explore TicketAI Features</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Try our AI-powered betting tools using historical data from {DEMO_METADATA.matchday}. 
            Click any feature below to explore!
          </p>
        </div>

        {/* Feature Selection Grid */}
        {activeFeature === 'none' && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {DEMO_FEATURES.map((feature) => (
              <Card
                key={feature.id}
                className="p-5 cursor-pointer transition-all hover:border-primary/50 hover:bg-muted/30"
                onClick={() => handleFeatureClick(feature.id)}
              >
                <h3 className="font-semibold mb-1">{feature.title}</h3>
                <p className="text-sm text-muted-foreground mb-3">{feature.description}</p>
                <div className="flex items-center text-sm text-primary font-medium">
                  Try Demo
                  <ChevronRight className="h-4 w-4 ml-1" />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Active Feature Panel */}
        {activeFeature === 'filterizer' && (
          <div className="space-y-4">
            <Button variant="ghost" onClick={closeFeature} className="mb-2">
              ← Back to Features
            </Button>
            <DemoFilterizerPanel
              onApplyFilters={handleApplyFilters}
              onClearFilters={handleClearFilters}
              isActive={filterizerActive}
            />
            {filterizerActive && (
              <DemoFilterizerResults
                selections={filteredSelections}
                onSignUpClick={handleSignUpClick}
              />
            )}
          </div>
        )}

        {activeFeature === 'ticket' && generatedTicket && (
          <div className="space-y-4">
            <Button variant="ghost" onClick={() => { closeFeature(); setGeneratedTicket(null); }} className="mb-2">
              ← Back to Features
            </Button>
            <DemoTicketDisplay
              ticket={generatedTicket}
              onSignUpClick={handleSignUpClick}
              onGenerateAnother={() => setTicketDialogOpen(true)}
            />
          </div>
        )}

        {activeFeature === 'btts' && (
          <div className="space-y-4">
            <Button variant="ghost" onClick={closeFeature} className="mb-2">
              ← Back to Features
            </Button>
            <DemoBTTSPanel onClose={closeFeature} onSignUpClick={handleSignUpClick} />
          </div>
        )}

        {activeFeature === 'whoscores' && (
          <div className="space-y-4">
            <Button variant="ghost" onClick={closeFeature} className="mb-2">
              ← Back to Features
            </Button>
            <DemoWhoScoresPanel onClose={closeFeature} onSignUpClick={handleSignUpClick} />
          </div>
        )}

        {activeFeature === 'fixtures' && (
          <div className="space-y-4">
            <Button variant="ghost" onClick={closeFeature} className="mb-2">
              ← Back to Features
            </Button>
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold">Match Analysis</h3>
                  <p className="text-sm text-muted-foreground">Detailed stats for each fixture</p>
                </div>
                <Badge variant="secondary">Demo</Badge>
              </div>
              
              <div className="space-y-3">
                {[
                  { home: "Wolves", away: "Manchester United", score: "1-4", goals: 5, corners: 10, cards: 5 },
                  { home: "Napoli", away: "Juventus", score: "2-1", goals: 3, corners: 9, cards: 3 },
                  { home: "Real Madrid", away: "Celta Vigo", score: "0-2", goals: 2, corners: 9, cards: 10 },
                  { home: "Torino", away: "AC Milan", score: "2-3", goals: 5, corners: 6, cards: 3 },
                ].map((match, idx) => (
                  <div key={idx} className="p-4 rounded-lg border bg-card hover:border-primary/30 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{match.home} vs {match.away}</span>
                      <Badge className="bg-green-500">{match.score}</Badge>
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span>⚽ {match.goals} goals</span>
                      <span>📐 {match.corners} corners</span>
                      <span>🎴 {match.cards} cards</span>
                    </div>
                  </div>
                ))}
              </div>

              <Card className="p-3 mt-4 border-dashed border-primary/40 bg-primary/5 text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  Want detailed analysis for today's live matches?
                </p>
                <button onClick={handleSignUpClick} className="text-primary font-medium hover:underline">
                  Create account for live analysis →
                </button>
              </Card>
            </Card>
          </div>
        )}

        {/* Ticket Creator Dialog */}
        <DemoTicketCreatorDialog
          open={ticketDialogOpen}
          onOpenChange={setTicketDialogOpen}
          onGenerate={handleGenerateTicket}
        />

        {/* Footer CTA (only show when no feature is active) */}
        {activeFeature === 'none' && (
          <Card className="p-8 text-center bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
            <Trophy className="h-12 w-12 mx-auto mb-4 text-primary" />
            <h2 className="text-2xl font-bold mb-2">Ready for Real Predictions?</h2>
            <p className="text-muted-foreground mb-4 max-w-md mx-auto">
              Get AI-powered betting tips for today's matches. Start your free trial now.
            </p>
            <Button size="lg" onClick={handleSignUpClick} className="gap-2">
              Create Free Account
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Card>
        )}
      </main>
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
