import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type IceEdgeFilter = "all" | "high" | "value" | "chaos" | "p1hot";

interface IceEdgeFiltersProps {
  active: IceEdgeFilter;
  onChange: (f: IceEdgeFilter) => void;
  counts: Record<IceEdgeFilter, number>;
}

const filters: { key: IceEdgeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "High Conf" },
  { key: "value", label: "Value" },
  { key: "chaos", label: "Chaos" },
  { key: "p1hot", label: "P1 Hot" },
];

export function IceEdgeFilters({ active, onChange, counts }: IceEdgeFiltersProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      {filters.map((f) => (
        <Button
          key={f.key}
          variant={active === f.key ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(f.key)}
          className={`shrink-0 text-xs h-8 rounded-full gap-1.5 ${
            active === f.key 
              ? "bg-[hsl(200,50%,25%)] hover:bg-[hsl(200,50%,30%)] text-[hsl(200,40%,90%)] border-[hsl(200,40%,35%)]" 
              : "border-border/50 text-muted-foreground hover:text-foreground"
          }`}
        >
          {f.label}
          <Badge variant="secondary" className="h-4 px-1 text-[10px] bg-secondary/60">
            {counts[f.key]}
          </Badge>
        </Button>
      ))}
    </div>
  );
}
