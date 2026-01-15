import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, BarChart3, Trophy, Play, RotateCcw } from "lucide-react";

const STEPS = [
  {
    id: 1,
    icon: UserPlus,
    title: "Sign Up",
    description: "Create your free account in seconds",
    demo: "signup",
  },
  {
    id: 2,
    icon: BarChart3,
    title: "Analyze",
    description: "Use AI-powered analytics to find value",
    demo: "analyze",
  },
  {
    id: 3,
    icon: Trophy,
    title: "Win",
    description: "Execute trades and climb the leaderboard",
    demo: "win",
  },
];

function SignUpDemo({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="absolute inset-0 flex items-center justify-center bg-background/95 rounded-xl"
        >
          <div className="w-full max-w-[200px] space-y-3 p-4">
            <motion.div
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="h-8 bg-muted/30 rounded-lg flex items-center px-3"
            >
              <span className="text-xs text-muted-foreground">email@example.com</span>
            </motion.div>
            <motion.div
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="h-8 bg-muted/30 rounded-lg flex items-center px-3"
            >
              <span className="text-xs text-muted-foreground">••••••••</span>
            </motion.div>
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4, type: "spring" }}
              className="h-8 bg-primary rounded-lg flex items-center justify-center"
            >
              <span className="text-xs font-medium text-primary-foreground">Create Account</span>
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="text-center text-xs text-green-500"
            >
              ✓ Account Created!
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AnalyzeDemo({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="absolute inset-0 flex items-center justify-center bg-background/95 rounded-xl overflow-hidden"
        >
          <div className="w-full p-4 space-y-2">
            {/* Loading bars */}
            {[1, 2, 3].map((i) => (
              <motion.div
                key={i}
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ delay: i * 0.15, duration: 0.5 }}
                className="h-2 bg-primary/20 rounded-full overflow-hidden"
              >
                <motion.div
                  initial={{ x: "-100%" }}
                  animate={{ x: "100%" }}
                  transition={{ delay: i * 0.15, duration: 0.8, repeat: 1 }}
                  className="h-full w-1/3 bg-primary/50"
                />
              </motion.div>
            ))}
            
            {/* Edge signal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, type: "spring" }}
              className="mt-4 p-3 bg-primary/10 border border-primary/30 rounded-lg"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs">Edge Detected</span>
                <motion.span
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 0.5, repeat: 2 }}
                  className="text-lg font-bold text-primary"
                >
                  +3.2%
                </motion.span>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function WinDemo({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="absolute inset-0 flex items-center justify-center bg-background/95 rounded-xl"
        >
          <div className="w-full p-4 space-y-3">
            {/* Bet slip */}
            <motion.div
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="p-2 bg-green-500/10 border border-green-500/30 rounded-lg"
            >
              <div className="flex justify-between text-xs">
                <span>Your Trade</span>
                <span className="text-green-500 font-bold">+61 coins</span>
              </div>
            </motion.div>
            
            {/* Leaderboard */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-1"
            >
              {[
                { rank: 12, name: "...", change: "" },
                { rank: 11, name: "You", change: "↑", isUser: true },
                { rank: 10, name: "...", change: "" },
              ].map((r, i) => (
                <motion.div
                  key={i}
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className={`flex items-center justify-between text-xs p-1.5 rounded ${
                    r.isUser ? "bg-primary/10 border border-primary/30" : ""
                  }`}
                >
                  <span className={r.isUser ? "text-primary font-medium" : "text-muted-foreground"}>
                    #{r.rank} {r.name}
                  </span>
                  {r.change && (
                    <motion.span
                      animate={{ y: [-2, 0] }}
                      transition={{ repeat: 2, duration: 0.3 }}
                      className="text-green-500"
                    >
                      {r.change}
                    </motion.span>
                  )}
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function HowItWorksDemo() {
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const playDemo = () => {
    setIsPlaying(true);
    setActiveStep(1);
  };

  useEffect(() => {
    if (!isPlaying || activeStep === null) return;

    const timer = setTimeout(() => {
      if (activeStep < 3) {
        setActiveStep(activeStep + 1);
      } else {
        setIsPlaying(false);
        setActiveStep(null);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [activeStep, isPlaying]);

  const getDemoComponent = (id: number, active: boolean) => {
    switch (id) {
      case 1: return <SignUpDemo active={active} />;
      case 2: return <AnalyzeDemo active={active} />;
      case 3: return <WinDemo active={active} />;
      default: return null;
    }
  };

  return (
    <div className="space-y-8">
      {/* Steps grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {STEPS.map((step, i) => (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            onClick={() => !isPlaying && setActiveStep(activeStep === step.id ? null : step.id)}
            className="cursor-pointer"
          >
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={`relative h-64 p-6 rounded-2xl border transition-all ${
                activeStep === step.id
                  ? "bg-card border-primary/50 shadow-lg shadow-primary/10"
                  : "bg-card/50 border-border/50 hover:border-primary/30"
              }`}
            >
              {/* Step number */}
              <motion.div
                animate={activeStep === step.id ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 0.5 }}
                className={`absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  activeStep === step.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {step.id}
              </motion.div>

              {/* Default state */}
              <div className={`transition-opacity ${activeStep === step.id ? "opacity-0" : "opacity-100"}`}>
                <div className="p-3 bg-primary/10 rounded-xl w-fit mb-4">
                  <step.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
                <p className="text-xs text-primary mt-4">Click to preview →</p>
              </div>

              {/* Demo overlay */}
              {getDemoComponent(step.id, activeStep === step.id)}
            </motion.div>
          </motion.div>
        ))}
      </div>

      {/* Watch Demo button */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        className="flex justify-center gap-4"
      >
        <motion.button
          onClick={playDemo}
          disabled={isPlaying}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary/10 border border-primary/30 rounded-xl text-primary font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          {isPlaying ? (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              >
                <RotateCcw className="w-5 h-5" />
              </motion.div>
              Playing Demo...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Watch 10-Second Demo
            </>
          )}
        </motion.button>
      </motion.div>
    </div>
  );
}
