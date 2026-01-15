import { useState } from "react";
import { motion } from "framer-motion";
import { 
  Zap, 
  Filter, 
  BarChart3, 
  Shield, 
  Target,
  Crosshair,
  AlertTriangle,
  TrendingUp
} from "lucide-react";

const FEATURES = [
  {
    id: "ticket",
    icon: Zap,
    title: "AI Ticket Creator",
    description: "Auto-build optimized betting tickets",
    color: "text-primary",
    demo: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl">
        <div className="w-full p-3 space-y-1">
          {[1, 2, 3].map((i) => (
            <motion.div
              key={i}
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: i * 0.15 }}
              className="flex items-center justify-between p-2 bg-card/80 rounded text-xs"
            >
              <span>Match {i}</span>
              <span className="text-primary">1.{85 + i * 5}</span>
            </motion.div>
          ))}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-center pt-2 text-primary font-bold"
          >
            Total: 4.61
          </motion.div>
        </div>
      </div>
    ),
  },
  {
    id: "filterizer",
    icon: Filter,
    title: "Filterizer",
    description: "Find value picks with custom filters",
    color: "text-blue-400",
    demo: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl p-3">
        <div className="space-y-2 w-full">
          {[
            { label: "Min Odds", value: "1.5" },
            { label: "Edge %", value: ">3%" },
          ].map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.2 }}
              className="flex justify-between items-center"
            >
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <motion.span
                animate={{ color: ["#fff", "hsl(var(--primary))", "#fff"] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="text-xs font-bold"
              >
                {f.value}
              </motion.span>
            </motion.div>
          ))}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center text-xs text-green-500 pt-2"
          >
            12 matches found
          </motion.div>
        </div>
      </div>
    ),
  },
  {
    id: "analyzer",
    icon: BarChart3,
    title: "Fixture Analyzer",
    description: "Deep match statistics & insights",
    color: "text-purple-400",
    demo: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl p-3">
        <div className="w-full space-y-2">
          {[
            { label: "xG", pct: 72 },
            { label: "Shots", pct: 65 },
            { label: "Corners", pct: 58 },
          ].map((stat, i) => (
            <motion.div key={stat.label} className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{stat.label}</span>
                <span>{stat.pct}%</span>
              </div>
              <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${stat.pct}%` }}
                  transition={{ delay: i * 0.15, duration: 0.5 }}
                  className="h-full bg-purple-400"
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "safezone",
    icon: Shield,
    title: "Safe Zone",
    description: "High-probability predictions",
    color: "text-green-400",
    demo: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl p-3">
        <div className="text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200 }}
            className="w-16 h-16 mx-auto mb-2 rounded-full bg-green-500/20 flex items-center justify-center"
          >
            <span className="text-2xl font-bold text-green-500">87%</span>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-xs text-green-500"
          >
            High Confidence
          </motion.div>
        </div>
      </div>
    ),
  },
  {
    id: "btts",
    icon: Target,
    title: "BTTS Index",
    description: "Both teams to score rankings",
    color: "text-orange-400",
    demo: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl p-2">
        <div className="w-full space-y-1">
          {[
            { rank: 1, team: "Arsenal", pct: 78 },
            { rank: 2, team: "Liverpool", pct: 72 },
            { rank: 3, team: "Chelsea", pct: 68 },
          ].map((t, i) => (
            <motion.div
              key={t.rank}
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: i * 0.1 }}
              className="flex items-center justify-between text-[10px] p-1.5 bg-card/50 rounded"
            >
              <div className="flex items-center gap-1">
                <span className="text-orange-400">{t.rank}</span>
                <span>{t.team}</span>
              </div>
              <span className="text-orange-400 font-bold">{t.pct}%</span>
            </motion.div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "whoscores",
    icon: Crosshair,
    title: "Who Scores / Concedes",
    description: "Attack vs defense analysis",
    color: "text-red-400",
    demo: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl p-3">
        <div className="w-full space-y-3">
          <div className="flex justify-between items-center text-xs">
            <span className="text-green-500">Attack</span>
            <span className="text-red-500">Defense</span>
          </div>
          <div className="relative h-3 bg-muted/30 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "65%" }}
              transition={{ duration: 0.8 }}
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-green-500 to-green-400"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "35%" }}
              transition={{ duration: 0.8 }}
              className="absolute right-0 top-0 h-full bg-gradient-to-l from-red-500 to-red-400"
            />
          </div>
          <div className="text-center text-[10px] text-muted-foreground">
            Attack Favored +30%
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "cardwars",
    icon: AlertTriangle,
    title: "Card Wars",
    description: "Discipline & booking predictions",
    color: "text-yellow-400",
    demo: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl p-3">
        <div className="w-full space-y-2">
          <div className="flex gap-1">
            {[3, 5, 8, 6, 4, 7, 9].map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: h * 4 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
                className="flex-1 bg-yellow-400/60 rounded-t"
                style={{ minHeight: 4 }}
              />
            ))}
          </div>
          <div className="text-center text-[10px] text-yellow-400">
            Avg 4.2 cards/match
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "teamtotals",
    icon: TrendingUp,
    title: "Team Totals",
    description: "Goal probability distributions",
    color: "text-cyan-400",
    demo: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl p-3">
        <div className="w-full space-y-1">
          {[
            { goals: "0-1", pct: 15 },
            { goals: "2-3", pct: 55 },
            { goals: "4+", pct: 30 },
          ].map((g, i) => (
            <motion.div
              key={g.goals}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.15 }}
              className="flex items-center gap-2"
            >
              <span className="text-[10px] w-8">{g.goals}</span>
              <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${g.pct}%` }}
                  transition={{ delay: 0.3 + i * 0.15, duration: 0.5 }}
                  className="h-full bg-cyan-400"
                />
              </div>
              <span className="text-[10px] text-cyan-400">{g.pct}%</span>
            </motion.div>
          ))}
        </div>
      </div>
    ),
  },
];

export function AnalyticsFeatureTiles() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {FEATURES.map((feature, i) => (
        <motion.div
          key={feature.id}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.05 }}
          onMouseEnter={() => setHoveredId(feature.id)}
          onMouseLeave={() => setHoveredId(null)}
          className="relative"
        >
          <motion.div
            whileHover={{ scale: 1.02, y: -4 }}
            className="relative h-40 p-4 bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl cursor-pointer overflow-hidden group hover:border-primary/30 transition-colors"
          >
            {/* Default state */}
            <div className={`transition-opacity duration-300 ${hoveredId === feature.id ? "opacity-0" : "opacity-100"}`}>
              <div className={`p-2.5 bg-background/50 rounded-lg w-fit mb-3 ${feature.color}`}>
                <feature.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>

            {/* Demo state on hover */}
            {hoveredId === feature.id && <feature.demo />}
          </motion.div>
        </motion.div>
      ))}
    </div>
  );
}
