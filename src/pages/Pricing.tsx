import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Check, ArrowLeft } from "lucide-react";

const PLANS = [
  {
    id: "day_pass",
    name: "Day Pass",
    price: "10 GEL",
    usdApprox: "~$3.70",
    interval: "24 hours access",
    description: "Perfect for testing our analytics tools",
    features: [
      "Full access to Ticket Creator",
      "Optimizer & Filterizer tools",
      "Gemini AI analysis",
      "My Ticket management",
      "24-hour access period",
    ],
  },
  {
    id: "premium_monthly",
    name: "Premium Monthly",
    price: "$20",
    interval: "per month",
    description: "Best for regular users",
    features: [
      "Full access to all tools",
      "Unlimited ticket creation",
      "Advanced analytics",
      "Priority support",
      "Cancel anytime",
    ],
    recommended: true,
  },
  {
    id: "annual",
    name: "Annual Plan",
    price: "499 GEL",
    usdApprox: "~$185/year",
    interval: "billed yearly",
    description: "Save 2 months with annual billing",
    badge: "2 MONTHS FREE",
    features: [
      "Everything in Monthly",
      "Save 2 months per year",
      "Best value for money",
      "Locked-in pricing",
      "Priority support",
    ],
  },
];

const Pricing = () => {
  const [loading, setLoading] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleSelectPlan = async (planId: string) => {
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

      if (!data?.url) {
        const detail = (data as any)?.error || "Checkout URL not returned";
        throw new Error(detail);
      }

      // Open in new tab
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
      setLoading(null);
    }
  };

// Show cancellation message if redirected
  const statusParam = searchParams.get("status") || searchParams.get("checkout");
  if (statusParam === "cancelled" || statusParam === "cancel") {
    toast({
      title: "Checkout canceled",
      description: "You can return anytime to complete your purchase",
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-8"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to App
        </Button>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Choose Your Plan</h1>
          <p className="text-muted-foreground text-lg">
            Unlock professional analytics and tools for informed decisions
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {PLANS.map((plan) => (
            <Card
              key={plan.id}
              className={`relative ${
                plan.recommended
                  ? "border-primary shadow-lg scale-105"
                  : ""
              }`}
            >
              {plan.recommended && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground px-4 py-1">
                    RECOMMENDED
                  </Badge>
                </div>
              )}
              {plan.badge && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="bg-secondary text-secondary-foreground px-4 py-1">
                    {plan.badge}
                  </Badge>
                </div>
              )}
              <CardHeader className="text-center pt-8">
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4">
                  <div className="text-4xl font-bold">{plan.price}</div>
                  {plan.usdApprox && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {plan.usdApprox}
                    </div>
                  )}
                  <div className="text-sm text-muted-foreground mt-2">
                    {plan.interval}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full mb-6"
                  size="lg"
                  variant={plan.recommended ? "default" : "outline"}
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={loading === plan.id}
                >
                  {loading === plan.id ? "Loading..." : "Get Started"}
                </Button>
                <ul className="space-y-3">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center mt-12 text-sm text-muted-foreground">
          <p>
            All plans include full access to our analytics tools. Cancel anytime.
          </p>
          <p className="mt-2">
            Secure payment processing powered by Stripe
          </p>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
