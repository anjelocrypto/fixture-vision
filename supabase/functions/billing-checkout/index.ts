import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  STRIPE_PRICE_DAY_PASS,
  STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_QUARTERLY,
  STRIPE_PRICE_YEARLY,
} from "../_shared/stripePrices.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[BILLING-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started", { method: req.method, url: req.url });

    // Verify Stripe secret key
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user?.email) {
      throw new Error("User not authenticated or email not available");
    }
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Find or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string;
    
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing Stripe customer", { customerId });
    } else {
      const newCustomer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = newCustomer.id;
      logStep("Created new Stripe customer", { customerId });
    }

    // Parse URL to determine route
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Success and cancel URLs using APP_URL env var
    const appUrl = Deno.env.get("APP_URL") || "https://ticketai.bet";
    const successUrl = `${appUrl}/account?checkout=success`;
    const cancelUrl = `${appUrl}/pricing?checkout=cancel`;

    // Handle subscription checkout
    if (pathname.endsWith("/create-subscription-session")) {
      const body = await req.json();
      const { priceId } = body;

      // Validate priceId
      const validPrices = [STRIPE_PRICE_MONTHLY, STRIPE_PRICE_QUARTERLY, STRIPE_PRICE_YEARLY];
      if (!priceId || !validPrices.includes(priceId)) {
        logStep("Invalid priceId", { priceId, validPrices });
        return new Response(
          JSON.stringify({ error: "Invalid priceId. Must be one of: monthly, quarterly, yearly" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      logStep("Creating subscription session", { priceId });

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        client_reference_id: user.id, // ✅ Pass user ID for webhook
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      logStep("Subscription session created", { sessionId: session.id, url: session.url });

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Handle day pass checkout
    if (pathname.endsWith("/create-daypass-session")) {
      logStep("Creating day pass session");

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        client_reference_id: user.id, // ✅ Pass user ID for webhook
        line_items: [
          {
            price: STRIPE_PRICE_DAY_PASS,
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      logStep("Day pass session created", { sessionId: session.id, url: session.url });

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Unknown route
    return new Response(
      JSON.stringify({ error: "Unknown route. Use /create-subscription-session or /create-daypass-session" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
