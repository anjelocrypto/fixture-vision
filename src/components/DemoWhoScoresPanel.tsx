import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Target, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DemoWhoScoresPanelProps {
  onClose: () => void;
  onSignUpClick: () => void;
}

type Mode = 'concedes' | 'scores';

// Pre-computed demo data
const DEMO_CONCEDES_DATA = [
  { rank: 1, team_name: "Wolves", avg: 2.10, total: 21, matches: 10 },
  { rank: 2, team_name: "Valencia", avg: 1.90, total: 19, matches: 10 },
  { rank: 3, team_name: "AS Roma", avg: 1.80, total: 18, matches: 10 },
  { rank: 4, team_name: "Lorient", avg: 1.70, total: 17, matches: 10 },
  { rank: 5, team_name: "Espanyol", avg: 1.60, total: 16, matches: 10 },
  { rank: 6, team_name: "Udinese", avg: 1.50, total: 15, matches: 10 },
];

const DEMO_SCORES_DATA = [
  { rank: 1, team_name: "Manchester United", avg: 2.40, total: 24, matches: 10 },
  { rank: 2, team_name: "Napoli", avg: 2.20, total: 22, matches: 10 },
  { rank: 3, team_name: "AC Milan", avg: 2.10, total: 21, matches: 10 },
  { rank: 4, team_name: "Real Madrid", avg: 1.90, total: 19, matches: 10 },
  { rank: 5, team_name: "Lyon", avg: 1.80, total: 18, matches: 10 },
  { rank: 6, team_name: "Juventus", avg: 1.70, total: 17, matches: 10 },
];

const getRankBadgeVariant = (rank: number): "destructive" | "secondary" | "outline" => {
  if (rank <= 3) return "destructive";
  if (rank <= 6) return "secondary";
  return "outline";
};

export function DemoWhoScoresPanel({ onClose, onSignUpClick }: DemoWhoScoresPanelProps) {
  const [mode, setMode] = useState<Mode>('scores');
  
  const data = mode === 'concedes' ? DEMO_CONCEDES_DATA : DEMO_SCORES_DATA;

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {mode === 'concedes' ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <Target className="h-5 w-5 text-primary" />
            )}
            Who Scores / Concedes?
            <Badge variant="secondary" className="text-xs">Demo</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Teams ranked by average goals scored or conceded
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode Toggle */}
        <div className="flex gap-2">
          <Button
            variant={mode === 'scores' ? 'default' : 'outline'}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => setMode('scores')}
          >
            <Target className="h-4 w-4" />
            Top Scorers
          </Button>
          <Button
            variant={mode === 'concedes' ? 'default' : 'outline'}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => setMode('concedes')}
          >
            <ShieldAlert className="h-4 w-4" />
            Most Concede
          </Button>
        </div>

        {/* Demo Info */}
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">
            Demo Data • 6 teams
          </span>
          <Badge variant="outline">Last 10 matches</Badge>
        </div>

        {/* Results Table */}
        <div className="rounded-md border max-h-[250px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right w-20">Avg</TableHead>
                <TableHead className="text-right w-16">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((team) => (
                <TableRow key={team.rank}>
                  <TableCell>
                    <Badge variant={getRankBadgeVariant(team.rank)} className="w-8 justify-center">
                      {team.rank}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{team.team_name}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {team.avg.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {team.total}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          {mode === 'scores' 
            ? 'Teams at the top score the most goals'
            : 'Teams at the top concede the most goals'
          }
        </p>

        {/* CTA */}
        <Card className="p-3 border-dashed border-primary/40 bg-primary/5 text-center">
          <p className="text-sm text-muted-foreground mb-2">
            Want live scoring/conceding data for all leagues?
          </p>
          <button onClick={onSignUpClick} className="text-primary font-medium hover:underline">
            Create account for live data →
          </button>
        </Card>
      </CardContent>
    </Card>
  );
}
