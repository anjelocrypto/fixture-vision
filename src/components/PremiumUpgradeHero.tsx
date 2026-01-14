import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { 
  Sparkles, 
  Zap, 
  BarChart3, 
  Target, 
  Trophy,
  Shield,
  ArrowRight,
  CheckCircle2,
  Crown
} from "lucide-react";
import { motion } from "framer-motion";

interface PremiumUpgradeHeroProps {
  onClose?: () => void;
}

export const PremiumUpgradeHero = ({ onClose }: PremiumUpgradeHeroProps) => {
  const navigate = useNavigate();

  const features = [
    {
      icon: Sparkles,
      title: "AI Ticket Creator",
      description: "Smart multi-leg tickets with edge detection",
    },
    {
      icon: BarChart3,
      title: "Filterizer Pro",
      description: "Advanced market filtering & analysis",
    },
    {
      icon: Target,
      title: "Team Totals",
      description: "Goal scoring probability insights",
    },
    {
      icon: Trophy,
      title: "Safe Zone",
      description: "High-probability match predictions",
    },
  ];

  const benefits = [
    "Unlimited match analysis",
    "Real-time odds comparison",
    "Performance tracking dashboard",
    "Priority data refresh",
  ];

  return (
    <div className="relative w-full min-h-[600px] flex items-center justify-center overflow-hidden">
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
      
      {/* Floating particles effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-primary/20"
            initial={{ 
              x: Math.random() * 100 + "%", 
              y: "100%",
              opacity: 0 
            }}
            animate={{ 
              y: "-10%",
              opacity: [0, 0.5, 0],
            }}
            transition={{
              duration: 8 + Math.random() * 4,
              repeat: Infinity,
              delay: i * 1.5,
              ease: "easeOut",
            }}
          />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-4xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          {/* Crown badge */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary mb-6"
          >
            <Crown className="h-4 w-4" />
            <span className="text-sm font-medium">Premium Access</span>
          </motion.div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            <span className="text-foreground">Unlock </span>
            <span className="bg-gradient-to-r from-primary via-emerald-400 to-primary bg-clip-text text-transparent">
              AI-Powered
            </span>
            <span className="text-foreground"> Betting</span>
          </h1>
          
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Get advanced analytics, AI-driven insights, and smart ticket creation tools trusted by thousands.
          </p>
        </motion.div>

        {/* Feature cards grid */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10"
        >
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4 + i * 0.1 }}
              className="group relative p-4 rounded-xl bg-card/50 border border-border/50 hover:border-primary/30 hover:bg-card/80 transition-all duration-300"
            >
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Benefits list */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex flex-wrap justify-center gap-4 mb-10"
        >
          {benefits.map((benefit, i) => (
            <motion.div
              key={benefit}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.7 + i * 0.1 }}
              className="flex items-center gap-2 text-sm"
            >
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">{benefit}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* CTA Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="flex flex-col items-center gap-4"
        >
          <Button
            size="lg"
            className="group h-14 px-8 text-lg font-semibold bg-gradient-to-r from-primary to-emerald-500 hover:from-primary/90 hover:to-emerald-500/90 shadow-lg shadow-primary/25"
            onClick={() => navigate("/pricing")}
          >
            <Zap className="h-5 w-5 mr-2" />
            Start Winning Today
            <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
          </Button>
          
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary/60" />
              <span>Cancel anytime</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground">From $4.99</span>
              <span>/day pass</span>
            </div>
          </div>
        </motion.div>

        {/* Social proof */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="mt-12 pt-8 border-t border-border/50"
        >
          <div className="flex flex-wrap justify-center gap-8 text-center">
            <div>
              <div className="text-2xl font-bold text-foreground">10K+</div>
              <div className="text-xs text-muted-foreground">Active Users</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">50K+</div>
              <div className="text-xs text-muted-foreground">Tickets Created</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">100+</div>
              <div className="text-xs text-muted-foreground">Leagues Covered</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
