import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const logStep = (step: string, details?: unknown) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [EXTEND-SUBSCRIPTIONS] ${step}`, details ? JSON.stringify(details) : "");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    // Auth: require x-cron-key or admin role
    const cronKeyHeader = req.headers.get("x-cron-key");
    const { data: dbKey } = await supabase.rpc("get_cron_internal_key");
    
    const authHeader = req.headers.get("Authorization");
    let isAdmin = false;
    
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user) {
        const { data: adminCheck } = await supabase.rpc("has_role", {
          _user_id: userData.user.id,
          _role: "admin"
        });
        isAdmin = !!adminCheck;
      }
    }

    if (cronKeyHeader !== dbKey && !isAdmin) {
      logStep("Auth failed - not admin or valid cron key");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    logStep("Auth passed");

    // Parse request body for optional dry_run mode
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
    } catch {
      // No body or invalid JSON, proceed with actual execution
    }

    logStep("Mode", { dryRun });

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    // Fetch November 2025 subscribers (those with current_period_end between Dec 18-31, 2025)
    // These are the ones who subscribed in November and are due for renewal
    const { data: subscribers, error: subError } = await supabase
      .from("user_entitlements")
      .select("user_id, stripe_subscription_id, plan, status, current_period_end")
      .not("stripe_subscription_id", "is", null)
      .in("plan", ["monthly", "three_month", "annual"])
      .eq("status", "active")
      .gte("current_period_end", "2025-12-18T00:00:00Z")
      .lte("current_period_end", "2025-12-31T23:59:59Z");

    if (subError) {
      throw new Error(`Failed to fetch subscribers: ${subError.message}`);
    }

    logStep("Found subscribers", { count: subscribers?.length || 0 });

    if (!subscribers || subscribers.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "No eligible subscribers found",
        extended: 0,
        failed: 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { 
      extended: string[]; 
      failed: { subscription_id: string; error: string }[];
      details: { subscription_id: string; old_date: string; new_date: string }[];
    } = {
      extended: [],
      failed: [],
      details: []
    };

    // Process each subscriber
    for (const sub of subscribers) {
      const subscriptionId = sub.stripe_subscription_id;
      
      try {
        // Fetch current subscription from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        
        if (subscription.status !== "active") {
          logStep("Skipping inactive subscription", { subscriptionId, status: subscription.status });
          continue;
        }

        // Calculate new trial_end = current_period_end + 7 days
        const currentPeriodEnd = subscription.current_period_end;
        const newTrialEnd = currentPeriodEnd + (7 * 24 * 60 * 60); // +7 days in seconds

        const oldDate = new Date(currentPeriodEnd * 1000).toISOString();
        const newDate = new Date(newTrialEnd * 1000).toISOString();

        logStep("Processing subscription", { 
          subscriptionId, 
          currentPeriodEnd: oldDate,
          newTrialEnd: newDate,
          dryRun
        });

        if (!dryRun) {
          // Apply the extension by setting trial_end
          await stripe.subscriptions.update(subscriptionId, {
            trial_end: newTrialEnd,
            proration_behavior: "none",
          });
          
          logStep("Extended subscription", { subscriptionId, newTrialEnd: newDate });
        }

        results.extended.push(subscriptionId);
        results.details.push({
          subscription_id: subscriptionId,
          old_date: oldDate,
          new_date: newDate
        });

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logStep("Failed to extend subscription", { subscriptionId, error: errorMessage });
        results.failed.push({ subscription_id: subscriptionId, error: errorMessage });
      }
    }

    logStep("Completed", { 
      extended: results.extended.length, 
      failed: results.failed.length,
      dryRun
    });

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      message: dryRun 
        ? `Dry run complete. Would extend ${results.extended.length} subscriptions.`
        : `Extended ${results.extended.length} subscriptions by 1 week.`,
      extended: results.extended.length,
      failed: results.failed.length,
      details: results.details,
      failures: results.failed
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
