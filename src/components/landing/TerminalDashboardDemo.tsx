import { motion } from "framer-motion";
import { 
  Activity, 
  BarChart3, 
  Target, 
  TrendingUp,
  Zap,
  Shield
} from "lucide-react";

export function TerminalDashboardDemo() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
      className="relative"
    >
      {/* Glow effect */}
      <div className="absolute -inset-4 bg-primary/10 rounded-3xl blur-3xl" />
      
      <div className="relative bg-card/90 backdrop-blur-xl border border-primary/20 rounded-2xl overflow-hidden shadow-2xl">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-background/50 border-b border-border/50">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-xs text-muted-foreground ml-2">TicketAI Analytics Terminal</span>
          <div className="ml-auto flex items-center gap-2">
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="flex items-center gap-1 text-xs text-primary"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              LIVE
            </motion.div>
          </div>
        </div>

        {/* Dashboard grid */}
        <div className="p-4 grid grid-cols-12 gap-3">
          {/* Match Analyzer Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="col-span-12 md:col-span-4 bg-background/50 rounded-xl p-4 border border-border/50"
          >
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Match Analyzer</span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Arsenal</span>
                <span className="text-xs text-muted-foreground">Chelsea</span>
              </div>
              {[
                { label: "xG", home: 75, away: 45 },
                { label: "Shots", home: 60, away: 40 },
                { label: "Corners", home: 55, away: 65 },
              ].map((stat, i) => (
                <div key={stat.label} className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{stat.home}%</span>
                    <span>{stat.label}</span>
                    <span>{stat.away}%</span>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-muted/30">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${stat.home}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3 + i * 0.1, duration: 0.6 }}
                      className="bg-primary"
                    />
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${stat.away}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3 + i * 0.1, duration: 0.6 }}
                      className="bg-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* AI Ticket Creator Preview */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="col-span-12 md:col-span-4 bg-background/50 rounded-xl p-4 border border-border/50"
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">AI Ticket Creator</span>
            </div>
            <div className="space-y-2">
              {[
                { match: "Arsenal vs Chelsea", pick: "Over 2.5", odds: "1.85", prob: "62%" },
                { match: "Man City vs Liverpool", pick: "BTTS Yes", odds: "1.72", prob: "71%" },
                { match: "Real vs Barca", pick: "Over 1.5", odds: "1.45", prob: "82%" },
              ].map((leg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.4 + i * 0.1 }}
                  className="flex items-center justify-between p-2 bg-card/50 rounded-lg text-xs"
                >
                  <div className="flex-1">
                    <div className="text-muted-foreground truncate">{leg.match}</div>
                    <div className="font-medium">{leg.pick}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-primary font-bold">{leg.odds}</div>
                    <div className="text-green-500 text-[10px]">{leg.prob}</div>
                  </div>
                </motion.div>
              ))}
              <div className="pt-2 border-t border-border/50 flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Odds</span>
                <span className="font-bold text-primary">4.61</span>
              </div>
            </div>
          </motion.div>

          {/* Edge Detector */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="col-span-12 md:col-span-4 bg-background/50 rounded-xl p-4 border border-border/50"
          >
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Edge Detection</span>
            </div>
            <div className="space-y-3">
              <motion.div
                animate={{ boxShadow: ["0 0 0 0 hsl(var(--primary) / 0)", "0 0 20px 5px hsl(var(--primary) / 0.3)", "0 0 0 0 hsl(var(--primary) / 0)"] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="p-3 bg-primary/10 rounded-lg border border-primary/30"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs">Edge Detected</span>
                  <motion.span
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="text-lg font-bold text-primary"
                  >
                    +3.2%
                  </motion.span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Arsenal Over 2.5 Goals
                </div>
                <div className="flex items-center gap-1 mt-2 text-xs text-green-500">
                  <Shield className="w-3 h-3" />
                  <span>High confidence signal</span>
                </div>
              </motion.div>
              
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 bg-card/50 rounded-lg">
                  <div className="text-lg font-bold text-primary">247</div>
                  <div className="text-[10px] text-muted-foreground">Edges Found Today</div>
                </div>
                <div className="p-2 bg-card/50 rounded-lg">
                  <div className="text-lg font-bold text-green-500">68%</div>
                  <div className="text-[10px] text-muted-foreground">Win Rate</div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Odds Movement Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5 }}
            className="col-span-12 bg-background/50 rounded-xl p-4 border border-border/50"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Odds Movement</span>
              </div>
              <div className="flex gap-2 text-xs">
                {["1H", "6H", "24H", "7D"].map((t) => (
                  <button
                    key={t}
                    className={`px-2 py-1 rounded ${
                      t === "24H" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <svg className="w-full h-20" viewBox="0 0 400 60">
              <defs>
                <linearGradient id="terminalGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
              </defs>
              <motion.path
                d="M 0 50 Q 50 45 100 40 T 200 30 T 300 25 T 400 15"
                fill="url(#terminalGradient)"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6 }}
              />
              <motion.path
                d="M 0 50 Q 50 45 100 40 T 200 30 T 300 25 T 400 15"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="2"
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6, duration: 1.5 }}
              />
              <motion.circle
                cx="400"
                cy="15"
                r="4"
                fill="hsl(var(--primary))"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 1.8 }}
              />
            </svg>
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>24h ago</span>
              <span className="text-primary">Now: 1.85 (+0.12)</span>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
