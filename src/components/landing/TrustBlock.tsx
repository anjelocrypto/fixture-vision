import { motion } from "framer-motion";
import { Shield, Eye, Coins, Lock } from "lucide-react";

const TRUST_ITEMS = [
  {
    icon: Coins,
    title: "Virtual Coins Only",
    description: "No real money. Pure skill-based competition.",
  },
  {
    icon: Eye,
    title: "Full Transparency",
    description: "Every action tracked and verifiable.",
  },
  {
    icon: Shield,
    title: "Store-Safe",
    description: "Compliant prediction game experience.",
  },
  {
    icon: Lock,
    title: "Secure Platform",
    description: "Bank-level encryption and security.",
  },
];

export function TrustBlock() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="relative"
    >
      {/* Subtle background */}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5 rounded-2xl" />
      
      <div className="relative bg-card/30 backdrop-blur-sm border border-primary/10 rounded-2xl p-6 md:p-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {TRUST_ITEMS.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="text-center"
            >
              <motion.div
                whileHover={{ scale: 1.1, rotate: 5 }}
                className="inline-flex p-3 bg-primary/10 rounded-xl mb-3"
              >
                <item.icon className="w-5 h-5 text-primary" />
              </motion.div>
              <h4 className="font-semibold text-sm mb-1">{item.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
            </motion.div>
          ))}
        </div>

        {/* Bottom disclaimer */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="mt-6 pt-6 border-t border-border/30 text-center"
        >
          <p className="text-xs text-muted-foreground">
            🎮 <span className="text-foreground">Virtual coins only. No real money gambling.</span> TicketAI is a skill-based prediction game for entertainment purposes.
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
