import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getPlanConfig } from "../_shared/stripe_plans.ts";
import { resolveStripeCustomerId } from "../_shared/stripe_customer.ts";
import { readJsonWithLimit, RequestBodyTooLargeError } from "../_shared/request.ts";

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
      body = await readJsonWithLimit(req, 8 * 1024);
    } catch (error) {
      const tooLarge = error instanceof RequestBodyTooLargeError;
      return new Response(
        JSON.stringify({ error: tooLarge ? "request_too_large" : "bad_request" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: tooLarge ? 413 : 400 }
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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Prefer the durable Supabase mapping. Email-only lookup is limited to a
    // single unclaimed legacy customer so one user can never claim another's.
    let customerId = await resolveStripeCustomerId({
      stripe,
      supabase: supabaseAdmin,
      user,
      allowLegacyEmailRecovery: true,
    });

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      console.log(`[checkout] Created customer ${customerId} for user ${user.id}`);
    }

    // === DUPLICATE SUBSCRIPTION PREVENTION ===
    // Check for existing active/trialing/past_due subscriptions BEFORE creating new checkout
    // This prevents users from accidentally purchasing multiple subscriptions
    const mode = (plan === 'day_pass' || plan === 'test_pass') ? 'payment' : 'subscription';
    
    if (mode === 'subscription') {
      const existingSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all', // Get all to check active, trialing, past_due
        limit: 10,
      });

      // Filter for active recurring subscriptions (not day passes which are one-time)
      const activeRecurringSubs = existingSubs.data.filter((sub: Stripe.Subscription) => 
        ['active', 'trialing', 'past_due'].includes(sub.status)
      );

      if (activeRecurringSubs.length > 0) {
        console.log(`[checkout] Existing recurring subscription blocked a duplicate checkout for user ${user.id}`);
        
        return new Response(
          JSON.stringify({ 
            error: "already_subscribed", 
            detail: "You already have an active subscription. Please manage your existing subscription via the billing portal.",
            action: "billing_portal"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
    }

    // Reuse an unfinished session for this exact plan. If the latest matching
    // session is expired/complete, its ID becomes the deterministic seed for
    // the next attempt. Concurrent requests therefore converge on one Stripe
    // idempotency key without trapping a user on an expired daily session.
    const recentSessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 25,
    });
    const matchingSessions = recentSessions.data.filter((checkoutSession: Stripe.Checkout.Session) =>
      checkoutSession.metadata?.user_id === user.id
      && checkoutSession.metadata?.plan === plan
      && checkoutSession.mode === mode
    );
    const reusableSession = matchingSessions.find((checkoutSession: Stripe.Checkout.Session) =>
      checkoutSession.status === "open" && typeof checkoutSession.url === "string"
    );
    if (reusableSession?.url) {
      return new Response(
        JSON.stringify({ url: reusableSession.url, reused: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const priorAttempt = matchingSessions[0]?.id ?? "initial";
    const idempotencyKey = `checkout_${user.id}:${planConfig.priceId}:after_${priorAttempt}`;

    // Create checkout session with idempotency key
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      client_reference_id: user.id,
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      mode,
      payment_method_types: ["card"],
      success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing?checkout=cancel`,
      metadata: { user_id: user.id, plan },
    };
    
    let session;
    try {
      session = await stripe.checkout.sessions.create(
        sessionParams,
        { idempotencyKey } // Prevents duplicate sessions from rapid clicks
      );
    } catch (err: any) {
      // If idempotency error, it means session was already created - try to retrieve it
      if (err?.code === 'idempotency_key_in_use' || err?.type === 'idempotency_error') {
        console.log(`[checkout] Idempotency conflict - session already created for key: ${idempotencyKey}`);
        // Return a friendly message rather than error
        return new Response(
          JSON.stringify({ 
            error: "session_in_progress", 
            detail: "A checkout session is already in progress. Please complete or cancel the existing checkout."
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      
      console.error("[checkout] Stripe create session failed", err);
      return new Response(
        JSON.stringify({ error: "stripe_session_create_failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(`[checkout] Session created for ${planConfig.name}`);

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[checkout] Error", error);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
