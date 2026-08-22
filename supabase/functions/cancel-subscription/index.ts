import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveStripeCustomerId } from "../_shared/stripe_customer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CANCEL-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customerId = await resolveStripeCustomerId({
      stripe,
      supabase: supabaseClient,
      user,
      allowLegacyEmailRecovery: true,
    });
    if (!customerId) {
      throw new Error("No Stripe customer found for this user");
    }
    logStep("Found Stripe customer mapping");

    // Find active or past_due subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 10,
    });

    const activeOrPastDue = subscriptions.data.filter(
      (sub: { status: string }) =>
        sub.status === "active" ||
        sub.status === "trialing" ||
        sub.status === "past_due"
    );

    if (activeOrPastDue.length === 0) {
      throw new Error("No active subscription found to cancel");
    }

    logStep("Found subscriptions to cancel at period end", { count: activeOrPastDue.length });

    // Use cancel_at_period_end instead of immediate cancellation
    // This allows users to keep access until their paid period ends
    const canceledSubs: Array<{ id: string; currentPeriodEnd: string }> = [];
    
    for (const sub of activeOrPastDue) {
      // Set cancel_at_period_end = true instead of immediate cancellation
      const updatedSub = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true
      });
      
      // Get the authoritative period end from Stripe's response
      const periodEnd = new Date(updatedSub.current_period_end * 1000).toISOString();
      canceledSubs.push({ id: sub.id, currentPeriodEnd: periodEnd });
      
      logStep("Set subscription to cancel at period end", { 
        subscriptionId: sub.id, 
        status: sub.status,
        currentPeriodEnd: periodEnd
      });

      // CRITICAL: Also sync DB with correct Stripe values immediately
      const { error: syncError } = await supabaseClient
        .from("user_entitlements")
        .update({
          cancel_at_period_end: true,
          canceled_at: new Date().toISOString(),
          current_period_end: periodEnd, // Sync from Stripe
          status: "active", // Keep active - they paid for this time
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (syncError) {
        logStep("Warning: Failed to sync entitlement in loop", { error: syncError.message });
      } else {
        logStep("Synced entitlement with Stripe values", { userId: user.id, periodEnd });
      }
    }

    // DB update already done in the loop above with correct Stripe values
    logStep("All entitlements synced during subscription updates");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Subscription will be cancelled at the end of your billing period. You'll keep access until then.",
        cancelledCount: activeOrPastDue.length,
        accessUntil: canceledSubs[0]?.currentPeriodEnd || null
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
