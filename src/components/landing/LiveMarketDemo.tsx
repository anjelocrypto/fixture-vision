import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Users, Zap } from "lucide-react";

const MOCK_ACTIVITY = [
  { user: "Alex_Pro", action: "bought YES", amount: 25 },
  { user: "BetMaster99", action: "bought NO", amount: 50 },
  { user: "SoccerFan_UK", action: "bought YES", amount: 100 },
];

export function LiveMarketDemo() {
  const [yesPrice, setYesPrice] = useState(62);
  const [selectedSide, setSelectedSide] = useState<"yes" | "no" | null>(null);
  const [coins, setCoins] = useState(1000);
  const [activities, setActivities] = useState(MOCK_ACTIVITY);
  const [isAnimating, setIsAnimating] = useState(false);

  const noPrice = 100 - yesPrice;

  const handleBet = (side: "yes" | "no") => {
    if (isAnimating) return;
    setIsAnimating(true);
    setSelectedSide(side);
    
    // Animate price movement
    const priceChange = side === "yes" ? 3 : -3;
    setYesPrice(prev => Math.min(95, Math.max(5, prev + priceChange)));
    setCoins(prev => prev - 25);
    
    // Add activity
    const newActivity = {
      user: "You",
      action: `bought ${side.toUpperCase()}`,
      amount: 25,
    };
    setActivities(prev => [newActivity, ...prev.slice(0, 2)]);
    
    setTimeout(() => {
      setIsAnimating(false);
      setSelectedSide(null);
    }, 800);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="relative"
    >
      {/* Floating glow effect */}
      <div className="absolute -inset-4 bg-primary/20 rounded-3xl blur-2xl opacity-50 animate-pulse" />
      
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="relative bg-card/80 backdrop-blur-xl border border-primary/30 rounded-2xl p-6 shadow-2xl"
      >
        {/* Live indicator */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [1, 0.8, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-2 h-2 bg-primary rounded-full"
            />
            <span className="text-xs text-primary font-medium">LIVE MARKET</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground text-xs">
            <Users className="w-3 h-3" />
            <span>247 trading</span>
          </div>
        </div>

        {/* Match card */}
        <div className="bg-background/50 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-xs font-bold">
                ARS
              </div>
              <span className="font-semibold">Arsenal</span>
            </div>
            <span className="text-muted-foreground text-sm">vs</span>
            <div className="flex items-center gap-3">
              <span className="font-semibold">Chelsea</span>
              <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center text-xs font-bold">
                CHE
              </div>
            </div>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Over 2.5 Goals?
          </p>
        </div>

        {/* Price selector */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <motion.button
            onClick={() => handleBet("yes")}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`relative p-4 rounded-xl border-2 transition-all ${
              selectedSide === "yes"
                ? "border-green-500 bg-green-500/20"
                : "border-border hover:border-green-500/50 bg-background/50"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-green-500 font-bold">YES</span>
              <TrendingUp className="w-4 h-4 text-green-500" />
            </div>
            <motion.div
              key={yesPrice}
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              className="text-2xl font-bold"
            >
              {yesPrice}¢
            </motion.div>
            <div className="text-xs text-muted-foreground mt-1">
              +3¢ last hour
            </div>
          </motion.button>

          <motion.button
            onClick={() => handleBet("no")}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`relative p-4 rounded-xl border-2 transition-all ${
              selectedSide === "no"
                ? "border-red-500 bg-red-500/20"
                : "border-border hover:border-red-500/50 bg-background/50"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-red-500 font-bold">NO</span>
              <TrendingDown className="w-4 h-4 text-red-500" />
            </div>
            <motion.div
              key={noPrice}
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              className="text-2xl font-bold"
            >
              {noPrice}¢
            </motion.div>
            <div className="text-xs text-muted-foreground mt-1">
              -3¢ last hour
            </div>
          </motion.button>
        </div>

        {/* Mini chart */}
        <div className="h-12 mb-4 relative overflow-hidden rounded-lg bg-background/30">
          <svg className="w-full h-full" viewBox="0 0 200 48">
            <motion.path
              d={`M 0 ${48 - yesPrice * 0.4} Q 50 ${48 - (yesPrice - 5) * 0.4} 100 ${48 - (yesPrice + 2) * 0.4} T 200 ${48 - yesPrice * 0.4}`}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1 }}
            />
            <motion.circle
              cx="200"
              cy={48 - yesPrice * 0.4}
              r="4"
              fill="hsl(var(--primary))"
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          </svg>
        </div>

        {/* Activity feed */}
        <div className="space-y-2 max-h-24 overflow-hidden">
          <AnimatePresence mode="popLayout">
            {activities.map((activity, i) => (
              <motion.div
                key={`${activity.user}-${i}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1 - i * 0.3, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-3 h-3 text-primary" />
                  <span className="text-muted-foreground">
                    <span className="text-foreground font-medium">{activity.user}</span> {activity.action}
                  </span>
                </div>
                <span className="text-primary font-medium">{activity.amount} coins</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Coins balance */}
        <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Your Balance</span>
          <motion.div
            key={coins}
            initial={{ scale: 1.1, color: "hsl(var(--primary))" }}
            animate={{ scale: 1, color: "hsl(var(--foreground))" }}
            className="font-bold"
          >
            🪙 {coins.toLocaleString()} coins
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}
