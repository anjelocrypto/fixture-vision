import { useState, useEffect } from "react";
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
  LineChart, Clock, Globe, CheckCircle2
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
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
      color: "from-primary/20 to-primary/5",
    },
    {
      icon: Filter,
      title: "Filterizer",
      description: "Advanced filtering system to find value bets across all markets. Filter by corners, goals, cards, and more with precision controls.",
      highlights: ["Multi-market filtering", "Real-time odds updates", "Value detection algorithm"],
      color: "from-emerald-500/20 to-emerald-500/5",
    },
    {
      icon: BarChart3,
      title: "Fixture Analyzer",
      description: "Deep statistical analysis for any match. Get comprehensive insights including head-to-head history, team form, and combined metrics.",
      highlights: ["Last 5 match stats", "H2H analysis", "Injury impact scoring"],
      color: "from-blue-500/20 to-blue-500/5",
    },
  ];

  const additionalFeatures = [
    {
      icon: Trophy,
      title: "Team Totals O1.5",
      description: "Find teams likely to score 2+ goals based on seasonal form and opponent weakness.",
      badge: "Premium",
    },
    {
      icon: Target,
      title: "Who Concedes/Scores",
      description: "League rankings showing which teams concede or score the most goals.",
      badge: "Analytics",
    },
    {
      icon: Swords,
      title: "Card Wars",
      description: "Track teams with highest card and foul counts for disciplinary markets.",
      badge: "Analytics",
    },
    {
      icon: Globe,
      title: "100+ Leagues",
      description: "Coverage across Premier League, La Liga, Bundesliga, Serie A, UEFA competitions, and more.",
      badge: "Global",
    },
    {
      icon: Clock,
      title: "48h Window",
      description: "Focus on upcoming fixtures within the next 48 hours for maximum accuracy.",
      badge: "Real-time",
    },
    {
      icon: Brain,
      title: "AI Analysis",
      description: "Gemini-powered match summaries with intelligent betting insights.",
      badge: "AI",
    },
  ];

  const stats = [
    { value: "100+", label: "Leagues Covered" },
    { value: "48h", label: "Prediction Window" },
    { value: "24/7", label: "Live Updates" },
  ];

  return (
    <>
      <AlertDialog open={showEmailVerificationDialog} onOpenChange={setShowEmailVerificationDialog}>
        <AlertDialogContent className="bg-card border-primary/20">
          <AlertDialogHeader>
            <div className="flex items-center justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="h-8 w-8 text-primary" />
              </div>
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

      <div className="min-h-screen bg-background overflow-hidden">
        {/* Navigation */}
        <nav className="fixed top-0 left-0 right-0 z-50 px-4 lg:px-8 py-3 bg-background/60 backdrop-blur-xl border-b border-border/30">
          <div className="flex items-center justify-between w-full">
            {/* Logo - Far Left */}
            <div className="flex items-center gap-2">
              <img src={ticketLogo} alt="Ticket" className="h-10 w-10 object-contain" />
              <span className="text-lg font-bold text-foreground tracking-tight">TICKET 1.0</span>
            </div>
            
            {/* Center Navigation */}
            <div className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
              <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
              <a href="#tools" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Tools</a>
            </div>

            {/* Sign In - Far Right */}
            <Button 
              variant="outline" 
              size="sm"
              className="rounded-full border-foreground/30 bg-foreground text-background hover:bg-foreground/90 px-5"
              onClick={() => {
                setIsSignUp(false);
                document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Sign In
            </Button>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="relative min-h-screen flex items-end pt-24 pb-12">
          {/* Background Image */}
          <div 
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${heroBackground})` }}
          />
          {/* Minimal Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent" />
          
          <div className="relative w-full px-8 lg:px-16">
            {/* Text Content - Absolute Bottom Left */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="absolute bottom-12 left-8 lg:left-16 space-y-5 z-10"
            >
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black text-foreground leading-[0.9] tracking-tight drop-shadow-2xl">
                WHERE YOUR
                <br />
                <span className="text-primary animate-glow">WINNING</span>
                <br />
                STARTS
              </h1>

              <Button 
                size="lg" 
                className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg font-semibold group shadow-xl shadow-primary/40"
                onClick={() => document.getElementById('register-email')?.focus()}
              >
                Register Now
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                className="rounded-full px-8 py-6 text-lg font-semibold border-foreground/30 hover:bg-foreground/10"
                onClick={() => navigate('/demo')}
              >
                Try Demo
              </Button>
            </motion.div>

            {/* Auth Form - Absolute Bottom Right */}
            <motion.div 
              id="auth-section"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="absolute bottom-12 right-8 lg:right-16 z-10"
            >
              {/* Enhanced Auth Card */}
              <div className="bg-background/60 backdrop-blur-xl border border-border/30 rounded-2xl p-6 lg:p-8 shadow-2xl w-[340px] lg:w-[380px]">
                  <div className="space-y-6">
                    <div className="text-center">
                      <h2 className="text-2xl font-bold text-foreground mb-2">
                        {isSignUp ? "Create Account" : "Welcome Back"}
                      </h2>
                      <p className="text-muted-foreground text-sm">
                        {isSignUp ? "Start your winning journey today" : "Sign in to continue"}
                      </p>
                    </div>

                    <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="register-email" className="text-foreground">Email</Label>
                        <Input
                          id="register-email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          disabled={loading}
                          className="bg-background/50 border-border rounded-xl h-12"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="password" className="text-foreground">Password</Label>
                          {!isSignUp && (
                            <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                              Forgot?
                            </Link>
                          )}
                        </div>
                        <Input
                          id="password"
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          disabled={loading}
                          minLength={6}
                          className="bg-background/50 border-border rounded-xl h-12"
                        />
                        {isSignUp && (
                          <p className="text-xs text-muted-foreground">Minimum 6 characters</p>
                        )}
                      </div>

                      {isSignUp && (
                        <div className="flex items-start space-x-3">
                          <Checkbox 
                            id="terms" 
                            checked={acceptedTerms}
                            onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                            disabled={loading}
                            className="mt-0.5"
                          />
                          <label htmlFor="terms" className="text-sm text-muted-foreground leading-tight">
                            I agree to the{" "}
                            <Link to="/legal/terms" className="text-primary hover:underline" target="_blank">
                              Terms
                            </Link>
                            {" "}and{" "}
                            <Link to="/legal/privacy" className="text-primary hover:underline" target="_blank">
                              Privacy Policy
                            </Link>
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

                    <div className="text-center">
                      <button 
                        type="button"
                        onClick={() => setIsSignUp(!isSignUp)}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isSignUp ? "Already have an account? " : "Don't have an account? "}
                        <span className="text-primary font-medium">{isSignUp ? "Sign In" : "Sign Up"}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Decorative elements behind auth card */}
                <div className="absolute -top-6 -left-6 w-24 h-24 bg-primary/20 rounded-2xl blur-xl z-0" />
                <div className="absolute -bottom-6 -right-6 w-32 h-32 bg-primary/10 rounded-2xl blur-xl z-0" />
              </motion.div>
          </div>
        </section>

        {/* Stats Bar */}
        <section className="py-12 border-y border-border bg-card/30">
          <div className="max-w-4xl mx-auto px-6">
            <div className="grid grid-cols-3 gap-8">
              {stats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className="text-center"
                >
                  <p className="text-3xl md:text-4xl font-bold text-primary">{stat.value}</p>
                  <p className="text-muted-foreground text-sm mt-1">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Main Features Section */}
        <section id="features" className="py-24 relative">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <span className="text-primary text-sm font-semibold tracking-wider uppercase">Powerful Tools</span>
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4 mt-2">
                Everything You Need to <span className="text-primary">Win</span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Our suite of AI-powered tools gives you the analytical edge you need to make smarter betting decisions.
              </p>
            </motion.div>

            <div className="grid lg:grid-cols-3 gap-8">
              {mainFeatures.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.15 }}
                  className="group"
                >
                  <div className={`bg-gradient-to-br ${feature.color} border border-border rounded-3xl p-8 h-full hover:border-primary/30 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5`}>
                    <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                      <feature.icon className="h-7 w-7 text-primary" />
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-3">{feature.title}</h3>
                    <p className="text-muted-foreground mb-6">{feature.description}</p>
                    <ul className="space-y-2">
                      {feature.highlights.map((highlight) => (
                        <li key={highlight} className="flex items-center gap-2 text-sm text-foreground">
                          <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                          {highlight}
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Additional Tools Section */}
        <section id="tools" className="py-24 bg-card/30 border-y border-border">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <span className="text-primary text-sm font-semibold tracking-wider uppercase">More Features</span>
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4 mt-2">
                Complete Analytics <span className="text-primary">Suite</span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Beyond our core tools, access a full range of analytics features designed for serious bettors.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {additionalFeatures.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className="bg-card border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <feature.icon className="h-6 w-6 text-primary" />
                    </div>
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary">
                      {feature.badge}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-24">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <span className="text-primary text-sm font-semibold tracking-wider uppercase">Simple Process</span>
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4 mt-2">
                How It <span className="text-primary">Works</span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                { step: "01", title: "Create Account", desc: "Sign up and start exploring our powerful betting analysis tools." },
                { step: "02", title: "Analyze Matches", desc: "Use our AI tools to analyze fixtures, filter value bets, and generate optimal tickets." },
                { step: "03", title: "Place Smart Bets", desc: "Make informed decisions backed by statistical analysis and real-time data." },
              ].map((item, index) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.15 }}
                  className="relative"
                >
                  <div className="text-7xl font-black text-primary/10 absolute -top-4 -left-2">{item.step}</div>
                  <div className="relative pt-8">
                    <h3 className="text-xl font-bold text-foreground mb-2">{item.title}</h3>
                    <p className="text-muted-foreground">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 bg-gradient-to-br from-primary/10 via-background to-primary/5">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
                Ready to Start <span className="text-primary">Winning?</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
                Join thousands of users who are making smarter betting decisions with Ticket AI.
              </p>
              <Button 
                size="lg" 
                className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-lg group"
                onClick={() => {
                  setIsSignUp(true);
                  document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                Create Free Account
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </motion.div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border py-12" style={{ paddingBottom: 'calc(3rem + var(--safe-area-bottom))' }}>
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2">
                <img src={ticketLogo} alt="Ticket" className="h-8 w-8 object-contain" />
                <span className="font-bold text-foreground">TICKET 1.0 BETA</span>
              </div>

              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <Link to="/legal/terms" className="hover:text-foreground transition-colors">Terms</Link>
                <Link to="/legal/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
                <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
              </div>

              <p className="text-sm text-muted-foreground">
                © 2025 Ticket AI. All rights reserved.
              </p>
            </div>
            
            {/* Store Compliance Disclaimer */}
            <div className="mt-8 pt-6 border-t border-border/50 text-center">
              <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
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