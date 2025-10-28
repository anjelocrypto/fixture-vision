import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRODUCTS = [
  {
    name: "Premium Monthly",
    description: "Full access to analytics and tools - billed monthly",
    plan: "premium_monthly",
    price: 20_00, // $20 USD
    currency: "usd",
    interval: "month" as const,
  },
  {
    name: "Day Pass",
    description: "24-hour access to all features",
    plan: "day_pass",
    price: 10_00, // 10 GEL
    currency: "gel",
    interval: null, // one-time payment
  },
  {
    name: "Annual Plan",
    description: "Full access to analytics and tools - save 2 months (499 GEL/year)",
    plan: "annual",
    price: 499_00, // 499 GEL
    currency: "gel",
    interval: "year" as const,
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const productIds: Record<string, string> = {};
    const priceIds: Record<string, string> = {};

    for (const prod of PRODUCTS) {
      // Search for existing product
      const existingProducts = await stripe.products.search({
        query: `active:'true' AND metadata['plan']:'${prod.plan}'`,
      });

      let product;
      if (existingProducts.data.length > 0) {
        product = existingProducts.data[0];
        console.log(`[bootstrap] Found existing product: ${prod.plan}`);
      } else {
        // Create product
        product = await stripe.products.create({
          name: prod.name,
          description: prod.description,
          metadata: { app: "bet-ai", plan: prod.plan },
        });
        console.log(`[bootstrap] Created product: ${prod.plan}`);
      }
      productIds[prod.plan] = product.id;

      // Search for existing price
      const existingPrices = await stripe.prices.search({
        query: `active:'true' AND product:'${product.id}'`,
      });

      let price;
      if (existingPrices.data.length > 0) {
        price = existingPrices.data[0];
        console.log(`[bootstrap] Found existing price: ${prod.plan}`);
      } else {
        // Create price
        const priceData: any = {
          product: product.id,
          unit_amount: prod.price,
          currency: prod.currency,
          metadata: { app: "bet-ai", plan: prod.plan },
        };

        if (prod.interval) {
          priceData.recurring = { interval: prod.interval };
        }

        price = await stripe.prices.create(priceData);
        console.log(`[bootstrap] Created price: ${prod.plan}`);
      }
      priceIds[prod.plan] = price.id;
    }

    return new Response(
      JSON.stringify({ productIds, priceIds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[bootstrap] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
