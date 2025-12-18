import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DemoBTTSPanelProps {
  onClose: () => void;
  onSignUpClick: () => void;
}

// Pre-computed demo BTTS data (historical, all wins)
const DEMO_BTTS_DATA = [
  { rank: 1, team_name: "Napoli", btts_rate: 80, btts_count: 8, matches: 10 },
  { rank: 2, team_name: "AC Milan", btts_rate: 70, btts_count: 7, matches: 10 },
  { rank: 3, team_name: "Manchester United", btts_rate: 70, btts_count: 7, matches: 10 },
  { rank: 4, team_name: "Real Madrid", btts_rate: 60, btts_count: 6, matches: 10 },
  { rank: 5, team_name: "Juventus", btts_rate: 60, btts_count: 6, matches: 10 },
  { rank: 6, team_name: "Lyon", btts_rate: 50, btts_count: 5, matches: 10 },
  { rank: 7, team_name: "Wolves", btts_rate: 50, btts_count: 5, matches: 10 },
  { rank: 8, team_name: "Valencia", btts_rate: 40, btts_count: 4, matches: 10 },
];

const getBTTSBadgeVariant = (rate: number): "destructive" | "default" | "secondary" | "outline" => {
  if (rate >= 70) return "destructive";
  if (rate >= 50) return "default";
  if (rate >= 30) return "secondary";
  return "outline";
};

export function DemoBTTSPanel({ onClose, onSignUpClick }: DemoBTTSPanelProps) {
  return (
    <Card className="w-full shadow-lg">
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
        {/* Demo League Info */}
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">
            Demo Leagues • 8 teams
          </span>
          <Badge variant="outline">Last 10 matches</Badge>
        </div>

        {/* Results Table */}
        <div className="rounded-md border max-h-[300px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right w-20">BTTS %</TableHead>
                <TableHead className="text-right w-16">BTTS</TableHead>
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
            Want live BTTS rankings for all leagues?
          </p>
          <button onClick={onSignUpClick} className="text-primary font-medium hover:underline">
            Create account for live data →
          </button>
        </Card>
      </CardContent>
    </Card>
  );
}
