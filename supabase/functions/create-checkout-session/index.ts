import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { STRIPE_PLANS, getPlanConfig } from "../_shared/stripe_plans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const appUrl = Deno.env.get("APP_URL");

    if (!stripeKey) {
      console.error("[checkout] Missing STRIPE_SECRET_KEY");
      return new Response(
        JSON.stringify({ error: "config_error", detail: "STRIPE_SECRET_KEY not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    if (!appUrl) {
      console.error("[checkout] Missing APP_URL");
      return new Response(
        JSON.stringify({ error: "config_error", detail: "APP_URL not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Authenticate user
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "unauthorized", detail: "No authorization header" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user?.email) {
      return new Response(
        JSON.stringify({ error: "unauthorized", detail: "Invalid session or missing email" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      return new Response(
        JSON.stringify({ error: "bad_request", detail: "Invalid JSON body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const plan = String(body?.plan || "");
    let planConfig;
    try {
      planConfig = getPlanConfig(plan);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "invalid_plan", detail: `Unsupported plan: ${plan}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(`[checkout] Creating session for ${planConfig.name}, user ${user.id}`);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check for existing Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId = customers.data[0]?.id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      console.log(`[checkout] Created customer ${customerId} for user ${user.id}`);
    }

    // Create checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      client_reference_id: user.id,
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      mode: planConfig.type === "payment" ? "payment" : "subscription",
      payment_method_types: ["card"],
      success_url: `${appUrl}/account?status=success`,
      cancel_url: `${appUrl}/pricing?status=cancelled`,
      metadata: { user_id: user.id, plan },
    };

    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (err: any) {
      console.error("[checkout] Stripe create session failed:", err?.message || err);
      return new Response(
        JSON.stringify({ error: "stripe_session_create_failed", detail: err?.message || "Unknown Stripe error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(`[checkout] Session created: ${session.id} for ${planConfig.name}`);

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[checkout] Error:", message);
    return new Response(
      JSON.stringify({ error: "internal_error", detail: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
