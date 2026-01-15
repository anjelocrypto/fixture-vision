import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Database, Cpu, BarChart3, Target, Zap } from "lucide-react";

const STEPS = [
  {
    icon: Database,
    title: "API Football Data",
    description: "Real-time stats from 1000+ leagues",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
  {
    icon: Cpu,
    title: "Matrix Engine",
    description: "Bayesian probability calculations",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
  },
  {
    icon: BarChart3,
    title: "Odds / Probabilities",
    description: "Edge detection & value signals",
    color: "text-primary",
    bgColor: "bg-primary/10",
    borderColor: "border-primary/30",
  },
  {
    icon: Target,
    title: "User Picks Market",
    description: "Select your prediction positions",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
  },
  {
    icon: Zap,
    title: "Market Execution",
    description: "Instant trade confirmation",
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
  },
];

function GlowingConnector({ index, inView }: { index: number; inView: boolean }) {
  return (
    <div className="hidden md:flex flex-1 items-center justify-center relative">
      <svg className="w-full h-8" viewBox="0 0 100 20">
        {/* Background line */}
        <line
          x1="0"
          y1="10"
          x2="100"
          y2="10"
          stroke="hsl(var(--border))"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        {/* Animated glow line */}
        <motion.line
          x1="0"
          y1="10"
          x2="100"
          y2="10"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={inView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{ delay: 0.3 + index * 0.3, duration: 0.5 }}
        />
        {/* Moving dot */}
        <motion.circle
          r="4"
          fill="hsl(var(--primary))"
          initial={{ cx: 0, opacity: 0 }}
          animate={inView ? { 
            cx: [0, 100], 
            opacity: [0, 1, 1, 0] 
          } : {}}
          transition={{ 
            delay: 0.3 + index * 0.3, 
            duration: 0.8,
            repeat: Infinity,
            repeatDelay: 2
          }}
          cy="10"
        />
      </svg>
    </div>
  );
}

export function EngineFlowAnimation() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <div ref={ref} className="relative">
      {/* Background glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-purple-500/5 to-primary/5 rounded-3xl blur-3xl" />
      
      <div className="relative bg-card/30 backdrop-blur-sm border border-border/30 rounded-2xl p-8">
        <motion.h3
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-xl font-bold text-center mb-8"
        >
          How the Engine Works
        </motion.h3>

        {/* Desktop flow */}
        <div className="hidden md:flex items-center justify-between gap-2">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.15 }}
              className="flex items-center flex-1 last:flex-none"
            >
              <motion.div
                whileHover={{ scale: 1.05, y: -4 }}
                className={`flex-shrink-0 w-32 p-4 rounded-xl border ${step.bgColor} ${step.borderColor}`}
              >
                <div className={`p-2 rounded-lg ${step.bgColor} w-fit mb-2`}>
                  <step.icon className={`w-5 h-5 ${step.color}`} />
                </div>
                <h4 className="font-semibold text-xs mb-1 leading-tight">{step.title}</h4>
                <p className="text-[10px] text-muted-foreground leading-tight">{step.description}</p>
              </motion.div>
              
              {i < STEPS.length - 1 && <GlowingConnector index={i} inView={inView} />}
            </motion.div>
          ))}
        </div>

        {/* Mobile flow */}
        <div className="md:hidden space-y-4">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative"
            >
              <div className={`flex items-start gap-4 p-4 rounded-xl border ${step.bgColor} ${step.borderColor}`}>
                <div className={`p-2.5 rounded-lg ${step.bgColor} flex-shrink-0`}>
                  <step.icon className={`w-5 h-5 ${step.color}`} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm mb-1">{step.title}</h4>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </div>
              </div>
              
              {i < STEPS.length - 1 && (
                <div className="flex justify-center py-2">
                  <motion.div
                    initial={{ height: 0 }}
                    whileInView={{ height: 24 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 + 0.2 }}
                    className="w-0.5 bg-gradient-to-b from-primary/50 to-transparent"
                  />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
