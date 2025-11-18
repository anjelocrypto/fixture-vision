import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { STRIPE_PLANS } from "../_shared/stripe_plans.ts";
import { 
  STRIPE_PRICE_DAY_PASS,
  STRIPE_PRICE_TEST_PASS,
  STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_QUARTERLY,
  STRIPE_PRICE_YEARLY 
} from "../_shared/stripePrices.ts";

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

// Helper to resolve userId from various sources
const resolveUserId = async (
  stripe: Stripe,
  supabase: any,
  session?: Stripe.Checkout.Session,
  subscription?: Stripe.Subscription,
  invoice?: Stripe.Invoice,
  customerId?: string
): Promise<string | null> => {
  // Try session first
  if (session?.client_reference_id) {
    console.log(`[webhook] Found userId in session.client_reference_id: ${session.client_reference_id}`);
    return session.client_reference_id;
  }
  if (session?.metadata?.user_id) {
    console.log(`[webhook] Found userId in session.metadata: ${session.metadata.user_id}`);
    return session.metadata.user_id;
  }

  // Try subscription metadata
  if (subscription?.metadata?.user_id) {
    console.log(`[webhook] Found userId in subscription.metadata: ${subscription.metadata.user_id}`);
    return subscription.metadata.user_id;
  }

  // Try invoice metadata
  if (invoice?.metadata?.user_id) {
    console.log(`[webhook] Found userId in invoice.metadata: ${invoice.metadata.user_id}`);
    return invoice.metadata.user_id;
  }

  // Try customer metadata
  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      const userId = (customer as any).metadata?.user_id;
      if (userId) {
        console.log(`[webhook] Found userId in customer.metadata: ${userId}`);
        return userId;
      }
    } catch (err) {
      console.error(`[webhook] Error retrieving customer ${customerId}:`, err);
    }

    // Fallback: lookup in user_entitlements by stripe_customer_id
    console.log(`[webhook] No userId in metadata, checking user_entitlements for customerId: ${customerId}`);
    const { data: entitlement, error } = await supabase
      .from("user_entitlements")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`[webhook] Error looking up userId by customerId:`, error);
    } else if (entitlement?.user_id) {
      console.log(`[webhook] Found userId in user_entitlements: ${entitlement.user_id}`);
      return entitlement.user_id;
    }
  }

  return null;
};

// Helper to upsert entitlement for subscription
const upsertSubscriptionEntitlement = async (
  supabase: any,
  userId: string,
  subscription: Stripe.Subscription,
  customerId: string
) => {
  const priceId = subscription.items.data[0]?.price?.id;
  
  // Map price to plan
  let plan = "monthly";
  if (priceId === STRIPE_PRICE_QUARTERLY) plan = "quarterly";
  else if (priceId === STRIPE_PRICE_YEARLY) plan = "yearly";
  else if (priceId === STRIPE_PRICE_MONTHLY) plan = "monthly";
  
  const status = mapSubscriptionStatus(subscription.status);
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

  console.log(`[webhook][subscription] Upserting entitlement:`, {
    userId,
    plan,
    status,
    subscriptionId: subscription.id,
    customerId,
    priceId,
    currentPeriodEnd,
  });

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

  if (error) {
    console.error("[webhook][subscription] ❌ Error upserting entitlement:", error);
    throw error;
  } else {
    console.log(`[webhook][subscription] ✅ Entitlement upserted successfully`);
  }
};

// Webhook handler for Stripe events
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
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

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
        const customerId = session.customer as string;
        
        const userId = await resolveUserId(stripe, supabase, session, undefined, undefined, customerId);
        
        if (!userId) {
          console.error("[webhook] ❌ CRITICAL: No user_id resolvable for checkout", { 
            sessionId: session.id,
            customer: customerId,
            mode: session.mode,
            metadata: session.metadata
          });
          return new Response(
            JSON.stringify({ error: "Missing userId" }), 
            { headers: corsHeaders, status: 400 }
          );
        }
        
        console.log(`[webhook][checkout.session.completed]`, {
          eventType: event.type,
          eventId: event.id,
          mode: session.mode,
          customerId,
          userId,
          metadata: session.metadata,
        });

        if (session.mode === "payment") {
          // For one-time payments (day_pass, test_pass), prioritize metadata.plan
          let planName = undefined as "day_pass" | "test_pass" | undefined;
          const metaPlan = session.metadata?.plan as string | undefined;
          
          if (metaPlan === "day_pass" || metaPlan === "test_pass") {
            planName = metaPlan;
            console.log(`[webhook] Found plan in metadata: ${planName}`);
          } else {
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
            const priceId = lineItems.data[0]?.price?.id;
            console.log(`[webhook] Checking line item price: ${priceId}`);
            
            if (priceId === STRIPE_PRICE_TEST_PASS) planName = "test_pass";
            else if (priceId === STRIPE_PRICE_DAY_PASS) planName = "day_pass";
          }

          if (!planName) {
            console.error("[webhook] ❌ Payment session missing valid plan; skipping entitlement", {
              sessionId: session.id,
              metadataPlan: metaPlan,
            });
          } else {
            console.log(`[webhook] Upserting ${planName} entitlement for user ${userId}`);
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

            if (error) console.error(`[webhook] ❌ Error upserting ${planName}:`, error);
            else console.log(`[webhook] ✅ ${planName} activated for user ${userId}`);
          }
        } else if (session.mode === "subscription") {
          // Fetch subscription details
          const subscriptionId = session.subscription as string;
          if (!subscriptionId) {
            console.error("[webhook] ❌ No subscription ID in checkout session");
            break;
          }
          
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price?.id;
          
          console.log(`[webhook][subscription] Processing subscription from checkout:`, {
            subscriptionId,
            priceId,
            userId,
            customerId,
          });
          
          await upsertSubscriptionEntitlement(supabase, userId, subscription, customerId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price?.id;

        console.log(`[webhook][${event.type}]`, {
          eventType: event.type,
          eventId: event.id,
          subscriptionId: subscription.id,
          customerId,
          priceId,
          status: subscription.status,
        });

        const userId = await resolveUserId(stripe, supabase, undefined, subscription, undefined, customerId);
        
        if (!userId) {
          console.error(`[webhook] ❌ CRITICAL: No user_id resolvable for ${event.type}`, {
            eventType: event.type,
            eventId: event.id,
            customerId,
            subscriptionId: subscription.id,
            priceId,
          });
          return new Response(
            JSON.stringify({ error: "Missing userId" }), 
            { headers: corsHeaders, status: 400 }
          );
        }

        await upsertSubscriptionEntitlement(supabase, userId, subscription, customerId);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const userId = await resolveUserId(stripe, supabase, undefined, subscription, undefined, customerId);
        if (!userId) {
          console.error("[webhook] ❌ No user_id for subscription deletion");
          break;
        }

        console.log(`[webhook][subscription.deleted] Setting user ${userId} to free plan`);

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
        else console.log(`[webhook] ✅ Subscription ${subscription.id} canceled, user ${userId} set to free`);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const customerId = subscription.customer as string;
        
        const userId = await resolveUserId(stripe, supabase, undefined, subscription, invoice, customerId);
        if (!userId) {
          console.error("[webhook] ❌ No user_id for invoice.payment_succeeded");
          break;
        }

        const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        console.log(`[webhook][invoice.payment_succeeded] Updating user ${userId} to active`);

        const { error } = await supabase
          .from("user_entitlements")
          .update({ 
            status: "active",
            current_period_end: currentPeriodEnd,
          })
          .eq("user_id", userId)
          .eq("stripe_subscription_id", subscriptionId);

        if (error) console.error("[webhook] Error updating on invoice paid:", error);
        else console.log(`[webhook] ✅ Invoice paid, updated user ${userId}`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const customerId = subscription.customer as string;
        
        const userId = await resolveUserId(stripe, supabase, undefined, subscription, invoice, customerId);
        if (!userId) {
          console.error("[webhook] ❌ No user_id for invoice.payment_failed");
          break;
        }

        console.log(`[webhook][invoice.payment_failed] Marking user ${userId} as past_due`);

        const { error } = await supabase
          .from("user_entitlements")
          .update({ status: "past_due" })
          .eq("user_id", userId)
          .eq("stripe_subscription_id", subscriptionId);

        if (error) console.error("[webhook] Error updating on payment failed:", error);
        else console.log(`[webhook] ✅ Payment failed for user ${userId}`);
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