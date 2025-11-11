import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { STRIPE_PLANS } from "../_shared/stripe_plans.ts";
import { 
  STRIPE_PRICE_DAY_PASS,
  STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_QUARTERLY,
  STRIPE_PRICE_YEARLY 
} from "../_shared/stripePrices.ts";

// Test pass price (for $0.01 testing)
const STRIPE_PRICE_TEST_PASS = "price_1SS8HTKAifASkGDzALgkgC6o";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Status mapping
const mapSubscriptionStatus = (stripeStatus: string): string => {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "expired";
  }
};

// Get plan name from price ID
const getPlanFromPriceId = (priceId: string): string => {
  for (const [planKey, config] of Object.entries(STRIPE_PLANS)) {
    if (config.priceId === priceId) {
      return planKey;
    }
  }
  return "unknown";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const signature = req.headers.get("stripe-signature");
    if (!signature) throw new Error("Missing stripe-signature header");

    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    console.log(`[webhook] Received event: ${event.type}, ID: ${event.id}`);

    // Use service role for DB writes
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Idempotency check
    const { data: existing } = await supabase
      .from("webhook_events")
      .select("event_id")
      .eq("event_id", event.id)
      .single();

    if (existing) {
      console.log(`[webhook] Event ${event.id} already processed, skipping`);
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Process event
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id || session.metadata?.user_id;
        if (!userId) {
          console.error("[webhook] ❌ CRITICAL: No user_id in checkout session", { 
            sessionId: session.id,
            customer: session.customer,
            mode: session.mode 
          });
          break;
        }
        console.log(`[webhook] Processing checkout for user ${userId}`);

        const customerId = session.customer as string;

        if (session.mode === "payment") {
          // Check if this is a day pass or test pass by price ID
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
          const priceId = lineItems.data[0]?.price?.id;
          
          if (priceId === STRIPE_PRICE_DAY_PASS || priceId === STRIPE_PRICE_TEST_PASS) {
            const planName = priceId === STRIPE_PRICE_TEST_PASS ? "test_pass" : "day_pass";
            const { error } = await supabase
              .from("user_entitlements")
              .upsert({
                user_id: userId,
                plan: planName,
                status: "active",
                current_period_end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                stripe_customer_id: customerId,
                stripe_subscription_id: null,
                source: "stripe",
              });

            if (error) console.error(`[webhook] Error upserting ${planName}:`, error);
            else console.log(`[webhook] ${planName} activated for user ${userId}`);
          }
        } else if (session.mode === "subscription") {
          // Fetch subscription details
          const subscriptionId = session.subscription as string;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price?.id;
          
          // Map price to plan
          let plan = "monthly";
          if (priceId === STRIPE_PRICE_QUARTERLY) plan = "quarterly";
          else if (priceId === STRIPE_PRICE_YEARLY) plan = "yearly";
          
          const { error } = await supabase
            .from("user_entitlements")
            .upsert({
              user_id: userId,
              plan,
              status: "active",
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              source: "stripe",
            });

          if (error) console.error("[webhook] Error upserting subscription:", error);
          else console.log(`[webhook] Subscription ${plan} activated for user ${userId}`);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Find user by customer ID
        const customer = await stripe.customers.retrieve(customerId);
        const userId = (customer as any).metadata?.user_id;
        if (!userId) {
          console.error("[webhook] No user_id in customer metadata");
          break;
        }

        // Determine plan from price ID
        const priceId = subscription.items.data[0]?.price?.id;
        let plan = "monthly";
        if (priceId === STRIPE_PRICE_QUARTERLY) plan = "quarterly";
        else if (priceId === STRIPE_PRICE_YEARLY) plan = "yearly";
        
        // Handle status - set past_due for unpaid/past_due subscriptions
        let status = mapSubscriptionStatus(subscription.status);
        if (subscription.status === "past_due" || subscription.status === "unpaid") {
          status = "past_due";
        }
        
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        console.log(`[webhook] Upserting subscription: user=${userId}, plan=${plan}, status=${status}`);

        const { error } = await supabase
          .from("user_entitlements")
          .upsert({
            user_id: userId,
            plan,
            status,
            current_period_end: currentPeriodEnd,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            source: "stripe",
          });

        if (error) console.error("[webhook] Error upserting subscription:", error);
        else console.log(`[webhook] Subscription ${subscription.id} upserted for user ${userId}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const customer = await stripe.customers.retrieve(customerId);
        const userId = (customer as any).metadata?.user_id;
        if (!userId) {
          console.error("[webhook] No user_id in customer metadata");
          break;
        }

        // Set to free plan on cancellation
        const { error } = await supabase
          .from("user_entitlements")
          .update({ 
            plan: "free",
            status: "free",
            current_period_end: null,
            stripe_subscription_id: null
          })
          .eq("user_id", userId)
          .eq("stripe_subscription_id", subscription.id);

        if (error) console.error("[webhook] Error canceling subscription:", error);
        else console.log(`[webhook] Subscription ${subscription.id} canceled, user ${userId} set to free`);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const customerId = subscription.customer as string;
        const customer = await stripe.customers.retrieve(customerId);
        const userId = (customer as any).metadata?.user_id;
        if (!userId) break;

        const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        const { error } = await supabase
          .from("user_entitlements")
          .update({ 
            status: "active",
            current_period_end: currentPeriodEnd,
          })
          .eq("user_id", userId)
          .eq("stripe_subscription_id", subscriptionId);

        if (error) console.error("[webhook] Error updating on invoice paid:", error);
        else console.log(`[webhook] Invoice paid, updated user ${userId}`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const customerId = subscription.customer as string;
        const customer = await stripe.customers.retrieve(customerId);
        const userId = (customer as any).metadata?.user_id;
        if (!userId) break;

        const { error } = await supabase
          .from("user_entitlements")
          .update({ status: "past_due" })
          .eq("user_id", userId)
          .eq("stripe_subscription_id", subscriptionId);

        if (error) console.error("[webhook] Error updating on payment failed:", error);
        else console.log(`[webhook] Payment failed for user ${userId}`);
        break;
      }


      default:
        console.log(`[webhook] Unhandled event type: ${event.type}`);
    }

    // Record event as processed
    await supabase.from("webhook_events").insert({ event_id: event.id });

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[webhook] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
