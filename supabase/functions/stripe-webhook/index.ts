import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";
import { STRIPE_PLANS } from "../_shared/stripe_plans.ts";
import { 
  STRIPE_PRICE_DAY_PASS,
  STRIPE_PRICE_TEST_PASS,
} from "../_shared/stripePrices.ts";
import { readTextWithLimit, RequestBodyTooLargeError } from "../_shared/request.ts";

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
    case "incomplete":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      throw new Error(`Unsupported Stripe subscription status: ${stripeStatus}`);
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

const getRequiredSubscriptionPlan = (priceId?: string): string => {
  const plan = getPlanFromPriceId(priceId ?? "");
  if (!["monthly", "three_month", "annual"].includes(plan)) {
    throw new Error(`Unsupported recurring Stripe price: ${priceId ?? "missing"}`);
  }
  return plan;
};

const getRequiredPeriodEnd = (subscription: Stripe.Subscription): string => {
  if (!subscription.current_period_end) {
    throw new Error(`Subscription ${subscription.id} is missing current_period_end`);
  }

  return new Date(subscription.current_period_end * 1000).toISOString();
};

const applyEntitlementEvent = async (
  supabase: any,
  event: Stripe.Event,
  userId: string,
  patch: Record<string, unknown>,
  expectedSubscriptionId: string | null = null,
): Promise<boolean> => {
  const { data, error } = await supabase.rpc("apply_stripe_entitlement_event", {
    p_user_id: userId,
    p_event_id: event.id,
    p_event_created_at: new Date(event.created * 1000).toISOString(),
    p_patch: patch,
    p_expected_subscription_id: expectedSubscriptionId,
  });

  if (error) {
    throw new Error(`Failed to apply entitlement event: ${error.message}`);
  }

  if (data?.applied !== true) {
    console.warn("[webhook] Entitlement event was not applied", {
      eventId: event.id,
      eventType: event.type,
      userId,
      reason: data?.reason,
    });
    return false;
  }

  return true;
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
  event: Stripe.Event,
  userId: string,
  subscription: Stripe.Subscription,
  customerId: string
) => {
  const priceId = subscription.items.data[0]?.price?.id;
  
  const plan = getRequiredSubscriptionPlan(priceId);
  
  const status = mapSubscriptionStatus(subscription.status);

  const currentPeriodEnd = getRequiredPeriodEnd(subscription);

  console.log(`[webhook][subscription] Upserting entitlement:`, {
    userId,
    plan,
    status,
    subscriptionId: subscription.id,
    customerId,
    priceId,
    currentPeriodEnd,
  });

  await applyEntitlementEvent(supabase, event, userId, {
    plan,
    status,
    current_period_end: currentPeriodEnd,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    source: "stripe",
    cancel_at_period_end: subscription.cancel_at_period_end || false,
    canceled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null,
  });
  console.log(`[webhook][subscription] ✅ Entitlement upserted successfully`);
};

// Webhook handler for Stripe events
serve(async (req) => {
  let claimedEventId: string | null = null;
  let claimedSupabase: any = null;

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

    const body = await readTextWithLimit(req, 1024 * 1024);
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    console.log(`[webhook] Received event: ${event.type}, ID: ${event.id}`);

    // Use service role for DB writes
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );
    const { data: claimStatus, error: claimError } = await supabase.rpc(
      "claim_stripe_webhook_event",
      {
        p_event_id: event.id,
        p_event_type: event.type,
        p_event_created_at: new Date(event.created * 1000).toISOString(),
      },
    );

    if (claimError) {
      throw new Error(`Failed to claim webhook event: ${claimError.message}`);
    }

    if (claimStatus !== "claimed") {
      console.log(`[webhook] Event ${event.id} skipped (${claimStatus})`);
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    claimedEventId = event.id;
    claimedSupabase = supabase;

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
          throw new Error("Missing userId for checkout session");
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
            throw new Error(
              `Payment session ${session.id} is missing a supported one-time plan`,
            );
          } else {
            const currentPeriodEnd = new Date((event.created + 24 * 60 * 60) * 1000).toISOString();
            console.log(`[webhook] 🎟️ Creating ${planName} entitlement for user ${userId}`, {
              userId,
              plan: planName,
              status: "active",
              current_period_end: currentPeriodEnd,
              stripe_customer_id: customerId,
            });
            
            await applyEntitlementEvent(supabase, event, userId, {
              plan: planName,
              status: "active",
              current_period_end: currentPeriodEnd,
              stripe_customer_id: customerId,
              stripe_subscription_id: null,
              source: "stripe_one_time",
              cancel_at_period_end: false,
              canceled_at: null,
            });
            console.log(`[webhook] ✅ ${planName} activated for user ${userId}, expires at ${currentPeriodEnd}`);
          }
        } else if (session.mode === "subscription") {
          // Fetch subscription details
          const subscriptionId = session.subscription as string;
          if (!subscriptionId) {
            throw new Error("No subscription ID in checkout session");
          }
          
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price?.id;
          
          console.log(`[webhook][subscription] Processing subscription from checkout:`, {
            subscriptionId,
            priceId,
            userId,
            customerId,
          });
          
          await upsertSubscriptionEntitlement(supabase, event, userId, subscription, customerId);
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
          cancel_at_period_end: subscription.cancel_at_period_end,
          current_period_end: subscription.current_period_end,
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
          throw new Error(`Missing userId for ${event.type}`);
        }

        const plan = getRequiredSubscriptionPlan(priceId);

        // Get period end from Stripe
        const currentPeriodEnd = getRequiredPeriodEnd(subscription);
        const now = new Date();
        const periodEndDate = new Date(currentPeriodEnd);

        // CRITICAL: Never downgrade to free if user still has paid time
        if (periodEndDate > now) {
          // User still has time - always keep access
          const status = mapSubscriptionStatus(subscription.status);
          
          const updateData: Record<string, unknown> = {
            plan,
            status,
            current_period_end: currentPeriodEnd,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            source: "stripe",
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            canceled_at: subscription.canceled_at
              ? new Date(subscription.canceled_at * 1000).toISOString()
              : null,
          };

          console.log(`[webhook][${event.type}] Upserting entitlement (user has time until ${currentPeriodEnd}):`, updateData);

          await applyEntitlementEvent(supabase, event, userId, updateData);
          console.log(`[webhook][${event.type}] ✅ Entitlement updated successfully`);
        } else {
          // Period expired - now we can downgrade
          console.log(`[webhook][${event.type}] Period expired (${currentPeriodEnd}), downgrading to free`);
          
          const applied = await applyEntitlementEvent(
            supabase,
            event,
            userId,
            {
              plan: "free",
              status: "free",
              current_period_end: new Date(0).toISOString(),
              stripe_subscription_id: null,
              source: "stripe",
              cancel_at_period_end: false,
              canceled_at: null,
            },
            subscription.id,
          );

          if (applied) {
            // Keep a resolved operational record without leaving a healthy
            // billing lifecycle event in the open-alert queue.
            const fingerprint = `billing:downgrade:${userId}`;
            await supabase.rpc("record_pipeline_alert", {
              p_fingerprint: fingerprint,
              p_alert_type: "billing_downgrade",
              p_severity: "info",
              p_message: `Subscription access ended after its paid period`,
              p_details: { user_id: userId, event_type: event.type, event_id: event.id },
            });
            await supabase.rpc("resolve_pipeline_alert", { p_fingerprint: fingerprint });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const userId = await resolveUserId(stripe, supabase, undefined, subscription, undefined, customerId);
        if (!userId) {
          throw new Error("No user_id for subscription deletion");
        }

        // Check if user still has paid time remaining
        const periodEndDate = new Date(getRequiredPeriodEnd(subscription));
        const now = new Date();

        if (periodEndDate > now) {
          // User still has paid time - keep access until period ends!
          console.log(`[webhook][subscription.deleted] User ${userId} has access until ${periodEndDate.toISOString()}`);

          const applied = await applyEntitlementEvent(
            supabase,
            event,
            userId,
            {
              status: "active", // Keep active - they paid for this time!
              cancel_at_period_end: true,
              canceled_at: subscription.canceled_at
                ? new Date(subscription.canceled_at * 1000).toISOString()
                : new Date(event.created * 1000).toISOString(),
              current_period_end: periodEndDate.toISOString(),
            },
            subscription.id,
          );

          if (applied) {
            console.log(`[webhook] ✅ Subscription ${subscription.id} marked for expiration, user ${userId} keeps access until ${periodEndDate.toISOString()}`);
          }
        } else {
          // Period already expired - downgrade immediately
          console.log(`[webhook][subscription.deleted] Period expired, setting user ${userId} to free plan`);

          const applied = await applyEntitlementEvent(
            supabase,
            event,
            userId,
            {
              plan: "free",
              status: "free",
              current_period_end: new Date(0).toISOString(),
              stripe_subscription_id: null,
              source: "stripe",
              cancel_at_period_end: false,
              canceled_at: subscription.canceled_at
                ? new Date(subscription.canceled_at * 1000).toISOString()
                : new Date(event.created * 1000).toISOString(),
            },
            subscription.id,
          );

          if (applied) {
            console.log(`[webhook] ✅ Subscription ${subscription.id} canceled, user ${userId} set to free`);
          }
        }
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
          throw new Error("No user_id for invoice.payment_succeeded");
        }

        const currentPeriodEnd = getRequiredPeriodEnd(subscription);

        console.log(`[webhook][invoice.payment_succeeded] Updating user ${userId} to active`);

        const applied = await applyEntitlementEvent(
          supabase,
          event,
          userId,
          {
            status: "active",
            current_period_end: currentPeriodEnd,
          },
          subscriptionId,
        );

        if (applied) {
          console.log(`[webhook] ✅ Invoice paid, updated user ${userId}`);
        }
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
          throw new Error("No user_id for invoice.payment_failed");
        }

        console.log(`[webhook][invoice.payment_failed] Marking user ${userId} as past_due`);

        const applied = await applyEntitlementEvent(
          supabase,
          event,
          userId,
          { status: "past_due" },
          subscriptionId,
        );

        if (applied) {
          console.log(`[webhook] ✅ Payment failed for user ${userId}`);
        }
        break;
      }


      default:
        console.log(`[webhook] Unhandled event type: ${event.type}`);
    }

    const { error: completionError } = await supabase.rpc(
      "complete_stripe_webhook_event",
      { p_event_id: event.id },
    );
    if (completionError) {
      throw new Error(`Failed to complete webhook event: ${completionError.message}`);
    }
    claimedEventId = null;

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[webhook] Error:", error);
    if (claimedEventId && claimedSupabase) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const { error: failureError } = await claimedSupabase.rpc(
        "fail_stripe_webhook_event",
        {
          p_event_id: claimedEventId,
          p_error: message,
        },
      );
      if (failureError) {
        console.error("[webhook] Failed to mark webhook event as failed:", failureError);
      }
    }

    const tooLarge = error instanceof RequestBodyTooLargeError;
    return new Response(
      JSON.stringify({ error: tooLarge ? "payload_too_large" : "webhook_rejected" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: tooLarge ? 413 : claimedEventId ? 500 : 400,
      }
    );
  }
});
