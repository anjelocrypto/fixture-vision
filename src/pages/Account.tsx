import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAccess } from "@/hooks/useAccess";
import { ArrowLeft, CreditCard, RefreshCw, Sparkles } from "lucide-react";
import { format } from "date-fns";

const PLAN_NAMES: Record<string, string> = {
  day_pass: "Day Pass",
  premium_monthly: "Premium Monthly",
  annual: "Annual Plan",
};

const Account = () => {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasAccess, loading: accessLoading, entitlement, refreshAccess } = useAccess();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user);
    };
    getUser();
  }, []);

  // Show success message if redirected from checkout
  useEffect(() => {
    const checkoutStatus = searchParams.get("checkout");
    if (checkoutStatus === "success") {
      toast({
        title: "Welcome!",
        description: "Your subscription is now active",
      });
      // Refresh access status
      refreshAccess();
    }
  }, [searchParams]);

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

  if (accessLoading) {
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
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-8"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to App
        </Button>

        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2">Account</h1>
          <p className="text-muted-foreground">
            Manage your subscription and billing
          </p>
        </div>

        <div className="space-y-6">
          {/* User Info */}
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{user?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">User ID</span>
                  <span className="font-mono text-sm">{user?.id?.slice(0, 8)}...</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Subscription Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Subscription Status
              </CardTitle>
              <CardDescription>
                {hasAccess
                  ? "You have full access to all analytics tools"
                  : "No active subscription"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {entitlement ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Current Plan</span>
                    <span className="font-semibold">
                      {PLAN_NAMES[entitlement.plan] || entitlement.plan}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    {getStatusBadge(entitlement.status)}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {entitlement.plan === "day_pass" ? "Expires" : "Next billing date"}
                    </span>
                    <span className="font-medium">
                      {format(new Date(entitlement.current_period_end), "PPP p")}
                    </span>
                  </div>
                  {entitlement.stripe_subscription_id && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Subscription ID</span>
                      <span className="font-mono text-sm">
                        {entitlement.stripe_subscription_id.slice(0, 12)}...
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    You don't have an active subscription
                  </p>
                  <Button onClick={() => navigate("/pricing")}>
                    View Plans
                  </Button>
                </div>
              )}

              <div className="flex gap-2 pt-4">
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
            </CardContent>
          </Card>

          {/* Upgrade/Downgrade */}
          {entitlement && (
            <Card>
              <CardHeader>
                <CardTitle>Change Plan</CardTitle>
                <CardDescription>
                  Want to upgrade or try a different plan?
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={() => navigate("/pricing")}
                  className="w-full"
                >
                  View All Plans
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default Account;
