import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowRightLeft, 
  LineChart, 
  Trophy, 
  Activity,
  ChevronDown,
  Check
} from "lucide-react";

const FEATURES = [
  {
    id: "trade",
    icon: ArrowRightLeft,
    title: "Trade Predictions",
    description: "Buy and sell positions on match outcomes",
    demo: "betslip",
  },
  {
    id: "odds",
    icon: LineChart,
    title: "Live Odds Display",
    description: "Real-time price movements and charts",
    demo: "chart",
  },
  {
    id: "leaderboard",
    icon: Trophy,
    title: "Leaderboard",
    description: "Compete with other traders globally",
    demo: "rankings",
  },
  {
    id: "activity",
    icon: Activity,
    title: "Activity Feed",
    description: "See every trade as it happens",
    demo: "feed",
  },
];

function BetSlipDemo() {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-4 p-4 bg-background/50 rounded-xl border border-border/50"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-card rounded-lg border border-primary/30">
          <div>
            <div className="text-xs text-muted-foreground">Arsenal vs Chelsea</div>
            <div className="font-medium">Over 2.5 Goals</div>
          </div>
          <div className="text-primary font-bold">YES @ 62¢</div>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="text" 
            value="100" 
            readOnly
            className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-right"
          />
          <span className="text-muted-foreground">coins</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Potential Payout</span>
          <span className="text-green-500 font-bold">161 coins</span>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium"
        >
          Place Trade
        </motion.button>
      </div>
    </motion.div>
  );
}

function ChartDemo() {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-4 p-4 bg-background/50 rounded-xl border border-border/50"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">YES Price History</span>
        <div className="flex gap-2">
          {["1H", "24H", "7D"].map((t) => (
            <button
              key={t}
              className={`px-2 py-1 text-xs rounded ${
                t === "24H" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <svg className="w-full h-24" viewBox="0 0 200 80">
        <defs>
          <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d="M 0 60 Q 20 55 40 50 T 80 45 T 120 35 T 160 30 T 200 25"
          fill="url(#chartGradient)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        />
        <motion.path
          d="M 0 60 Q 20 55 40 50 T 80 45 T 120 35 T 160 30 T 200 25"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1 }}
        />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground mt-2">
        <span>24h ago</span>
        <span className="text-primary font-medium">+12% ↑</span>
        <span>Now</span>
      </div>
    </motion.div>
  );
}

function RankingsDemo() {
  const rankings = [
    { rank: 1, name: "ProTrader_99", roi: "+342%", badge: "🥇" },
    { rank: 2, name: "BetMaster", roi: "+289%", badge: "🥈" },
    { rank: 3, name: "SoccerGuru", roi: "+234%", badge: "🥉" },
    { rank: 4, name: "You", roi: "+156%", badge: "📈", isUser: true },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-4 p-4 bg-background/50 rounded-xl border border-border/50"
    >
      <div className="space-y-2">
        {rankings.map((r, i) => (
          <motion.div
            key={r.rank}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`flex items-center justify-between p-2 rounded-lg ${
              r.isUser ? "bg-primary/10 border border-primary/30" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">{r.badge}</span>
              <span className={r.isUser ? "text-primary font-medium" : ""}>{r.name}</span>
            </div>
            <span className="text-green-500 font-bold">{r.roi}</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function FeedDemo() {
  const activities = [
    { user: "Alex_Pro", action: "bought YES", market: "Arsenal O2.5", time: "2s" },
    { user: "BetKing", action: "sold NO", market: "Chelsea BTTS", time: "5s" },
    { user: "Winner22", action: "bought YES", market: "Madrid Win", time: "8s" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-4 p-4 bg-background/50 rounded-xl border border-border/50"
    >
      <div className="space-y-2">
        {activities.map((a, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.15 }}
            className="flex items-center justify-between text-sm"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs">
                {a.user[0]}
              </div>
              <span>
                <span className="font-medium">{a.user}</span>{" "}
                <span className="text-muted-foreground">{a.action}</span>{" "}
                <span className="text-primary">{a.market}</span>
              </span>
            </div>
            <span className="text-xs text-muted-foreground">{a.time} ago</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

export function FeatureDemoCards() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const getDemoComponent = (demo: string) => {
    switch (demo) {
      case "betslip": return <BetSlipDemo />;
      case "chart": return <ChartDemo />;
      case "rankings": return <RankingsDemo />;
      case "feed": return <FeedDemo />;
      default: return null;
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {FEATURES.map((feature, i) => (
        <motion.div
          key={feature.id}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.1 }}
          className="group"
        >
          <motion.button
            onClick={() => setExpanded(expanded === feature.id ? null : feature.id)}
            whileHover={{ scale: 1.01 }}
            className={`w-full text-left p-5 rounded-xl border transition-all ${
              expanded === feature.id
                ? "bg-card border-primary/50 shadow-lg shadow-primary/10"
                : "bg-card/50 border-border hover:border-primary/30"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-xl transition-colors ${
                  expanded === feature.id ? "bg-primary/20" : "bg-primary/10"
                }`}>
                  <feature.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              </div>
              <motion.div
                animate={{ rotate: expanded === feature.id ? 180 : 0 }}
                className="mt-1"
              >
                <ChevronDown className="w-5 h-5 text-muted-foreground" />
              </motion.div>
            </div>
            
            <AnimatePresence>
              {expanded === feature.id && getDemoComponent(feature.demo)}
            </AnimatePresence>
          </motion.button>
        </motion.div>
      ))}
    </div>
  );
}
