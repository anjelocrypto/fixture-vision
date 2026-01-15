import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, Mail, ArrowRight, Zap, Target, TrendingUp, Shield, ChevronRight, 
  BarChart3, Sparkles, Filter, Ticket, Trophy, Swords, Users, Brain, 
  LineChart, Clock, Globe, CheckCircle2, Play, Star, Rocket, ArrowDown
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

// Floating Particles Component
function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(30)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-primary/30 rounded-full"
          initial={{
            x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000),
            y: Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 800),
          }}
          animate={{
            y: [null, -20, 20, -10, 0],
            x: [null, -10, 10, -5, 0],
            opacity: [0.2, 0.8, 0.4, 0.9, 0.2],
            scale: [1, 1.5, 1, 1.2, 1],
          }}
          transition={{
            duration: 8 + Math.random() * 8,
            repeat: Infinity,
            delay: Math.random() * 5,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// Glowing Orbs Background
function GlowingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <motion.div 
        className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/20 rounded-full blur-[120px]"
        animate={{ 
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
          x: [0, 30, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div 
        className="absolute bottom-1/4 -right-32 w-96 h-96 bg-primary/15 rounded-full blur-[120px]"
        animate={{ 
          scale: [1.2, 1, 1.2],
          opacity: [0.2, 0.4, 0.2],
          x: [0, -30, 0],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px]"
        animate={{ 
          scale: [1, 1.1, 1],
          opacity: [0.1, 0.2, 0.1],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

// Animated Grid Lines
function AnimatedGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--primary)/0.03)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--primary)/0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.08)_0%,transparent_50%)]"
        animate={{
          scale: [1, 1.5, 1],
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
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
  const heroY = useTransform(smoothProgress, [0, 0.3], [0, -150]);
  const heroOpacity = useTransform(smoothProgress, [0, 0.2], [1, 0]);
  const statsY = useTransform(smoothProgress, [0.1, 0.3], [100, 0]);
  const featuresY = useTransform(smoothProgress, [0.2, 0.4], [80, 0]);

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

  const mainFeatures = [
    {
      icon: Ticket,
      title: "AI Ticket Creator",
      description: "Generate optimized multi-leg betting tickets automatically. Our AI analyzes thousands of fixtures to find the best combinations within your target odds range.",
      highlights: ["Auto-generate 5-15 leg tickets", "Custom odds targeting", "Statistical edge detection"],
      gradient: "from-primary via-primary/80 to-emerald-400",
    },
    {
      icon: Filter,
      title: "Filterizer",
      description: "Advanced filtering system to find value bets across all markets. Filter by corners, goals, cards, and more with precision controls.",
      highlights: ["Multi-market filtering", "Real-time odds updates", "Value detection algorithm"],
      gradient: "from-emerald-400 via-teal-400 to-cyan-400",
    },
    {
      icon: BarChart3,
      title: "Fixture Analyzer",
      description: "Deep statistical analysis for any match. Get comprehensive insights including head-to-head history, team form, and combined metrics.",
      highlights: ["Last 5 match stats", "H2H analysis", "Injury impact scoring"],
      gradient: "from-cyan-400 via-blue-400 to-primary",
    },
  ];

  const additionalFeatures = [
    { icon: Trophy, title: "Team Totals O1.5", description: "Find teams likely to score 2+ goals based on seasonal form and opponent weakness.", badge: "Premium" },
    { icon: Target, title: "Who Concedes/Scores", description: "League rankings showing which teams concede or score the most goals.", badge: "Analytics" },
    { icon: Swords, title: "Card Wars", description: "Track teams with highest card and foul counts for disciplinary markets.", badge: "Analytics" },
    { icon: Globe, title: "100+ Leagues", description: "Coverage across Premier League, La Liga, Bundesliga, Serie A, UEFA competitions, and more.", badge: "Global" },
    { icon: Clock, title: "48h Window", description: "Focus on upcoming fixtures within the next 48 hours for maximum accuracy.", badge: "Real-time" },
    { icon: Brain, title: "AI Analysis", description: "Gemini-powered match summaries with intelligent betting insights.", badge: "AI" },
  ];

  const stats = [
    { value: 100, suffix: "+", label: "Leagues Covered", icon: Globe },
    { value: 48, suffix: "h", label: "Prediction Window", icon: Clock },
    { value: 24, suffix: "/7", label: "Live Updates", icon: Zap },
    { value: 15, suffix: "K+", label: "Active Users", icon: Users },
  ];

  const testimonials = [
    { name: "Alex M.", role: "Professional Bettor", text: "The AI Ticket Creator transformed my strategy. Best ROI I've had in years.", rating: 5 },
    { name: "Sarah K.", role: "Sports Analyst", text: "Finally, a platform that combines data science with real betting insights.", rating: 5 },
    { name: "Mike T.", role: "Daily User", text: "Filterizer alone is worth the subscription. Saves me hours of research.", rating: 5 },
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
        {/* Fixed Navigation with Glassmorphism */}
        <motion.nav 
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          transition={{ type: "spring", stiffness: 100 }}
          className="fixed top-0 left-0 right-0 z-50 px-4 lg:px-8 py-3"
        >
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between bg-background/40 backdrop-blur-2xl border border-border/50 rounded-2xl px-6 py-3 shadow-2xl shadow-black/20">
              {/* Logo */}
              <Link to="/" className="flex items-center gap-3 group">
                <motion.div
                  whileHover={{ rotate: 360 }}
                  transition={{ duration: 0.5 }}
                  className="relative"
                >
                  <img src={ticketLogo} alt="Ticket" className="h-10 w-10 object-contain" />
                  <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl group-hover:bg-primary/40 transition-colors" />
                </motion.div>
                <div className="flex flex-col">
                  <span className="text-lg font-black text-foreground tracking-tight">TICKET AI</span>
                  <span className="text-[10px] text-primary font-semibold tracking-widest">BETA 1.0</span>
                </div>
              </Link>
              
              {/* Center Navigation */}
              <div className="hidden md:flex items-center gap-1">
                {[
                  { label: "Features", href: "#features" },
                  { label: "Pricing", to: "/pricing" },
                  { label: "Tools", href: "#tools" },
                  { label: "Demo", to: "/demo" },
                ].map((item) => (
                  item.to ? (
                    <Link
                      key={item.label}
                      to={item.to}
                      className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-primary/10 rounded-xl transition-all duration-300"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <a
                      key={item.label}
                      href={item.href}
                      className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-primary/10 rounded-xl transition-all duration-300"
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
                  className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-6 shadow-lg shadow-primary/30 hover:shadow-primary/50 transition-all duration-300"
                  onClick={() => {
                    setIsSignUp(true);
                    document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Get Started
                  <Sparkles className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </motion.nav>

        {/* Hero Section with Parallax */}
        <section className="relative min-h-screen flex items-center justify-center pt-24 overflow-hidden">
          {/* Animated Background */}
          <GlowingOrbs />
          <AnimatedGrid />
          <FloatingParticles />
          
          {/* Background Image with Parallax */}
          <motion.div 
            style={{ y: heroY }}
            className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40"
          >
            <div 
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${heroBackground})` }}
            />
          </motion.div>
          
          {/* Gradient Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/80" />
          
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
                className="space-y-8"
              >
                {/* Badge */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 backdrop-blur-sm"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">AI-Powered Sports Analytics</span>
                </motion.div>

                {/* Main Heading with Gradient */}
                <div className="space-y-4">
                  <motion.h1 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.8 }}
                    className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-black text-foreground leading-[0.9] tracking-tighter"
                  >
                    WHERE YOUR
                  </motion.h1>
                  <motion.h1 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4, duration: 0.8 }}
                    className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-black leading-[0.9] tracking-tighter"
                  >
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-emerald-400 to-primary animate-glow">
                      WINNING
                    </span>
                  </motion.h1>
                  <motion.h1 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5, duration: 0.8 }}
                    className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-black text-foreground leading-[0.9] tracking-tighter"
                  >
                    STARTS
                  </motion.h1>
                </div>

                {/* Subtitle */}
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="text-lg lg:text-xl text-muted-foreground max-w-lg"
                >
                  The Bloomberg Terminal for sports betting. AI-powered analysis, 
                  real-time odds, and statistical edge detection across 100+ leagues.
                </motion.p>

                {/* CTA Buttons */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 }}
                  className="flex flex-wrap gap-4"
                >
                  <Button 
                    size="lg" 
                    className="group relative rounded-full bg-primary hover:bg-primary text-primary-foreground px-8 py-7 text-lg font-semibold overflow-hidden shadow-2xl shadow-primary/40"
                    onClick={() => document.getElementById('register-email')?.focus()}
                  >
                    <span className="relative z-10 flex items-center">
                      Start Winning
                      <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform" />
                    </span>
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-primary via-emerald-400 to-primary"
                      animate={{ x: ["-100%", "100%"] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      style={{ opacity: 0.3 }}
                    />
                  </Button>
                  <Button 
                    size="lg" 
                    variant="outline"
                    className="group rounded-full px-8 py-7 text-lg font-semibold border-border/50 bg-background/30 backdrop-blur-sm hover:bg-primary/10 hover:border-primary/50"
                    onClick={() => navigate('/demo')}
                  >
                    <Play className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                    Watch Demo
                  </Button>
                </motion.div>

                {/* Trust Badges */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="flex items-center gap-6 pt-4"
                >
                  <div className="flex -space-x-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 border-2 border-background flex items-center justify-center text-xs font-bold text-primary">
                        {String.fromCharCode(65 + i)}
                      </div>
                    ))}
                  </div>
                  <div className="text-sm">
                    <p className="text-foreground font-semibold">15,000+ Active Users</p>
                    <p className="text-muted-foreground">Join the winning community</p>
                  </div>
                </motion.div>
              </motion.div>

              {/* Right: Auth Form with Premium Styling */}
              <motion.div 
                id="auth-section"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="relative"
              >
                {/* Decorative Elements */}
                <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-primary/10 rounded-full blur-3xl" />
                
                {/* Auth Card */}
                <div className="relative bg-card/40 backdrop-blur-2xl border border-border/50 rounded-3xl p-8 lg:p-10 shadow-2xl shadow-black/30">
                  {/* Card Glow Effect */}
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/10 via-transparent to-transparent pointer-events-none" />
                  
                  <div className="relative space-y-6">
                    {/* Header */}
                    <div className="text-center space-y-2">
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.5, type: "spring" }}
                        className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 mb-4"
                      >
                        <Rocket className="h-8 w-8 text-primary" />
                      </motion.div>
                      <h2 className="text-2xl lg:text-3xl font-bold text-foreground">
                        {isSignUp ? "Create Account" : "Welcome Back"}
                      </h2>
                      <p className="text-muted-foreground">
                        {isSignUp ? "Start your winning journey today" : "Sign in to continue"}
                      </p>
                    </div>

                    {/* Form */}
                    <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor="register-email" className="text-foreground font-medium">Email</Label>
                        <div className="relative">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input
                            id="register-email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            className="bg-background/50 border-border/50 rounded-xl h-14 pl-12 text-base focus:border-primary/50 focus:ring-primary/20"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="password" className="text-foreground font-medium">Password</Label>
                          {!isSignUp && (
                            <Link to="/forgot-password" className="text-sm text-primary hover:text-primary/80 transition-colors">
                              Forgot?
                            </Link>
                          )}
                        </div>
                        <div className="relative">
                          <Shield className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                            minLength={6}
                            className="bg-background/50 border-border/50 rounded-xl h-14 pl-12 text-base focus:border-primary/50 focus:ring-primary/20"
                          />
                        </div>
                        {isSignUp && (
                          <p className="text-xs text-muted-foreground">Minimum 6 characters</p>
                        )}
                      </div>

                      {isSignUp && (
                        <div className="flex items-start space-x-3 p-4 bg-background/30 rounded-xl border border-border/30">
                          <Checkbox 
                            id="terms" 
                            checked={acceptedTerms}
                            onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                            disabled={loading}
                            className="mt-0.5"
                          />
                          <label htmlFor="terms" className="text-sm text-muted-foreground leading-tight">
                            I agree to the{" "}
                            <Link to="/legal/terms" className="text-primary hover:underline" target="_blank">Terms</Link>
                            {" "}and{" "}
                            <Link to="/legal/privacy" className="text-primary hover:underline" target="_blank">Privacy Policy</Link>
                          </label>
                        </div>
                      )}

                      <Button 
                        type="submit" 
                        className="w-full h-14 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-lg shadow-lg shadow-primary/30 hover:shadow-primary/50 transition-all duration-300" 
                        disabled={loading || (isSignUp && !acceptedTerms)}
                      >
                        {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                        {isSignUp ? "Create Account" : "Sign In"}
                        <ChevronRight className="ml-2 h-5 w-5" />
                      </Button>
                    </form>

                    {/* Divider */}
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border/50" />
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-4 bg-card/40 text-muted-foreground">or</span>
                      </div>
                    </div>

                    {/* Toggle */}
                    <div className="text-center">
                      <button 
                        type="button"
                        onClick={() => setIsSignUp(!isSignUp)}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isSignUp ? "Already have an account? " : "Don't have an account? "}
                        <span className="text-primary font-semibold hover:underline">{isSignUp ? "Sign In" : "Sign Up"}</span>
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
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="flex flex-col items-center gap-2 text-muted-foreground"
              >
                <span className="text-xs tracking-widest uppercase">Scroll to explore</span>
                <ArrowDown className="h-4 w-4" />
              </motion.div>
            </motion.div>
          </motion.div>
        </section>

        {/* Stats Section with Animated Counters */}
        <motion.section 
          style={{ y: statsY }}
          className="py-20 relative z-10"
        >
          <div className="max-w-6xl mx-auto px-6">
            <div className="bg-card/40 backdrop-blur-2xl border border-border/50 rounded-3xl p-8 md:p-12 shadow-2xl">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
                {stats.map((stat, index) => (
                  <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="text-center group"
                  >
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4 group-hover:scale-110 group-hover:bg-primary/20 transition-all duration-300">
                      <stat.icon className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">
                      <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                    </p>
                    <p className="text-muted-foreground text-sm mt-2">{stat.label}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </motion.section>

        {/* Main Features Section with 3D Cards */}
        <section id="features" className="py-32 relative">
          <GlowingOrbs />
          
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-20"
            >
              <motion.span 
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary text-sm font-semibold tracking-wider uppercase mb-6"
              >
                <Zap className="h-4 w-4" />
                Powerful Tools
              </motion.span>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black text-foreground mb-6">
                Everything You Need to{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-emerald-400 to-cyan-400">
                  Win
                </span>
              </h2>
              <p className="text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto">
                Our suite of AI-powered tools gives you the analytical edge you need to make smarter betting decisions.
              </p>
            </motion.div>

            <div className="grid lg:grid-cols-3 gap-8">
              {mainFeatures.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.15 }}
                  whileHover={{ y: -10, scale: 1.02 }}
                  className="group relative"
                >
                  {/* Card Glow */}
                  <div className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-20 blur-2xl transition-opacity duration-500`} />
                  
                  <div className="relative bg-card/60 backdrop-blur-xl border border-border/50 rounded-3xl p-8 lg:p-10 h-full hover:border-primary/50 transition-all duration-500 overflow-hidden">
                    {/* Top Gradient Line */}
                    <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                    
                    {/* Icon */}
                    <motion.div 
                      whileHover={{ rotate: 5, scale: 1.1 }}
                      className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} p-[2px] mb-8`}
                    >
                      <div className="w-full h-full rounded-2xl bg-card flex items-center justify-center">
                        <feature.icon className="h-7 w-7 text-primary" />
                      </div>
                    </motion.div>
                    
                    <h3 className="text-2xl lg:text-3xl font-bold text-foreground mb-4">{feature.title}</h3>
                    <p className="text-muted-foreground mb-8 leading-relaxed">{feature.description}</p>
                    
                    <ul className="space-y-3">
                      {feature.highlights.map((highlight, i) => (
                        <motion.li 
                          key={highlight} 
                          initial={{ opacity: 0, x: -10 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.3 + i * 0.1 }}
                          className="flex items-center gap-3 text-foreground"
                        >
                          <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${feature.gradient} flex items-center justify-center`}>
                            <CheckCircle2 className="h-4 w-4 text-background" />
                          </div>
                          {highlight}
                        </motion.li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Additional Tools Section */}
        <section id="tools" className="py-32 relative bg-gradient-to-b from-transparent via-card/30 to-transparent">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-20"
            >
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary text-sm font-semibold tracking-wider uppercase mb-6">
                <Target className="h-4 w-4" />
                More Features
              </span>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black text-foreground mb-6">
                Complete Analytics{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">
                  Suite
                </span>
              </h2>
              <p className="text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto">
                Beyond our core tools, access a full range of analytics features designed for serious bettors.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {additionalFeatures.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 30, scale: 0.95 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.08 }}
                  whileHover={{ y: -5 }}
                  className="group bg-card/50 backdrop-blur-xl border border-border/50 rounded-2xl p-6 hover:border-primary/50 hover:bg-card/70 transition-all duration-300"
                >
                  <div className="flex items-start justify-between mb-4">
                    <motion.div 
                      whileHover={{ rotate: -5, scale: 1.1 }}
                      className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center group-hover:border-primary/50 transition-colors"
                    >
                      <feature.icon className="h-6 w-6 text-primary" />
                    </motion.div>
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {feature.badge}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials Section */}
        <section className="py-32 relative">
          <GlowingOrbs />
          
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary text-sm font-semibold tracking-wider uppercase mb-6">
                <Star className="h-4 w-4" />
                Testimonials
              </span>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black text-foreground mb-6">
                Loved by{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">
                  Winners
                </span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {testimonials.map((testimonial, index) => (
                <motion.div
                  key={testimonial.name}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.15 }}
                  className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-3xl p-8 relative"
                >
                  {/* Quote mark */}
                  <div className="absolute -top-4 left-8 text-6xl text-primary/20 font-serif">"</div>
                  
                  <div className="flex gap-1 mb-4">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="h-5 w-5 fill-primary text-primary" />
                    ))}
                  </div>
                  <p className="text-foreground mb-6 leading-relaxed">{testimonial.text}</p>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 flex items-center justify-center text-lg font-bold text-primary">
                      {testimonial.name[0]}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{testimonial.name}</p>
                      <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-32 relative bg-gradient-to-b from-transparent via-card/30 to-transparent">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-20"
            >
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary text-sm font-semibold tracking-wider uppercase mb-6">
                <Rocket className="h-4 w-4" />
                Simple Process
              </span>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black text-foreground mb-6">
                How It{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">
                  Works
                </span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-12 relative">
              {/* Connecting Line */}
              <div className="hidden md:block absolute top-20 left-1/4 right-1/4 h-0.5 bg-gradient-to-r from-primary/50 via-primary to-primary/50" />
              
              {[
                { step: "01", title: "Create Account", desc: "Sign up and start exploring our powerful betting analysis tools.", icon: Users },
                { step: "02", title: "Analyze Matches", desc: "Use our AI tools to analyze fixtures, filter value bets, and generate optimal tickets.", icon: BarChart3 },
                { step: "03", title: "Place Smart Bets", desc: "Make informed decisions backed by statistical analysis and real-time data.", icon: Trophy },
              ].map((item, index) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.15 }}
                  className="relative text-center"
                >
                  {/* Step Number Circle */}
                  <motion.div 
                    whileHover={{ scale: 1.1 }}
                    className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-primary to-emerald-400 mb-8 shadow-2xl shadow-primary/40"
                  >
                    <span className="text-2xl font-black text-background">{item.step}</span>
                  </motion.div>
                  
                  <h3 className="text-2xl font-bold text-foreground mb-4">{item.title}</h3>
                  <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="py-32 relative overflow-hidden">
          {/* Background Effects */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-primary/10" />
          <GlowingOrbs />
          
          <div className="max-w-5xl mx-auto px-6 relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-card/60 backdrop-blur-2xl border border-border/50 rounded-[3rem] p-12 md:p-16 text-center shadow-2xl"
            >
              <motion.div
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true }}
                transition={{ type: "spring", delay: 0.2 }}
                className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-emerald-400 mb-8 shadow-2xl shadow-primary/40"
              >
                <Sparkles className="h-10 w-10 text-background" />
              </motion.div>
              
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-black text-foreground mb-6">
                Ready to Start{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-emerald-400 to-cyan-400">
                  Winning?
                </span>
              </h2>
              <p className="text-lg lg:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
                Join thousands of users who are making smarter betting decisions with Ticket AI.
              </p>
              
              <div className="flex flex-wrap justify-center gap-4">
                <Button 
                  size="lg" 
                  className="group rounded-full bg-primary hover:bg-primary text-primary-foreground px-10 py-7 text-lg font-semibold shadow-2xl shadow-primary/40 hover:shadow-primary/60 transition-all duration-300"
                  onClick={() => {
                    setIsSignUp(true);
                    document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Create Free Account
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform" />
                </Button>
                <Button 
                  size="lg"
                  variant="outline" 
                  className="rounded-full px-10 py-7 text-lg font-semibold border-border/50 hover:border-primary/50 hover:bg-primary/10"
                  onClick={() => navigate('/pricing')}
                >
                  View Pricing
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border/50 py-16 bg-card/20" style={{ paddingBottom: 'calc(4rem + var(--safe-area-bottom))' }}>
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid md:grid-cols-4 gap-12 mb-12">
              {/* Brand */}
              <div className="md:col-span-2">
                <Link to="/" className="flex items-center gap-3 mb-6">
                  <img src={ticketLogo} alt="Ticket" className="h-12 w-12 object-contain" />
                  <div>
                    <span className="text-xl font-black text-foreground block">TICKET AI</span>
                    <span className="text-xs text-primary font-semibold tracking-widest">BETA 1.0</span>
                  </div>
                </Link>
                <p className="text-muted-foreground max-w-md leading-relaxed">
                  The Bloomberg Terminal for sports betting. AI-powered analysis, real-time odds, and statistical edge detection across 100+ leagues.
                </p>
              </div>
              
              {/* Links */}
              <div>
                <h4 className="font-bold text-foreground mb-4">Product</h4>
                <ul className="space-y-3 text-muted-foreground">
                  <li><a href="#features" className="hover:text-primary transition-colors">Features</a></li>
                  <li><Link to="/pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
                  <li><Link to="/demo" className="hover:text-primary transition-colors">Demo</Link></li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-bold text-foreground mb-4">Legal</h4>
                <ul className="space-y-3 text-muted-foreground">
                  <li><Link to="/legal/terms" className="hover:text-primary transition-colors">Terms of Service</Link></li>
                  <li><Link to="/legal/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
                </ul>
              </div>
            </div>
            
            <div className="border-t border-border/50 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                © 2025 Ticket AI. All rights reserved.
              </p>
            </div>
            
            {/* Store Compliance Disclaimer */}
            <div className="mt-8 pt-6 border-t border-border/30 text-center">
              <p className="text-xs text-muted-foreground max-w-3xl mx-auto leading-relaxed">
                <strong>No real money gambling.</strong> Ticket AI is a sports analytics platform. 
                Prediction Markets use virtual coins only — coins cannot be purchased or exchanged for cash. 
                For entertainment and educational purposes only.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
