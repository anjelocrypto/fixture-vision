import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAccess } from "@/hooks/useAccess";
import { ArrowLeft, CreditCard, RefreshCw, Sparkles, Check, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

const PLAN_NAMES: Record<string, string> = {
  day_pass: "Day Pass",
  premium_monthly: "Premium Monthly",
  annual: "Annual Plan",
};

const PLANS = [
  {
    id: "day_pass",
    name: "Day Pass",
    price: "$4.99",
    interval: "24-hour full access",
    description: "Perfect for testing our analytics tools",
    features: [
      "Full access to Ticket Creator",
      "Full access to Filterizer",
      "Full access to Analyze",
      "Full access to Winner",
      "Full access to Team Totals",
    ],
  },
  {
    id: "premium_monthly",
    name: "Premium Monthly",
    price: "$14.99",
    interval: "per month",
    description: "Best for regular users",
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
    features: [
      "Full access to Ticket Creator",
      "Full access to Filterizer",
      "Full access to Analyze",
      "Full access to Winner",
      "Full access to Team Totals",
    ],
  },
];

const Account = () => {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasAccess, loading: accessLoading, entitlement, refreshAccess } = useAccess();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const getUser = async () => {
      // Wait for session to be fully restored
      await new Promise(resolve => setTimeout(resolve, 100));
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user);
      setSessionReady(true);
    };
    getUser();
  }, []);

  // Show success message if redirected from checkout
  useEffect(() => {
    const checkoutStatus = searchParams.get("checkout");
    if (checkoutStatus === "success" && sessionReady) {
      toast({
        title: "Payment Successful!",
        description: "Your premium access is now active. Welcome!",
        duration: 5000,
      });
      // Refresh access status
      refreshAccess();
      // Clear the checkout param from URL after showing message
      window.history.replaceState({}, '', '/account');
    }
  }, [searchParams, sessionReady, toast, refreshAccess]);

  const handleManageBilling = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("billing-portal");

      if (error) throw error;

      // Open in new tab
      window.open(data.url, "_blank");
      
      toast({
        title: "Opening billing portal...",
        description: "Manage your subscription in the new tab",
      });
    } catch (error: any) {
      console.error("Portal error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to open billing portal",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      await refreshAccess();
      toast({
        title: "Status refreshed",
        description: "Your subscription status has been updated",
      });
    } catch (error: any) {
      console.error("Refresh error:", error);
      toast({
        title: "Error",
        description: "Failed to refresh status",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSelectPlan = async (planId: string) => {
    setCheckoutLoading(planId);
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

      if (!data?.url) {
        const detail = (data as any)?.error || "Checkout URL not returned";
        throw new Error(detail);
      }

      window.open(data.url, "_blank");
      
      toast({
        title: "Opening checkout...",
        description: "Complete your purchase in the new tab",
      });
    } catch (error: any) {
      console.error("Checkout error:", error);
      toast({
        title: "Checkout error",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCheckoutLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      active: { label: "Active", variant: "default" },
      past_due: { label: "Past Due", variant: "destructive" },
      canceled: { label: "Canceled", variant: "secondary" },
      expired: { label: "Expired", variant: "secondary" },
    };

    const config = variants[status] || { label: status, variant: "secondary" };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (accessLoading || !sessionReady) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading account details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-6 hover:bg-primary/10"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to App
        </Button>

        <div className="mb-8">
          <h1 className="text-5xl font-bold mb-3 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Account
          </h1>
          <p className="text-muted-foreground text-lg">
            Manage your subscription and billing
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Column - User Info & Status */}
          <div className="lg:col-span-2 space-y-6">
            {/* User Info */}
            <Card className="border-primary/20 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  Profile
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <span className="text-muted-foreground font-medium">Email</span>
                    <span className="font-semibold">{user?.email}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <span className="text-muted-foreground font-medium">User ID</span>
                    <span className="font-mono text-sm">{user?.id?.slice(0, 8)}...</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Subscription Status */}
            <Card className="border-primary/20 shadow-lg">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Subscription Status
                  </CardTitle>
                  {hasAccess && (
                    <Badge variant="default" className="animate-pulse">
                      Active
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-base">
                  {hasAccess
                    ? "You have full access to all analytics tools"
                    : "No active subscription"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {entitlement ? (
                  <>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10">
                        <span className="text-muted-foreground font-medium">Current Plan</span>
                        <span className="font-bold text-primary">
                          {PLAN_NAMES[entitlement.plan] || entitlement.plan}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-muted-foreground font-medium">Status</span>
                        {getStatusBadge(entitlement.status)}
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <span className="text-muted-foreground font-medium">
                          {entitlement.plan === "day_pass" ? "Expires" : "Next billing date"}
                        </span>
                        <span className="font-semibold">
                          {format(new Date(entitlement.current_period_end), "PPP")}
                        </span>
                      </div>
                      {entitlement.stripe_subscription_id && (
                        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <span className="text-muted-foreground font-medium">Subscription ID</span>
                          <span className="font-mono text-xs">
                            {entitlement.stripe_subscription_id.slice(0, 12)}...
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 px-4">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">No Active Subscription</h3>
                    <p className="text-muted-foreground mb-6">
                      Unlock full access to all premium features
                    </p>
                    <Button 
                      onClick={() => setShowPlans(!showPlans)}
                      size="lg"
                      className="gap-2"
                    >
                      {showPlans ? (
                        <>
                          <ChevronUp className="h-4 w-4" />
                          Hide Plans
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          View Plans
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {entitlement && (
                  <div className="flex gap-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      onClick={handleRefreshStatus}
                      disabled={refreshing}
                      className="flex-1"
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                      Refresh Status
                    </Button>
                    {entitlement?.stripe_subscription_id && (
                      <Button
                        onClick={handleManageBilling}
                        disabled={loading}
                        className="flex-1"
                      >
                        <CreditCard className="mr-2 h-4 w-4" />
                        Manage Billing
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Plans Section */}
            <AnimatePresence>
              {(showPlans || entitlement) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className="border-primary/20 shadow-lg overflow-hidden">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>
                            {entitlement ? "Change Your Plan" : "Choose Your Plan"}
                          </CardTitle>
                          <CardDescription>
                            {entitlement 
                              ? "Upgrade or switch to a different plan"
                              : "Select the perfect plan for your needs"
                            }
                          </CardDescription>
                        </div>
                        {entitlement && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowPlans(!showPlans)}
                          >
                            {showPlans ? <ChevronUp /> : <ChevronDown />}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    {(!entitlement || showPlans) && (
                      <CardContent>
                        <div className="grid sm:grid-cols-2 gap-4">
                          {PLANS.map((plan) => (
                            <Card
                              key={plan.id}
                              className={`relative ${
                                plan.recommended
                                  ? "border-primary shadow-md"
                                  : "border-border"
                              } ${
                                entitlement?.plan === plan.id
                                  ? "ring-2 ring-primary"
                                  : ""
                              }`}
                            >
                              {plan.recommended && !entitlement && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                  <Badge className="bg-primary text-primary-foreground px-3 py-1">
                                    RECOMMENDED
                                  </Badge>
                                </div>
                              )}
                              {entitlement?.plan === plan.id && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                  <Badge variant="default" className="px-3 py-1">
                                    YOUR PLAN
                                  </Badge>
                                </div>
                              )}
                              <CardHeader className="text-center pt-6">
                                <CardTitle className="text-xl">{plan.name}</CardTitle>
                                <CardDescription className="text-xs">{plan.description}</CardDescription>
                                <div className="mt-4">
                                  <div className="text-3xl font-bold">{plan.price}</div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {plan.interval}
                                  </div>
                                </div>
                              </CardHeader>
                              <CardContent>
                                <Button
                                  className="w-full mb-4"
                                  size="sm"
                                  variant={plan.recommended || entitlement?.plan === plan.id ? "default" : "outline"}
                                  onClick={() => handleSelectPlan(plan.id)}
                                  disabled={checkoutLoading === plan.id || entitlement?.plan === plan.id}
                                >
                                  {checkoutLoading === plan.id 
                                    ? "Loading..." 
                                    : entitlement?.plan === plan.id
                                    ? "Current Plan"
                                    : "Get Started"}
                                </Button>
                                <ul className="space-y-2">
                                  {plan.features.slice(0, 3).map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-xs">
                                      <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                                      <span>{feature}</span>
                                    </li>
                                  ))}
                                </ul>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                        <p className="text-center text-xs text-muted-foreground mt-6">
                          All plans include full access. Cancel anytime. Payments via Stripe.
                        </p>
                      </CardContent>
                    )}
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column - Quick Actions */}
          <div className="space-y-6">
            <Card className="border-primary/20 shadow-lg">
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  onClick={handleRefreshStatus}
                  disabled={refreshing}
                  className="w-full justify-start"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh Status
                </Button>
                {entitlement?.stripe_subscription_id && (
                  <Button
                    variant="outline"
                    onClick={handleManageBilling}
                    disabled={loading}
                    className="w-full justify-start"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Manage Billing
                  </Button>
                )}
                {!entitlement && (
                  <Button
                    onClick={() => setShowPlans(!showPlans)}
                    className="w-full justify-start gap-2"
                  >
                    {showPlans ? (
                      <>
                        <ChevronUp className="h-4 w-4" />
                        Hide Plans
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        View Plans
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>

            {hasAccess && (
              <Card className="border-primary/20 shadow-lg bg-gradient-to-br from-primary/5 to-primary/10">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Premium Access
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Ticket Creator
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Filterizer
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      AI Analysis
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Winner Predictions
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Team Totals
                    </li>
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Account;
