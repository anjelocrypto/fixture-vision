import { motion } from "framer-motion";
import { TrendingUp, TrendingDown } from "lucide-react";

const TICKER_DATA = [
  { match: "Arsenal vs Chelsea", market: "Over 2.5", yes: 62, trend: "up" },
  { match: "Man City vs Liverpool", market: "BTTS", yes: 71, trend: "up" },
  { match: "Real Madrid vs Barcelona", market: "Home Win", yes: 45, trend: "down" },
  { match: "Bayern vs Dortmund", market: "Over 3.5", yes: 38, trend: "up" },
  { match: "PSG vs Marseille", market: "BTTS", yes: 55, trend: "down" },
  { match: "Inter vs AC Milan", market: "Under 2.5", yes: 42, trend: "up" },
  { match: "Juventus vs Napoli", market: "Draw", yes: 28, trend: "down" },
  { match: "Atletico vs Sevilla", market: "Over 1.5", yes: 78, trend: "up" },
];

function MiniSparkline({ trend }: { trend: string }) {
  const isUp = trend === "up";
  return (
    <svg className="w-12 h-6" viewBox="0 0 48 24">
      <motion.path
        d={isUp 
          ? "M 0 18 Q 12 20 24 12 T 48 6"
          : "M 0 6 Q 12 4 24 12 T 48 18"
        }
        fill="none"
        stroke={isUp ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"}
        strokeWidth="2"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8 }}
      />
    </svg>
  );
}

export function OddsTickerDemo() {
  // Duplicate for seamless loop
  const items = [...TICKER_DATA, ...TICKER_DATA];

  return (
    <div className="relative overflow-hidden py-4">
      {/* Gradient masks */}
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-background to-transparent z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-background to-transparent z-10" />
      
      <motion.div
        animate={{ x: [0, -1920] }}
        transition={{
          duration: 30,
          repeat: Infinity,
          ease: "linear",
        }}
        className="flex gap-4"
      >
        {items.map((item, i) => (
          <div
            key={i}
            className="flex-shrink-0 flex items-center gap-3 bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl px-4 py-3"
          >
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {item.match}
              </span>
              <span className="text-sm font-medium whitespace-nowrap">
                {item.market}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1 ${
                item.trend === "up" ? "text-green-500" : "text-red-500"
              }`}>
                <span className="font-bold text-lg">{item.yes}¢</span>
                {item.trend === "up" 
                  ? <TrendingUp className="w-3 h-3" />
                  : <TrendingDown className="w-3 h-3" />
                }
              </div>
              <MiniSparkline trend={item.trend} />
            </div>
            
            <div className="px-2 py-0.5 bg-primary/10 rounded text-[10px] text-primary font-medium">
              📊 Bet365
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
