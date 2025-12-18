import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Target, X, Lock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DemoWhoScoresPanelProps {
  onClose: () => void;
  onSignUpClick: () => void;
}

type Mode = 'cards' | 'fouls';

// Full Championship Cards data (24 teams)
const DEMO_CARDS_DATA = [
  { rank: 1, team_name: "Millwall", avg: 2.50, total: 25, matches: 10 },
  { rank: 2, team_name: "Stoke City", avg: 2.40, total: 29, matches: 12 },
  { rank: 3, team_name: "Sheffield Wednesday", avg: 2.30, total: 23, matches: 10 },
  { rank: 4, team_name: "Cardiff City", avg: 2.20, total: 22, matches: 10 },
  { rank: 5, team_name: "Birmingham City", avg: 2.18, total: 24, matches: 11 },
  { rank: 6, team_name: "QPR", avg: 2.10, total: 21, matches: 10 },
  { rank: 7, team_name: "Blackburn Rovers", avg: 2.00, total: 24, matches: 12 },
  { rank: 8, team_name: "Hull City", avg: 1.90, total: 19, matches: 10 },
  { rank: 9, team_name: "Preston North End", avg: 1.90, total: 21, matches: 11 },
  { rank: 10, team_name: "Plymouth Argyle", avg: 1.83, total: 22, matches: 12 },
  { rank: 11, team_name: "Sunderland", avg: 1.80, total: 18, matches: 10 },
  { rank: 12, team_name: "Derby County", avg: 1.80, total: 18, matches: 10 },
  { rank: 13, team_name: "Luton Town", avg: 1.75, total: 21, matches: 12 },
  { rank: 14, team_name: "West Brom", avg: 1.70, total: 17, matches: 10 },
  { rank: 15, team_name: "Coventry City", avg: 1.64, total: 18, matches: 11 },
  { rank: 16, team_name: "Bristol City", avg: 1.60, total: 16, matches: 10 },
  { rank: 17, team_name: "Watford", avg: 1.58, total: 19, matches: 12 },
  { rank: 18, team_name: "Middlesbrough", avg: 1.55, total: 17, matches: 11 },
  { rank: 19, team_name: "Norwich City", avg: 1.50, total: 15, matches: 10 },
  { rank: 20, team_name: "Swansea City", avg: 1.45, total: 16, matches: 11 },
  { rank: 21, team_name: "Sheffield United", avg: 1.40, total: 14, matches: 10 },
  { rank: 22, team_name: "Leeds United", avg: 1.33, total: 16, matches: 12 },
  { rank: 23, team_name: "Burnley", avg: 1.30, total: 13, matches: 10 },
  { rank: 24, team_name: "Oxford United", avg: 1.20, total: 12, matches: 10 },
];

// Full Championship Fouls data (24 teams)
const DEMO_FOULS_DATA = [
  { rank: 1, team_name: "Millwall", avg: 14.2, total: 142, matches: 10 },
  { rank: 2, team_name: "Cardiff City", avg: 13.8, total: 138, matches: 10 },
  { rank: 3, team_name: "Stoke City", avg: 13.5, total: 162, matches: 12 },
  { rank: 4, team_name: "Sheffield Wednesday", avg: 13.0, total: 130, matches: 10 },
  { rank: 5, team_name: "Preston North End", avg: 12.8, total: 141, matches: 11 },
  { rank: 6, team_name: "Plymouth Argyle", avg: 12.5, total: 150, matches: 12 },
  { rank: 7, team_name: "Blackburn Rovers", avg: 12.3, total: 148, matches: 12 },
  { rank: 8, team_name: "QPR", avg: 12.0, total: 120, matches: 10 },
  { rank: 9, team_name: "Hull City", avg: 11.8, total: 118, matches: 10 },
  { rank: 10, team_name: "Birmingham City", avg: 11.5, total: 127, matches: 11 },
  { rank: 11, team_name: "Sunderland", avg: 11.2, total: 112, matches: 10 },
  { rank: 12, team_name: "Derby County", avg: 11.0, total: 110, matches: 10 },
  { rank: 13, team_name: "Luton Town", avg: 10.8, total: 130, matches: 12 },
  { rank: 14, team_name: "West Brom", avg: 10.5, total: 105, matches: 10 },
  { rank: 15, team_name: "Coventry City", avg: 10.3, total: 113, matches: 11 },
  { rank: 16, team_name: "Bristol City", avg: 10.0, total: 100, matches: 10 },
  { rank: 17, team_name: "Watford", avg: 9.8, total: 118, matches: 12 },
  { rank: 18, team_name: "Middlesbrough", avg: 9.5, total: 105, matches: 11 },
  { rank: 19, team_name: "Norwich City", avg: 9.2, total: 92, matches: 10 },
  { rank: 20, team_name: "Swansea City", avg: 9.0, total: 99, matches: 11 },
  { rank: 21, team_name: "Sheffield United", avg: 8.8, total: 88, matches: 10 },
  { rank: 22, team_name: "Leeds United", avg: 8.5, total: 102, matches: 12 },
  { rank: 23, team_name: "Burnley", avg: 8.2, total: 82, matches: 10 },
  { rank: 24, team_name: "Oxford United", avg: 7.8, total: 78, matches: 10 },
];

const getRankBadgeVariant = (rank: number): "destructive" | "secondary" | "outline" => {
  if (rank <= 6) return "destructive";
  if (rank <= 12) return "secondary";
  return "outline";
};

export function DemoWhoScoresPanel({ onClose, onSignUpClick }: DemoWhoScoresPanelProps) {
  const [mode, setMode] = useState<Mode>('cards');
  
  const data = mode === 'cards' ? DEMO_CARDS_DATA : DEMO_FOULS_DATA;

  return (
    <Card className="w-full shadow-lg max-w-2xl mx-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {mode === 'cards' ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <Target className="h-5 w-5 text-primary" />
            )}
            Card War / Fouls
            <Badge variant="secondary" className="text-xs">Demo</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Teams ranked by average cards or fouls per match
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Country & League Selector (Locked) */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Country</label>
            <div className="relative">
              <Select disabled value="england">
                <SelectTrigger className="w-full opacity-80">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      🏴󠁧󠁢󠁥󠁮󠁧󠁿 England
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="england">🏴󠁧󠁢󠁥󠁮󠁧󠁿 England</SelectItem>
                </SelectContent>
              </Select>
              <Lock className="absolute right-8 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            </div>
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">League</label>
            <div className="relative">
              <Select disabled value="championship">
                <SelectTrigger className="w-full opacity-80">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      ⚽ Championship
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="championship">⚽ Championship</SelectItem>
                </SelectContent>
              </Select>
              <Lock className="absolute right-8 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            </div>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2">
          <Button
            variant={mode === 'cards' ? 'default' : 'outline'}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => setMode('cards')}
          >
            <ShieldAlert className="h-4 w-4" />
            Cards
          </Button>
          <Button
            variant={mode === 'fouls' ? 'default' : 'outline'}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => setMode('fouls')}
          >
            <Target className="h-4 w-4" />
            Fouls
          </Button>
        </div>

        {/* Demo Info Bar */}
        <div className="flex items-center justify-between text-sm bg-muted/50 rounded-md px-3 py-2">
          <span className="font-medium">
            Championship • 24 teams
          </span>
          <Badge variant="outline">Last 10-12 matches</Badge>
        </div>

        {/* Results Table */}
        <div className="rounded-md border max-h-[400px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right w-20">Avg</TableHead>
                <TableHead className="text-right w-20">Total</TableHead>
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
                    {mode === 'cards' ? team.avg.toFixed(2) : team.avg.toFixed(1)}
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
          {mode === 'cards' 
            ? 'Teams at the top receive the most cards per match'
            : 'Teams at the top commit the most fouls per match'
          }
        </p>

        {/* CTA */}
        <Card className="p-3 border-dashed border-primary/40 bg-primary/5 text-center">
          <p className="text-sm text-muted-foreground mb-2">
            Want live cards/fouls data for all 100+ leagues?
          </p>
          <button onClick={onSignUpClick} className="text-primary font-medium hover:underline">
            Create account for live data →
          </button>
        </Card>
      </CardContent>
    </Card>
  );
}
