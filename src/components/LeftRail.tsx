import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Country {
  id: number;
  name: string;
  flag: string;
  code: string;
}

interface LeftRailProps {
  countries: Country[];
  selectedCountry: number | null;
  onSelectCountry: (id: number) => void;
}

export function LeftRail({ countries, selectedCountry, onSelectCountry }: LeftRailProps) {
  return (
    <div className="w-[280px] border-r border-border bg-card/30 backdrop-blur-sm flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold mb-3">Filters</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search countries/leagues..." 
            className="pl-9 bg-secondary/50"
          />
        </div>
      </div>
      
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Region</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {countries.map((country) => (
            <button
              key={country.id}
              onClick={() => onSelectCountry(country.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                selectedCountry === country.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "hover:bg-secondary/50 text-foreground"
              }`}
            >
              <span className="text-2xl">{country.flag}</span>
              <span className="text-sm font-medium">{country.name}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
