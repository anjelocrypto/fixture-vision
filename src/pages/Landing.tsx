import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, ArrowRight, Zap, Target, TrendingUp, Shield, ChevronRight, BarChart3, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
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
    // Check if user is already logged in
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

  const features = [
    {
      icon: BarChart3,
      title: "AI-Powered Analysis",
      description: "Advanced algorithms analyze thousands of data points to generate optimal betting selections.",
    },
    {
      icon: Target,
      title: "Smart Ticket Builder",
      description: "Create optimized multi-leg tickets with statistical edge across all major leagues.",
    },
    {
      icon: TrendingUp,
      title: "Real-Time Odds",
      description: "Live odds integration ensures you always get the best available prices.",
    },
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
              📧 Verify Your Email
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
        <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground">TICKET 1.0</span>
            </div>
            
            <div className="hidden md:flex items-center gap-8">
              <Link to="#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</Link>
              <Link to="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
              <Link to="#about" className="text-muted-foreground hover:text-foreground transition-colors">About</Link>
            </div>

            <Button 
              variant="outline" 
              className="rounded-full border-primary/30 hover:bg-primary/10"
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
        <section className="relative min-h-screen flex items-center pt-24 pb-12">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10" />
          
          {/* Floating decorative elements */}
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
          
          <div className="relative max-w-7xl mx-auto px-6 w-full">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              {/* Left Content */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="space-y-8"
              >
                {/* Social Proof */}
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div 
                        key={i} 
                        className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 border-2 border-background flex items-center justify-center text-xs font-medium text-primary"
                      >
                        {String.fromCharCode(64 + i)}
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="font-bold text-foreground">2,500+</p>
                    <p className="text-sm text-muted-foreground">active users</p>
                  </div>
                </div>

                {/* Main Headline */}
                <div className="space-y-4">
                  <h1 className="text-5xl md:text-7xl font-black text-foreground leading-none tracking-tight">
                    WHERE YOUR
                    <br />
                    <span className="text-primary animate-glow">WINNING</span>
                    <br />
                    STARTS
                  </h1>
                  <p className="text-lg text-muted-foreground max-w-lg">
                    AI-powered betting ticket creator. Generate optimized multi-leg tickets with statistical edge based on real-time data analysis.
                  </p>
                </div>

                {/* CTA Button */}
                <Button 
                  size="lg" 
                  className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg group"
                  onClick={() => document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Get Started Free
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>

                {/* Feature Pills */}
                <div className="flex flex-wrap gap-3">
                  <span className="px-4 py-2 rounded-full bg-secondary text-secondary-foreground text-sm flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    5 Free Analyses
                  </span>
                  <span className="px-4 py-2 rounded-full bg-secondary text-secondary-foreground text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    No Credit Card
                  </span>
                </div>
              </motion.div>

              {/* Right Content - Auth Form */}
              <motion.div 
                id="auth-section"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="relative"
              >
                {/* Feature Cards - Floating */}
                <div className="absolute -top-8 -left-8 hidden lg:block">
                  <div className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-4 shadow-xl max-w-[200px]">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
                        <BarChart3 className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-semibold text-sm">Live Stats</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Real-time match analysis</p>
                  </div>
                </div>

                <div className="absolute -bottom-4 -right-4 hidden lg:block">
                  <div className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-4 shadow-xl max-w-[200px]">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
                        <Target className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-semibold text-sm">Smart Picks</span>
                    </div>
                    <p className="text-xs text-muted-foreground">AI-optimized selections</p>
                  </div>
                </div>

                {/* Auth Card */}
                <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-8 shadow-2xl">
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
                        <Label htmlFor="email" className="text-foreground">Email</Label>
                        <Input
                          id="email"
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
              </motion.div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 relative">
          <div className="max-w-7xl mx-auto px-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
                Why Choose <span className="text-primary">Ticket AI?</span>
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Powered by advanced algorithms and real-time data to give you the edge.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="bg-card/50 backdrop-blur border border-border rounded-2xl p-8 hover:border-primary/30 transition-colors group"
                >
                  <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                    <feature.icon className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border py-12">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary-foreground" />
                </div>
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
          </div>
        </footer>
      </div>
    </>
  );
}