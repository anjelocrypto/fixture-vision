/**
 * Restore Purchase
 * 
 * User-facing endpoint that checks Stripe for their active subscription
 * and repairs user_entitlements if webhook failed.
 * 
 * ACCESS: Authenticated users only
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_THREE_MONTH,
  STRIPE_PRICE_YEARLY,
} from "../_shared/stripePrices.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOG = "[restore-purchase]";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user?.email) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Find customer by email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ restored: false, reason: "no_stripe_customer" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customerId = customers.data[0].id;

    // Check for active subscriptions
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    if (subs.data.length === 0) {
      return new Response(JSON.stringify({ restored: false, reason: "no_active_subscription" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sub = subs.data[0];
    const priceId = sub.items.data[0]?.price?.id;
    let plan = "monthly";
    if (priceId === STRIPE_PRICE_THREE_MONTH) plan = "three_month";
    else if (priceId === STRIPE_PRICE_YEARLY) plan = "annual";

    const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

    // Check current entitlement
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: existing } = await supabase
      .from("user_entitlements")
      .select("plan, status, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    const alreadyCorrect =
      existing?.status === "active" &&
      existing?.plan === plan &&
      existing?.current_period_end &&
      new Date(existing.current_period_end) >= new Date();

    if (alreadyCorrect) {
      return new Response(JSON.stringify({ restored: false, reason: "already_active" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fix the entitlement
    const { error } = await supabase.from("user_entitlements").upsert({
      user_id: user.id,
      plan,
      status: "active",
      current_period_end: periodEnd,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      source: "restore_purchase",
    });

    if (error) {
      console.error(`${LOG} Failed to restore:`, error);
      return new Response(JSON.stringify({ error: "Failed to restore" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`${LOG} ✅ Restored access for user ${user.id} (${plan}, until ${periodEnd})`);

    // Alert for monitoring
    await supabase.from("pipeline_alerts").insert({
      alert_type: "purchase_restored",
      severity: "info",
      message: `User ${user.id} restored purchase (${plan})`,
      details: { user_id: user.id, plan, subscription_id: sub.id, previous: existing },
    });

    return new Response(
      JSON.stringify({ restored: true, plan, current_period_end: periodEnd }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`${LOG} Error:`, error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
