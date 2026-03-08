import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAccess } from "@/hooks/useAccess";
import { useUsername } from "@/hooks/useUsername";
import {
  ArrowLeft, CreditCard, RefreshCw, Sparkles, Check, ChevronDown, ChevronUp,
  XCircle, AtSign, Loader2, X, AlertCircle, User, Crown, Zap, Shield
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const PLAN_NAMES: Record<string, string> = {
  day_pass: "Day Pass",
  monthly: "Premium Monthly",
  three_month: "3-Month Plan",
  annual: "Annual Plan",
};

const PLANS = [
  {
    id: "day_pass", name: "Day Pass", price: "$4.99", interval: "24-hour full access",
    description: "Perfect for testing our analytics tools",
    features: ["Ticket Creator", "Filterizer", "AI Analysis", "Winner Predictions", "Team Totals"],
  },
  {
    id: "monthly", name: "Premium Monthly", price: "$14.99", interval: "per month",
    description: "Best for regular users",
    features: ["Ticket Creator", "Filterizer", "AI Analysis", "Winner Predictions", "Team Totals"],
    recommended: true,
  },
  {
    id: "three_month", name: "3-Month Plan", price: "$34.99", interval: "per 3 months",
    description: "Great value for committed users",
    features: ["Ticket Creator", "Filterizer", "AI Analysis", "Winner Predictions", "Team Totals"],
  },
  {
    id: "annual", name: "Annual Plan", price: "$79.99", interval: "per year",
    description: "Best value for money",
    features: ["Ticket Creator", "Filterizer", "AI Analysis", "Winner Predictions", "Team Totals"],
  },
];

const PREMIUM_FEATURES = [
  { icon: Zap, label: "Ticket Creator" },
  { icon: Shield, label: "Filterizer" },
  { icon: Sparkles, label: "AI Analysis" },
  { icon: Crown, label: "Winner Predictions" },
  { icon: Check, label: "Team Totals" },
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
  const [cancelling, setCancelling] = useState(false);

  const {
    username: newUsername, isValid: newUsernameValid, isAvailable: newUsernameAvailable,
    isChecking: newUsernameChecking, error: newUsernameError, setUsername: setNewUsername,
    updateUsername, fetchCurrentUsername, canChange: canChangeUsername, hoursUntilChange,
  } = useUsername();

  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  useEffect(() => {
    const getUser = async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user);
      setSessionReady(true);
      if (session?.user) {
        const username = await fetchCurrentUsername();
        if (username) setCurrentUsername(username);
      }
    };
    getUser();
  }, [fetchCurrentUsername]);

  useEffect(() => {
    const checkoutStatus = searchParams.get("checkout");
    if (checkoutStatus === "success" && sessionReady) {
      toast({ title: "Payment Successful!", description: "Your premium access is now active. Welcome!", duration: 5000 });
      refreshAccess();
      window.history.replaceState({}, '', '/account');
    }
  }, [searchParams, sessionReady, toast, refreshAccess]);

  const handleManageBilling = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("billing-portal");
      if (error) throw error;
      const { openExternal } = await import("@/lib/openExternal");
      await openExternal(data.url);
      toast({ title: "Opening billing portal...", description: "Manage your subscription in the new tab" });
    } catch (error: any) {
      console.error("Portal error:", error);
      toast({ title: "Error", description: error.message || "Failed to open billing portal", variant: "destructive" });
    } finally { setLoading(false); }
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      await refreshAccess();
      toast({ title: "Status refreshed", description: "Your subscription status has been updated" });
    } catch (error: any) {
      console.error("Refresh error:", error);
      toast({ title: "Error", description: "Failed to refresh status", variant: "destructive" });
    } finally { setRefreshing(false); }
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke("cancel-subscription");
      if (error) throw error;
      toast({ title: "Subscription Cancelled", description: "Your subscription has been cancelled successfully." });
      await refreshAccess();
    } catch (error: any) {
      console.error("Cancel error:", error);
      toast({ title: "Error", description: error.message || "Failed to cancel subscription", variant: "destructive" });
    } finally { setCancelling(false); }
  };

  const handleSelectPlan = async (planId: string) => {
    setCheckoutLoading(planId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Authentication required", description: "Please log in to purchase a plan", variant: "destructive" });
        navigate("/auth");
        return;
      }
      const { data, error: fnError } = await supabase.functions.invoke("create-checkout-session", { body: { plan: planId } });
      if (fnError) {
        const detail = (fnError as any)?.context?.response?.data?.detail || (fnError as any)?.message || "Failed to create checkout session";
        throw new Error(detail);
      }
      if (!data?.url) {
        const detail = (data as any)?.error || "Checkout URL not returned";
        throw new Error(detail);
      }
      const { openExternal } = await import("@/lib/openExternal");
      await openExternal(data.url);
      toast({ title: "Opening checkout...", description: "Complete your purchase in the new tab" });
    } catch (error: any) {
      console.error("Checkout error:", error);
      toast({ title: "Checkout error", description: error?.message ?? "Please try again.", variant: "destructive" });
    } finally { setCheckoutLoading(null); }
  };

  const handleSaveUsername = async () => {
    if (!newUsernameValid || newUsernameAvailable !== true) {
      toast({ title: "Invalid Username", description: newUsernameError || "Please choose a valid username", variant: "destructive" });
      return;
    }
    setSavingUsername(true);
    const result = await updateUsername(newUsername);
    setSavingUsername(false);
    if (result.success) {
      setCurrentUsername(newUsername);
      setIsEditingUsername(false);
      setNewUsername("");
    } else {
      toast({ title: "Failed to update username", description: result.error, variant: "destructive" });
    }
  };

  const hasGeneratedUsername = currentUsername.startsWith("player_");

  if (accessLoading || !sessionReady) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading account details...</p>
        </div>
      </div>
    );
  }

  const UsernameStatus = () => {
    if (!newUsername) return null;
    if (newUsernameChecking) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (newUsernameValid && newUsernameAvailable === true) return <Check className="h-4 w-4 text-green-500" />;
    if (newUsernameError || newUsernameAvailable === false) return <X className="h-4 w-4 text-destructive" />;
    return null;
  };

  return (
    <div className="min-h-dvh bg-gradient-to-b from-background via-background to-muted/20 pb-24 lg:pb-0">
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 pt-4 lg:pt-8">
        {/* Header */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="mb-3 -ml-2 hover:bg-primary/10 h-9 text-sm"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to App
        </Button>

        <div className="mb-6">
          <h1 className="text-3xl lg:text-5xl font-bold mb-1 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Account
          </h1>
          <p className="text-muted-foreground text-sm lg:text-lg">
            Manage your profile and subscription
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-4 lg:gap-6">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Profile Section */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-muted/30">
                <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <h2 className="font-semibold text-base">Profile</h2>
              </div>

              <div className="p-4 space-y-2">
                {/* Username Row */}
                <div className="rounded-xl bg-muted/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Username</span>
                    {!isEditingUsername && (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm flex items-center gap-1">
                          <AtSign className="h-3.5 w-3.5 text-primary" />
                          {currentUsername}
                        </span>
                        {canChangeUsername ? (
                          <button
                            onClick={() => setIsEditingUsername(true)}
                            className="text-xs text-primary font-medium hover:underline active:scale-95 transition-transform"
                          >
                            Change
                          </button>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                            {hoursUntilChange}h
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {hasGeneratedUsername && !isEditingUsername && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-2.5 py-1.5 rounded-lg mt-2">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                      Pick your real username now!
                    </div>
                  )}

                  <AnimatePresence>
                    {isEditingUsername && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 space-y-2.5"
                      >
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                            <AtSign className="h-3.5 w-3.5" />
                          </div>
                          <Input
                            type="text"
                            placeholder="new_username"
                            value={newUsername}
                            onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                            className="pl-8 pr-9 h-9 text-sm"
                            maxLength={20}
                            disabled={savingUsername}
                          />
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <UsernameStatus />
                          </div>
                        </div>
                        {newUsernameError && <p className="text-[11px] text-destructive">{newUsernameError}</p>}
                        {newUsernameValid && newUsernameAvailable === true && (
                          <p className="text-[11px] text-green-500">✓ Username available</p>
                        )}
                        <p className="text-[11px] text-muted-foreground">3-20 chars · letters, numbers, underscore · once per 24h</p>
                        <div className="flex gap-2">
                          <Button size="sm" className="h-8 text-xs" onClick={handleSaveUsername} disabled={savingUsername || !newUsernameValid || newUsernameAvailable !== true}>
                            {savingUsername && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                            Save
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setIsEditingUsername(false); setNewUsername(""); }} disabled={savingUsername}>
                            Cancel
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Email Row */}
                <div className="rounded-xl bg-muted/40 p-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Email</span>
                  <span className="font-semibold text-sm truncate ml-4">{user?.email}</span>
                </div>

                {/* User ID Row */}
                <div className="rounded-xl bg-muted/40 p-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">User ID</span>
                  <span className="font-mono text-xs text-muted-foreground">{user?.id?.slice(0, 8)}…</span>
                </div>
              </div>
            </motion.section>

            {/* Subscription Status Section */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <h2 className="font-semibold text-base">Subscription</h2>
                </div>
                {hasAccess && (
                  <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] px-2">
                    Active
                  </Badge>
                )}
              </div>

              <div className="p-4">
                {entitlement ? (
                  <div className="space-y-2">
                    <div className="rounded-xl bg-primary/10 border border-primary/20 p-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Plan</span>
                      <span className="font-bold text-sm text-primary">{PLAN_NAMES[entitlement.plan] || entitlement.plan}</span>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Status</span>
                      <Badge
                        variant={entitlement.status === "active" ? "default" : entitlement.status === "past_due" ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        {entitlement.status === "active" ? "Active" : entitlement.status === "past_due" ? "Past Due" : entitlement.status}
                      </Badge>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                        {entitlement.plan === "day_pass" ? "Expires" : "Next billing"}
                      </span>
                      <span className="font-semibold text-sm">{format(new Date(entitlement.current_period_end), "PPP")}</span>
                    </div>
                    {entitlement.stripe_subscription_id && (
                      <div className="rounded-xl bg-muted/40 p-3 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Sub ID</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{entitlement.stripe_subscription_id.slice(0, 12)}…</span>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="pt-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRefreshStatus}
                          disabled={refreshing}
                          className="h-10 text-xs active:scale-[0.97] transition-transform"
                        >
                          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                          Refresh
                        </Button>
                        {entitlement?.stripe_subscription_id && (
                          <Button
                            size="sm"
                            onClick={handleManageBilling}
                            disabled={loading}
                            className="h-10 text-xs active:scale-[0.97] transition-transform"
                          >
                            <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                            Billing
                          </Button>
                        )}
                      </div>
                      
                      {entitlement?.stripe_subscription_id && (entitlement.status === "active" || entitlement.status === "past_due") && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="w-full h-9 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" disabled={cancelling}>
                              <XCircle className="mr-1.5 h-3.5 w-3.5" />
                              {cancelling ? "Cancelling..." : "Cancel Subscription"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will immediately cancel your subscription. You will lose access to premium features.
                                {entitlement.status === "past_due" && (
                                  <span className="block mt-2 font-medium text-destructive">
                                    Note: Your subscription is past due. Cancelling will resolve this and stop any future charges.
                                  </span>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
                              <AlertDialogAction onClick={handleCancelSubscription} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Yes, Cancel
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 px-4">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Sparkles className="h-7 w-7 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-1">No Active Subscription</h3>
                    <p className="text-muted-foreground text-sm mb-5">Unlock full access to all premium features</p>
                    <Button onClick={() => setShowPlans(!showPlans)} size="sm" className="gap-1.5 h-9 active:scale-[0.97] transition-transform">
                      {showPlans ? <><ChevronUp className="h-3.5 w-3.5" /> Hide Plans</> : <><ChevronDown className="h-3.5 w-3.5" /> View Plans</>}
                    </Button>
                  </div>
                )}
              </div>
            </motion.section>

            {/* Plans Section */}
            <AnimatePresence>
              {(showPlans || entitlement) && (
                <motion.section
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden"
                >
                  <button
                    onClick={() => setShowPlans(!showPlans)}
                    className="w-full flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30 active:bg-muted/50 transition-colors"
                  >
                    <div>
                      <h2 className="font-semibold text-base text-left">
                        {entitlement ? "Change Your Plan" : "Choose Your Plan"}
                      </h2>
                      <p className="text-xs text-muted-foreground text-left">
                        {entitlement ? "Upgrade or switch to a different plan" : "Select the perfect plan for your needs"}
                      </p>
                    </div>
                    {showPlans ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>

                  {(!entitlement || showPlans) && (
                    <div className="p-4">
                      <div className="grid grid-cols-2 lg:grid-cols-2 gap-3">
                        {PLANS.map((plan) => {
                          const isCurrent = entitlement?.plan === plan.id;
                          return (
                            <div
                              key={plan.id}
                              className={`relative rounded-xl border p-3 transition-all ${
                                plan.recommended && !isCurrent
                                  ? "border-primary/50 bg-primary/5 shadow-sm shadow-primary/10"
                                  : isCurrent
                                  ? "border-primary ring-1 ring-primary/40 bg-primary/5"
                                  : "border-border/60 bg-muted/20"
                              }`}
                            >
                              {plan.recommended && !isCurrent && (
                                <div className="absolute -top-2 left-3">
                                  <span className="bg-primary text-primary-foreground text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                    Best
                                  </span>
                                </div>
                              )}
                              {isCurrent && (
                                <div className="absolute -top-2 left-3">
                                  <span className="bg-primary text-primary-foreground text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                    Current
                                  </span>
                                </div>
                              )}
                              <div className="pt-1">
                                <h3 className="font-semibold text-sm leading-tight">{plan.name}</h3>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{plan.description}</p>
                                <div className="mt-2">
                                  <span className="text-xl font-bold">{plan.price}</span>
                                  <span className="text-[10px] text-muted-foreground ml-1">/{plan.interval.replace("per ", "")}</span>
                                </div>
                              </div>
                              <Button
                                className="w-full mt-3 h-8 text-xs active:scale-[0.97] transition-transform"
                                size="sm"
                                variant={plan.recommended || isCurrent ? "default" : "outline"}
                                onClick={() => handleSelectPlan(plan.id)}
                                disabled={checkoutLoading === plan.id || isCurrent}
                              >
                                {checkoutLoading === plan.id ? <Loader2 className="h-3 w-3 animate-spin" /> : isCurrent ? "Current" : "Get Started"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-center text-[10px] text-muted-foreground mt-4">
                        All plans include full access · Cancel anytime · Payments via Stripe
                      </p>
                    </div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column - Desktop only quick actions + Premium access */}
          <div className="hidden lg:block space-y-6">
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/30">
                <h2 className="font-semibold text-base">Quick Actions</h2>
              </div>
              <div className="p-4 space-y-2">
                <Button variant="outline" onClick={handleRefreshStatus} disabled={refreshing} className="w-full justify-start h-10 text-sm">
                  <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh Status
                </Button>
                {entitlement?.stripe_subscription_id && (
                  <Button variant="outline" onClick={handleManageBilling} disabled={loading} className="w-full justify-start h-10 text-sm">
                    <CreditCard className="mr-2 h-4 w-4" />
                    Manage Billing
                  </Button>
                )}
                {!entitlement && (
                  <Button onClick={() => setShowPlans(!showPlans)} className="w-full justify-start h-10 text-sm gap-2">
                    {showPlans ? <><ChevronUp className="h-4 w-4" /> Hide Plans</> : <><Sparkles className="h-4 w-4" /> View Plans</>}
                  </Button>
                )}
              </div>
            </div>

            {hasAccess && (
              <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 overflow-hidden">
                <div className="px-4 py-3 border-b border-primary/10">
                  <h2 className="font-semibold text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Premium Access
                  </h2>
                </div>
                <div className="p-4">
                  <ul className="space-y-2">
                    {PREMIUM_FEATURES.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <f.icon className="h-4 w-4 text-primary flex-shrink-0" />
                        {f.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Mobile Premium Access - shown inline */}
          {hasAccess && (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="lg:hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-primary/10 bg-primary/5">
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Premium Access
                </h2>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-2">
                  {PREMIUM_FEATURES.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm rounded-lg bg-background/50 px-3 py-2">
                      <f.icon className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      <span className="text-xs">{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </div>
      </div>
    </div>
  );
};

export default Account;
