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
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    if (!appUrl) throw new Error("APP_URL not configured");

    // Authenticate user
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user?.email) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const { plan } = await req.json();
    
    // Validate plan
    const planConfig = getPlanConfig(plan);
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
      client_reference_id: user.id,
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      mode: planConfig.type === "payment" ? "payment" : "subscription",
      success_url: `${appUrl}/account?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancel`,
      metadata: { user_id: user.id, plan },
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log(`[checkout] Session created: ${session.id} for ${planConfig.name}`);

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[checkout] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
