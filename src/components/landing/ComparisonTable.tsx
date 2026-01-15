import { motion } from "framer-motion";
import { Check, X, Minus } from "lucide-react";

const ROWS = [
  { feature: "Built-in Analytics Engine", ticketai: true, polymarket: false, kalshi: false },
  { feature: "Betting Optimization Tools", ticketai: true, polymarket: false, kalshi: false },
  { feature: "Deep Match Statistics", ticketai: true, polymarket: false, kalshi: false },
  { feature: "Market Execution", ticketai: true, polymarket: true, kalshi: true },
  { feature: "Sports-First System", ticketai: true, polymarket: "partial", kalshi: false },
  { feature: "Edge Detection AI", ticketai: true, polymarket: false, kalshi: false },
  { feature: "Virtual Coins (Risk-Free)", ticketai: true, polymarket: false, kalshi: false },
];

function StatusIcon({ status }: { status: boolean | string }) {
  if (status === true) {
    return (
      <motion.div
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center"
      >
        <Check className="w-4 h-4 text-green-500" />
      </motion.div>
    );
  }
  if (status === "partial") {
    return (
      <motion.div
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center"
      >
        <Minus className="w-4 h-4 text-yellow-500" />
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={{ scale: 0 }}
      whileInView={{ scale: 1 }}
      viewport={{ once: true }}
      className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center"
    >
      <X className="w-4 h-4 text-red-500/60" />
    </motion.div>
  );
}

export function ComparisonTable() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="relative"
    >
      {/* Background glow */}
      <div className="absolute inset-0 bg-primary/5 rounded-3xl blur-3xl" />
      
      <div className="relative overflow-hidden bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl">
        {/* Header */}
        <div className="grid grid-cols-4 gap-4 p-4 border-b border-border/50 bg-background/50">
          <div className="text-sm font-medium text-muted-foreground">Feature</div>
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/30 rounded-lg">
              <span className="text-sm font-bold text-primary">TicketAI</span>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-center"
          >
            <span className="text-sm text-muted-foreground">Polymarket</span>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-center"
          >
            <span className="text-sm text-muted-foreground">Kalshi</span>
          </motion.div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border/30">
          {ROWS.map((row, i) => (
            <motion.div
              key={row.feature}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="grid grid-cols-4 gap-4 p-4 hover:bg-primary/5 transition-colors"
            >
              <div className="text-sm">{row.feature}</div>
              <div className="flex justify-center">
                <StatusIcon status={row.ticketai} />
              </div>
              <div className="flex justify-center">
                <StatusIcon status={row.polymarket} />
              </div>
              <div className="flex justify-center">
                <StatusIcon status={row.kalshi} />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Footer highlight */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="p-4 bg-primary/5 border-t border-primary/20"
        >
          <p className="text-center text-sm text-muted-foreground">
            <span className="text-primary font-semibold">TicketAI</span> = Analytics + Execution in one platform
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
