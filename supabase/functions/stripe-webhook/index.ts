import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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
          console.error("[webhook] No user_id in checkout session");
          break;
        }

        const plan = session.metadata?.plan || "unknown";
        const customerId = session.customer as string;

        if (session.mode === "payment") {
          // Day Pass
          const { error } = await supabase
            .from("user_entitlements")
            .upsert({
              user_id: userId,
              plan: "day_pass",
              status: "active",
              current_period_end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              stripe_customer_id: customerId,
              stripe_subscription_id: null,
              source: "stripe",
            });

          if (error) console.error("[webhook] Error upserting day pass:", error);
          else console.log(`[webhook] Day pass activated for user ${userId}`);
        } else if (session.mode === "subscription") {
          // Subscription - will be handled by subscription.created
          console.log(`[webhook] Subscription checkout completed for user ${userId}`);
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

        const plan = subscription.items.data[0]?.price?.metadata?.plan || "premium_monthly";
        const status = mapSubscriptionStatus(subscription.status);
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

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

        const { error } = await supabase
          .from("user_entitlements")
          .update({ status: "canceled" })
          .eq("user_id", userId)
          .eq("stripe_subscription_id", subscription.id);

        if (error) console.error("[webhook] Error canceling subscription:", error);
        else console.log(`[webhook] Subscription ${subscription.id} canceled for user ${userId}`);
        break;
      }

      case "invoice.paid": {
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

      case "charge.succeeded": {
        const charge = event.data.object as Stripe.Charge;
        // Only handle one-time charges (Day Pass)
        if (charge.metadata?.plan === "day_pass") {
          const userId = charge.metadata?.user_id;
          if (!userId) break;

          const customerId = charge.customer as string;

          const { error } = await supabase
            .from("user_entitlements")
            .upsert({
              user_id: userId,
              plan: "day_pass",
              status: "active",
              current_period_end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              stripe_customer_id: customerId,
              stripe_subscription_id: null,
              source: "stripe",
            });

          if (error) console.error("[webhook] Error upserting day pass:", error);
          else console.log(`[webhook] Day pass charge succeeded for user ${userId}`);
        }
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
