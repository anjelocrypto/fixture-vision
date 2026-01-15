import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, Mail, ArrowRight, Shield, ChevronRight, 
  Play, Rocket, ArrowDown, Zap, Clock, Globe
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion, useScroll, useTransform, useSpring, useInView } from "framer-motion";
import heroBackground from "@/assets/hero-background.png";
import ticketLogo from "@/assets/ticket-logo.png";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LiveMarketDemo,
  OddsTickerDemo,
  FeatureDemoCards,
  TerminalDashboardDemo,
  AnalyticsFeatureTiles,
  EngineFlowAnimation,
  ComparisonTable,
  HowItWorksDemo,
  TrustBlock,
} from "@/components/landing";

// Animated Counter Component
function AnimatedCounter({ value, suffix = "", duration = 2 }: { value: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  
  useEffect(() => {
    if (!isInView) return;
    
    let start = 0;
    const end = value;
    const incrementTime = (duration * 1000) / end;
    
    const timer = setInterval(() => {
      start += 1;
      setCount(start);
      if (start >= end) clearInterval(timer);
    }, incrementTime);
    
    return () => clearInterval(timer);
  }, [isInView, value, duration]);
  
  return <span ref={ref}>{count}{suffix}</span>;
}

// Subtle Floating Dots
function FloatingDots() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(15)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-primary/20 rounded-full"
          initial={{
            x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000),
            y: Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 800),
          }}
          animate={{
            y: [null, -15, 15, 0],
            opacity: [0.1, 0.4, 0.1],
          }}
          transition={{
            duration: 10 + Math.random() * 10,
            repeat: Infinity,
            delay: Math.random() * 5,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// Minimal Gradient Background
function GradientBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <motion.div 
        className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[150px]"
        animate={{ 
          scale: [1, 1.1, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div 
        className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[150px]"
        animate={{ 
          scale: [1.1, 1, 1.1],
          opacity: [0.2, 0.4, 0.2],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation(['common']);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isSignUp, setIsSignUp] = useState(true);
  const [showEmailVerificationDialog, setShowEmailVerificationDialog] = useState(false);
  const [user, setUser] = useState<any>(null);
  
  // Parallax scroll refs
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  
  // Smooth parallax values
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });
  const heroY = useTransform(smoothProgress, [0, 0.3], [0, -100]);
  const heroOpacity = useTransform(smoothProgress, [0, 0.15], [1, 0]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        navigate("/");
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser(session.user);
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!acceptedTerms) {
      toast({
        title: t('common:terms_required'),
        description: t('common:terms_accept_message'),
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (error) throw error;

      toast({
        title: t('common:success'),
        description: t('common:signup_success'),
      });
      
      navigate("/");
    } catch (error: any) {
      toast({
        title: t('common:signup_failed'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast({
        title: t('common:welcome_back'),
        description: t('common:success_signed_in'),
      });

      navigate("/");
    } catch (error: any) {
      const isEmailNotConfirmed = error.message?.toLowerCase().includes('email not confirmed');
      
      if (isEmailNotConfirmed) {
        setShowEmailVerificationDialog(true);
      } else {
        toast({
          title: t('common:signin_failed'),
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const stats = [
    { value: 100, suffix: "+", label: "Leagues", icon: Globe },
    { value: 48, suffix: "h", label: "Window", icon: Clock },
    { value: 24, suffix: "/7", label: "Updates", icon: Zap },
  ];

  return (
    <>
      <AlertDialog open={showEmailVerificationDialog} onOpenChange={setShowEmailVerificationDialog}>
        <AlertDialogContent className="bg-card/95 backdrop-blur-xl border-primary/20">
          <AlertDialogHeader>
            <div className="flex items-center justify-center mb-4">
              <motion.div 
                className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Mail className="h-8 w-8 text-primary" />
              </motion.div>
            </div>
            <AlertDialogTitle className="text-center text-2xl">
              Verify Your Email
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-base">
              Please check your inbox and click the verification link we sent you to activate your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="w-full">OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div ref={containerRef} className="min-h-screen bg-background overflow-x-hidden">
        {/* Fixed Navigation */}
        <motion.nav 
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          transition={{ type: "spring", stiffness: 100 }}
          className="fixed top-0 left-0 right-0 z-50 px-4 lg:px-8 py-3"
        >
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between bg-background/60 backdrop-blur-2xl border border-border/30 rounded-2xl px-6 py-3">
              {/* Logo */}
              <Link to="/" className="flex items-center gap-3 group">
                <motion.div
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.5 }}
                  className="relative"
                >
                  <img src={ticketLogo} alt="Ticket" className="h-10 w-10 object-contain" />
                </motion.div>
                <div className="flex flex-col">
                  <span className="text-lg font-black text-foreground tracking-tight">TICKET AI</span>
                  <span className="text-[10px] text-primary font-semibold tracking-widest">BETA 1.0</span>
                </div>
              </Link>
              
              {/* Center Navigation */}
              <div className="hidden md:flex items-center gap-1">
                {[
                  { label: "Markets", href: "#marketplace" },
                  { label: "Analytics", href: "#analytics" },
                  { label: "Pricing", to: "/pricing" },
                ].map((item) => (
                  item.to ? (
                    <Link
                      key={item.label}
                      to={item.to}
                      className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-primary/5 rounded-xl transition-all duration-300"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <a
                      key={item.label}
                      href={item.href}
                      className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-primary/5 rounded-xl transition-all duration-300"
                    >
                      {item.label}
                    </a>
                  )
                ))}
              </div>

              {/* CTA Buttons */}
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost"
                  size="sm"
                  className="hidden sm:flex text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setIsSignUp(false);
                    document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Sign In
                </Button>
                <Button 
                  size="sm"
                  className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-6"
                  onClick={() => {
                    setIsSignUp(true);
                    document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Get Started
                </Button>
              </div>
            </div>
          </div>
        </motion.nav>

        {/* Hero Section */}
        <section className="relative min-h-screen flex items-center justify-center pt-24 overflow-hidden">
          <GradientBackground />
          <FloatingDots />
          
          {/* Background Image */}
          <motion.div 
            style={{ y: heroY }}
            className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30"
          >
            <div 
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${heroBackground})` }}
            />
          </motion.div>
          
          {/* Gradient Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-transparent to-background/60" />
          
          <motion.div 
            style={{ opacity: heroOpacity }}
            className="relative z-10 w-full px-6 lg:px-16"
          >
            <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center min-h-[80vh]">
              {/* Left: Hero Content */}
              <motion.div 
                initial={{ opacity: 0, x: -50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="space-y-8 text-center lg:text-left flex flex-col items-center lg:items-start"
              >
                {/* Badge */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20"
                >
                  <span className="text-sm font-medium text-primary">The Bloomberg Terminal for Sports</span>
                </motion.div>

                {/* Main Heading */}
                <div className="space-y-2">
                  <motion.h1 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.8 }}
                    className="text-4xl sm:text-5xl lg:text-7xl font-black text-foreground leading-[0.95] tracking-tight"
                  >
                    Where Your
                  </motion.h1>
                  <motion.h1 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4, duration: 0.8 }}
                    className="text-4xl sm:text-5xl lg:text-7xl font-black leading-[0.95] tracking-tight"
                  >
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">
                      Winning
                    </span>
                  </motion.h1>
                  <motion.h1 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5, duration: 0.8 }}
                    className="text-4xl sm:text-5xl lg:text-7xl font-black text-foreground leading-[0.95] tracking-tight"
                  >
                    Starts
                  </motion.h1>
                </div>

                {/* Subtitle */}
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="text-base sm:text-lg text-muted-foreground max-w-lg"
                >
                  AI-powered sports analytics and prediction markets. 
                  Real-time odds across 100+ leagues.
                </motion.p>

                {/* CTA Buttons */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 }}
                  className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 w-full sm:w-auto"
                >
                  <Button 
                    size="lg" 
                    className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base font-semibold w-full sm:w-auto"
                    onClick={() => document.getElementById('register-email')?.focus()}
                  >
                    Start Winning
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                  <Button 
                    size="lg" 
                    variant="outline"
                    className="rounded-full px-8 py-6 text-base font-semibold border-border/50 hover:bg-primary/5 w-full sm:w-auto"
                    onClick={() => navigate('/demo')}
                  >
                    <Play className="mr-2 h-5 w-5" />
                    Demo
                  </Button>
                </motion.div>

                {/* Stats Row */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="flex items-center justify-center lg:justify-start gap-6 sm:gap-8 pt-4 w-full"
                >
                  {stats.map((stat, i) => (
                    <div key={stat.label} className="text-center">
                      <p className="text-xl sm:text-2xl font-bold text-foreground">
                        <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                      </p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </motion.div>
              </motion.div>

              {/* Right: Auth Form */}
              <motion.div 
                id="auth-section"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="relative"
              >
                {/* Auth Card */}
                <div className="relative bg-card/60 backdrop-blur-xl border border-border/30 rounded-3xl p-8 lg:p-10">
                  <div className="space-y-6">
                    {/* Header */}
                    <div className="text-center space-y-2">
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.5, type: "spring" }}
                        className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4"
                      >
                        <Rocket className="h-7 w-7 text-primary" />
                      </motion.div>
                      <h2 className="text-2xl font-bold text-foreground">
                        {isSignUp ? "Create Account" : "Welcome Back"}
                      </h2>
                      <p className="text-muted-foreground text-sm">
                        {isSignUp ? "Start your winning journey" : "Sign in to continue"}
                      </p>
                    </div>

                    {/* Form */}
                    <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="register-email" className="text-foreground text-sm">Email</Label>
                        <div className="relative">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="register-email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            className="bg-background/50 border-border/30 rounded-xl h-12 pl-11 text-sm"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="password" className="text-foreground text-sm">Password</Label>
                          {!isSignUp && (
                            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                              Forgot?
                            </Link>
                          )}
                        </div>
                        <div className="relative">
                          <Shield className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                            minLength={6}
                            className="bg-background/50 border-border/30 rounded-xl h-12 pl-11 text-sm"
                          />
                        </div>
                      </div>

                      {isSignUp && (
                        <div className="flex items-start space-x-3 p-3 bg-background/30 rounded-xl border border-border/20">
                          <Checkbox 
                            id="terms" 
                            checked={acceptedTerms}
                            onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                            disabled={loading}
                            className="mt-0.5"
                          />
                          <label htmlFor="terms" className="text-xs text-muted-foreground leading-tight">
                            I agree to the{" "}
                            <Link to="/legal/terms" className="text-primary hover:underline" target="_blank">Terms</Link>
                            {" "}and{" "}
                            <Link to="/legal/privacy" className="text-primary hover:underline" target="_blank">Privacy</Link>
                          </label>
                        </div>
                      )}

                      <Button 
                        type="submit" 
                        className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" 
                        disabled={loading || (isSignUp && !acceptedTerms)}
                      >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isSignUp ? "Create Account" : "Sign In"}
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    </form>

                    {/* Toggle */}
                    <div className="text-center pt-2">
                      <button 
                        type="button"
                        onClick={() => setIsSignUp(!isSignUp)}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isSignUp ? "Have an account? " : "No account? "}
                        <span className="text-primary font-medium">{isSignUp ? "Sign In" : "Sign Up"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Scroll Indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2"
            >
              <motion.div
                animate={{ y: [0, 8, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="flex flex-col items-center gap-2 text-muted-foreground"
              >
                <ArrowDown className="h-4 w-4" />
              </motion.div>
            </motion.div>
          </motion.div>
        </section>

        {/* ========== PREDICTION MARKETPLACE SECTION ========== */}
        <section id="marketplace" className="py-32 relative">
          <GradientBackground />
          
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            {/* Section Header */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="mb-20"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="h-px flex-1 max-w-[60px] bg-gradient-to-r from-primary/50 to-transparent" />
                <span className="text-xs font-semibold text-primary tracking-widest uppercase">
                  Prediction Markets
                </span>
              </div>
              
              <div className="grid lg:grid-cols-2 gap-12 items-start">
                <div>
                  <h2 className="text-4xl md:text-5xl font-black text-foreground mb-6 leading-tight">
                    Trade on What
                    <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">
                      You Know
                    </span>
                  </h2>
                  <p className="text-lg text-muted-foreground mb-8 max-w-lg">
                    Our prediction marketplace lets you bet on match outcomes using virtual Ticket Coins. 
                    Test your sports knowledge, compete on leaderboards, and experience trading without risk.
                  </p>
                  
                  <TrustBlock />
                </div>

                {/* Live Market Demo Widget */}
                <LiveMarketDemo />
              </div>
            </motion.div>

            {/* Live Odds Ticker */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mb-20"
            >
              <OddsTickerDemo />
            </motion.div>

            {/* Feature Demo Cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mb-16"
            >
              <FeatureDemoCards />
            </motion.div>

            {/* CTA to Markets */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <Button 
                size="lg"
                className="rounded-full px-10 py-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold group"
                onClick={() => navigate('/markets')}
              >
                Explore Markets
                <motion.span
                  className="ml-2"
                  animate={{ x: [0, 4, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <ArrowRight className="h-5 w-5" />
                </motion.span>
              </Button>
            </motion.div>
          </div>
        </section>

        {/* ========== ANALYTICS ENGINE SECTION ========== */}
        <section id="analytics" className="py-32 relative bg-gradient-to-b from-transparent via-card/20 to-transparent">
          <div className="max-w-7xl mx-auto px-6">
            {/* Section Header */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="mb-16"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="h-px flex-1 max-w-[60px] bg-gradient-to-r from-primary/50 to-transparent" />
                <span className="text-xs font-semibold text-primary tracking-widest uppercase">
                  Analytics Engine
                </span>
              </div>
              
              <div className="max-w-2xl">
                <h2 className="text-4xl md:text-5xl font-black text-foreground mb-6 leading-tight">
                  Everything You Need
                  <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">
                    to Win
                  </span>
                </h2>
                <p className="text-lg text-muted-foreground">
                  Our complete suite of AI-powered tools gives you the analytical edge. 
                  From automated ticket generation to deep match analysis.
                </p>
              </div>
            </motion.div>

            {/* Terminal Dashboard Demo */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-20"
            >
              <TerminalDashboardDemo />
            </motion.div>

            {/* Analytics Feature Tiles */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mb-20"
            >
              <AnalyticsFeatureTiles />
            </motion.div>

            {/* Engine Flow Animation */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mb-20"
            >
              <EngineFlowAnimation />
            </motion.div>

            {/* Comparison Table */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              <ComparisonTable />
            </motion.div>
          </div>
        </section>

        {/* ========== HOW IT WORKS SECTION ========== */}
        <section className="py-32 relative">
          <GradientBackground />
          
          <div className="max-w-6xl mx-auto px-6">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl md:text-4xl font-black text-foreground mb-4">
                How It Works
              </h2>
              <p className="text-muted-foreground">Three simple steps to smarter predictions</p>
            </motion.div>

            <HowItWorksDemo />
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-24 relative">
          <div className="max-w-4xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-card/50 backdrop-blur-xl border border-border/30 rounded-3xl p-12 text-center relative overflow-hidden"
            >
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 opacity-50" />
              
              <div className="relative z-10">
                <h2 className="text-3xl md:text-4xl font-black text-foreground mb-4">
                  Ready to Start?
                </h2>
                <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
                  Join thousands making smarter betting decisions with Ticket AI.
                </p>
                
                <div className="flex flex-wrap justify-center gap-4">
                  <Button 
                    size="lg" 
                    className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-8 group"
                    onClick={() => {
                      setIsSignUp(true);
                      document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    Create Free Account
                    <motion.span
                      className="ml-2"
                      animate={{ x: [0, 4, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </motion.span>
                  </Button>
                  <Button 
                    size="lg"
                    variant="outline" 
                    className="rounded-full px-8 border-border/50 hover:bg-primary/5"
                    onClick={() => navigate('/pricing')}
                  >
                    View Pricing
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border/30 py-12 bg-card/10" style={{ paddingBottom: 'calc(3rem + var(--safe-area-bottom))' }}>
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-8">
              {/* Brand */}
              <Link to="/" className="flex items-center gap-3">
                <img src={ticketLogo} alt="Ticket" className="h-10 w-10 object-contain" />
                <div>
                  <span className="text-lg font-black text-foreground">TICKET AI</span>
                  <span className="text-xs text-primary font-semibold tracking-widest ml-2">BETA</span>
                </div>
              </Link>
              
              {/* Links */}
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
                <Link to="/demo" className="hover:text-foreground transition-colors">Demo</Link>
                <Link to="/legal/terms" className="hover:text-foreground transition-colors">Terms</Link>
                <Link to="/legal/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              </div>
            </div>
            
            <div className="border-t border-border/20 pt-6">
              <p className="text-xs text-muted-foreground text-center max-w-2xl mx-auto">
                <strong>No real money gambling.</strong> Ticket AI is a sports analytics platform. 
                Prediction Markets use virtual coins only — cannot be purchased or exchanged for cash.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
