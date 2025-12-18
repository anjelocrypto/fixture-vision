import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, X, Lock, ChevronDown } from "lucide-react";
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

interface DemoBTTSPanelProps {
  onClose: () => void;
  onSignUpClick: () => void;
}

// Full Championship BTTS data (24 teams)
const DEMO_BTTS_DATA = [
  { rank: 1, team_name: "Leeds United", btts_rate: 80, btts_count: 8, matches: 10 },
  { rank: 2, team_name: "Burnley", btts_rate: 75, btts_count: 9, matches: 12 },
  { rank: 3, team_name: "Sheffield United", btts_rate: 73, btts_count: 8, matches: 11 },
  { rank: 4, team_name: "Sunderland", btts_rate: 70, btts_count: 7, matches: 10 },
  { rank: 5, team_name: "West Brom", btts_rate: 67, btts_count: 8, matches: 12 },
  { rank: 6, team_name: "Norwich City", btts_rate: 64, btts_count: 7, matches: 11 },
  { rank: 7, team_name: "Middlesbrough", btts_rate: 60, btts_count: 6, matches: 10 },
  { rank: 8, team_name: "Watford", btts_rate: 58, btts_count: 7, matches: 12 },
  { rank: 9, team_name: "Coventry City", btts_rate: 55, btts_count: 6, matches: 11 },
  { rank: 10, team_name: "Bristol City", btts_rate: 55, btts_count: 6, matches: 11 },
  { rank: 11, team_name: "Blackburn Rovers", btts_rate: 50, btts_count: 5, matches: 10 },
  { rank: 12, team_name: "Stoke City", btts_rate: 50, btts_count: 6, matches: 12 },
  { rank: 13, team_name: "Hull City", btts_rate: 50, btts_count: 5, matches: 10 },
  { rank: 14, team_name: "QPR", btts_rate: 45, btts_count: 5, matches: 11 },
  { rank: 15, team_name: "Swansea City", btts_rate: 45, btts_count: 5, matches: 11 },
  { rank: 16, team_name: "Preston North End", btts_rate: 42, btts_count: 5, matches: 12 },
  { rank: 17, team_name: "Millwall", btts_rate: 40, btts_count: 4, matches: 10 },
  { rank: 18, team_name: "Cardiff City", btts_rate: 40, btts_count: 4, matches: 10 },
  { rank: 19, team_name: "Plymouth Argyle", btts_rate: 36, btts_count: 4, matches: 11 },
  { rank: 20, team_name: "Luton Town", btts_rate: 33, btts_count: 4, matches: 12 },
  { rank: 21, team_name: "Sheffield Wednesday", btts_rate: 30, btts_count: 3, matches: 10 },
  { rank: 22, team_name: "Derby County", btts_rate: 27, btts_count: 3, matches: 11 },
  { rank: 23, team_name: "Oxford United", btts_rate: 25, btts_count: 3, matches: 12 },
  { rank: 24, team_name: "Portsmouth", btts_rate: 20, btts_count: 2, matches: 10 },
];

const getBTTSBadgeVariant = (rate: number): "destructive" | "default" | "secondary" | "outline" => {
  if (rate >= 70) return "destructive";
  if (rate >= 50) return "default";
  if (rate >= 30) return "secondary";
  return "outline";
};

export function DemoBTTSPanel({ onClose, onSignUpClick }: DemoBTTSPanelProps) {
  return (
    <Card className="w-full shadow-lg max-w-2xl mx-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            BTTS Index
            <Badge variant="secondary" className="text-xs">Demo</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Teams ranked by Both Teams To Score percentage
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
                <TableHead className="text-right w-20">BTTS %</TableHead>
                <TableHead className="text-right w-20">BTTS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_BTTS_DATA.map((team) => (
                <TableRow key={team.rank}>
                  <TableCell>
                    <Badge variant={getBTTSBadgeVariant(team.btts_rate)} className="w-8 justify-center">
                      {team.rank}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{team.team_name}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {team.btts_rate}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {team.btts_count}/{team.matches}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Teams at the top have the highest Both Teams To Score rate
        </p>

        {/* CTA */}
        <Card className="p-3 border-dashed border-primary/40 bg-primary/5 text-center">
          <p className="text-sm text-muted-foreground mb-2">
            Want live BTTS rankings for all 100+ leagues?
          </p>
          <button onClick={onSignUpClick} className="text-primary font-medium hover:underline">
            Create account for live data →
          </button>
        </Card>
      </CardContent>
    </Card>
  );
}
