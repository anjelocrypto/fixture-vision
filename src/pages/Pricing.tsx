import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAccess } from "@/hooks/useAccess";
import { Check, ArrowLeft, Sparkles, Zap, Crown, Star, CreditCard } from "lucide-react";
import Footer from "@/components/Footer";
import { motion } from "framer-motion";

// IMPORTANT: Plan IDs must match backend keys (user_entitlements.plan)
// See memory: payments/plan-key-naming-convention
const PLANS = [
  {
    id: "day_pass",
    name: "Day Pass",
    price: "$4.99",
    interval: "24-hour full access",
    description: "Perfect for testing our analytics tools",
    icon: Zap,
    features: [
      "Full access to Ticket Creator",
      "Full access to Filterizer",
      "Full access to Analyze",
      "Full access to Winner",
      "Full access to Team Totals",
    ],
  },
  {
    id: "monthly", // Changed from "premium_monthly" to match DB
    name: "Premium Monthly",
    price: "$14.99",
    interval: "per month",
    description: "Best for regular users",
    icon: Star,
    features: [
      "Full access to Ticket Creator",
      "Full access to Filterizer",
      "Full access to Analyze",
      "Full access to Winner",
      "Full access to Team Totals",
    ],
    recommended: true,
  },
  {
    id: "three_month",
    name: "3-Month Plan",
    price: "$34.99",
    interval: "per 3 months",
    description: "Great value for committed users",
    icon: Sparkles,
    features: [
      "Full access to Ticket Creator",
      "Full access to Filterizer",
      "Full access to Analyze",
      "Full access to Winner",
      "Full access to Team Totals",
    ],
  },
  {
    id: "annual",
    name: "Annual Plan",
    price: "$79.99",
    interval: "per year",
    description: "Best value for money",
    icon: Crown,
    features: [
      "Full access to Ticket Creator",
      "Full access to Filterizer",
      "Full access to Analyze",
      "Full access to Winner",
      "Full access to Team Totals",
    ],
  },
];

const Pricing = () => {
  const [loading, setLoading] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasAccess, entitlement, loading: accessLoading } = useAccess();

  const handleSelectPlan = async (planId: string) => {
    // Global lock - disable all buttons while any checkout is in progress
    if (loading) return;
    
    setLoading(planId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Authentication required",
          description: "Please log in to purchase a plan",
          variant: "destructive",
        });
        navigate("/auth");
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke("create-checkout-session", {
        body: { plan: planId },
      });

      if (fnError) {
        const detail = (fnError as any)?.context?.response?.data?.detail || (fnError as any)?.message || "Failed to create checkout session";
        throw new Error(detail);
      }

      // Backend may return already_subscribed error
      if (data?.error === "already_subscribed") {
        toast({
          title: "Already Subscribed",
          description: "You already have an active subscription. Manage your billing instead.",
        });
        navigate("/account");
        return;
      }

      if (!data?.url) {
        const detail = (data as any)?.error || "Checkout URL not returned";
        throw new Error(detail);
      }

      window.location.href = data.url;
    } catch (error: any) {
      console.error("Checkout error:", error);
      toast({
        title: "Checkout error",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  };

  const handleManageBilling = async () => {
    setLoading("billing");
    try {
      const { data, error } = await supabase.functions.invoke("billing-portal");
      if (error) throw error;
      window.open(data.url, "_blank");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to open billing portal",
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  };

  const statusParam = searchParams.get("status") || searchParams.get("checkout");
  if (statusParam === "cancelled" || statusParam === "cancel") {
    toast({
      title: "Checkout canceled",
      description: "You can return anytime to complete your purchase",
    });
  }

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-primary/8 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="flex-1 relative z-10">
        <div className="container mx-auto px-4 py-12 max-w-7xl">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="mb-8 hover:bg-primary/10 transition-colors"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to App
            </Button>
          </motion.div>

          <motion.div 
            className="text-center mb-16"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text">
              Choose Your Plan
            </h1>
            <p className="text-muted-foreground text-xl max-w-2xl mx-auto">
              Unlock professional analytics and tools for informed decisions
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {PLANS.map((plan, index) => {
              const Icon = plan.icon;
              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  whileHover={{ y: -8, transition: { duration: 0.2 } }}
                  className="relative group"
                >
                  {/* Glow Effect for Recommended */}
                  {plan.recommended && (
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-primary via-primary/80 to-primary rounded-2xl blur opacity-30 group-hover:opacity-50 transition-opacity" />
                  )}
                  
                  <div
                    className={`relative h-full rounded-2xl border backdrop-blur-sm transition-all duration-300 ${
                      plan.recommended
                        ? "border-primary bg-card/80 shadow-2xl shadow-primary/20"
                        : "border-border/50 bg-card/50 hover:border-primary/50 hover:bg-card/70"
                    }`}
                  >
                    {plan.recommended && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                        <Badge className="bg-primary text-primary-foreground px-4 py-1.5 text-sm font-semibold shadow-lg shadow-primary/30">
                          RECOMMENDED
                        </Badge>
                      </div>
                    )}
                    
                    <div className="p-6 pt-8 text-center">
                      {/* Icon */}
                      <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4 ${
                        plan.recommended 
                          ? 'bg-primary/20 text-primary' 
                          : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                      } transition-colors`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      
                      <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                      <p className="text-muted-foreground text-sm mb-6">{plan.description}</p>
                      
                      {/* Price */}
                      <div className="mb-6">
                        <div className="text-5xl font-bold bg-gradient-to-br from-foreground to-foreground/80 bg-clip-text">
                          {plan.price}
                        </div>
                        <div className="text-sm text-muted-foreground mt-2">
                          {plan.interval}
                        </div>
                      </div>
                      
                      {/* CTA Button */}
                      {/* Show "Current Plan" / "Manage Billing" if user has this plan */}
                      {hasAccess && entitlement?.plan === plan.id ? (
                        <Button
                          className="w-full mb-6 h-12 text-base font-semibold bg-muted cursor-default"
                          size="lg"
                          disabled
                        >
                          Current Plan
                        </Button>
                      ) : hasAccess ? (
                        <Button
                          className={`w-full mb-6 h-12 text-base font-semibold transition-all duration-300 ${
                            plan.recommended 
                              ? "bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30" 
                              : "bg-muted hover:bg-primary hover:text-primary-foreground"
                          }`}
                          size="lg"
                          onClick={handleManageBilling}
                          disabled={loading !== null}
                        >
                          {loading === "billing" ? (
                            <span className="flex items-center gap-2">
                              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              Opening...
                            </span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <CreditCard className="w-4 h-4" />
                              Manage Billing
                            </span>
                          )}
                        </Button>
                      ) : (
                        <Button
                          className={`w-full mb-6 h-12 text-base font-semibold transition-all duration-300 ${
                            plan.recommended 
                              ? "bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40" 
                              : "bg-muted hover:bg-primary hover:text-primary-foreground"
                          }`}
                          size="lg"
                          onClick={() => handleSelectPlan(plan.id)}
                          disabled={loading !== null || accessLoading}
                        >
                          {loading === plan.id ? (
                            <span className="flex items-center gap-2">
                              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              Processing...
                            </span>
                          ) : (
                            "Get Started"
                          )}
                        </Button>
                      )}
                      
                      {/* Features */}
                      <ul className="space-y-3 text-left">
                        {plan.features.map((feature, idx) => (
                          <motion.li 
                            key={idx} 
                            className="flex items-start gap-3"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 + idx * 0.05 + 0.3 }}
                          >
                            <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
                              plan.recommended ? 'bg-primary/20' : 'bg-muted'
                            }`}>
                              <Check className={`h-3 w-3 ${plan.recommended ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <span className="text-sm text-muted-foreground">{feature}</span>
                          </motion.li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <motion.div 
            className="text-center mt-16"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <p className="text-muted-foreground">
              All paid plans include full access. Cancel anytime. Payments via Stripe.
            </p>
            <div className="flex items-center justify-center gap-6 mt-4 text-sm text-muted-foreground/70">
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                Secure checkout
              </span>
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                Instant access
              </span>
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                No hidden fees
              </span>
            </div>
          </motion.div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Pricing;
