/**
 * Reconcile Entitlements
 * 
 * Queries Stripe for all active subscriptions and reconciles against user_entitlements.
 * Fixes: users who paid but webhook failed to update their access.
 * 
 * ACCESS: Admin/cron only (via checkCronOrAdminAuth)
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import {
  STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_THREE_MONTH,
  STRIPE_PRICE_YEARLY,
  STRIPE_PRICE_DAY_PASS,
} from "../_shared/stripePrices.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOG = "[reconcile-entitlements]";

const getPlanFromPriceId = (priceId: string): string => {
  if (priceId === STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === STRIPE_PRICE_THREE_MONTH) return "three_month";
  if (priceId === STRIPE_PRICE_YEARLY) return "annual";
  if (priceId === STRIPE_PRICE_DAY_PASS) return "day_pass";
  return "unknown";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const auth = await checkCronOrAdminAuth(req, supabase, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", LOG);
  if (!auth.authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    let fixed = 0;
    let checked = 0;
    let alreadyCorrect = 0;
    const errors: string[] = [];
    const authUsers: Array<{ id: string; email?: string }> = [];
    let authPage = 1;

    // Load the complete auth directory once. Calling listUsers() without
    // pagination inside the subscription loop silently misses users after page 1.
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({
        page: authPage,
        perPage: 1000,
      });
      if (error) {
        throw new Error(`Unable to load auth users: ${error.message}`);
      }
      authUsers.push(...data.users);
      if (data.users.length < 1000) break;
      authPage++;
    }

    const authUserIds = new Set(authUsers.map((user) => user.id));
    const authUserByEmail = new Map<string, string | null>();
    for (const user of authUsers) {
      const email = user.email?.trim().toLowerCase();
      if (!email) continue;
      authUserByEmail.set(
        email,
        authUserByEmail.has(email) ? null : user.id,
      );
    }

    // Get all active subscriptions from Stripe
    const subscriptions: Stripe.Subscription[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: any = { status: "active", limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;
      const batch = await stripe.subscriptions.list(params);
      subscriptions.push(...batch.data);
      hasMore = batch.has_more;
      if (batch.data.length > 0) {
        startingAfter = batch.data[batch.data.length - 1].id;
      }
    }

    console.log(`${LOG} Found ${subscriptions.length} active Stripe subscriptions`);

    for (const sub of subscriptions) {
      checked++;
      const customerId = sub.customer as string;
      const priceId = sub.items.data[0]?.price?.id;
      const plan = getPlanFromPriceId(priceId || "");
      const endTs = sub.current_period_end;
      if (plan === "unknown" || !endTs) {
        errors.push(`Skipped subscription ${sub.id}: unknown price or missing period end`);
        continue;
      }
      const periodEnd = new Date(endTs * 1000).toISOString();

      // Find user by stripe_customer_id
      const { data: entitlement } = await supabase
        .from("user_entitlements")
        .select("user_id, plan, status, current_period_end, stripe_subscription_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (!entitlement) {
        // Recover from durable Stripe metadata first. Email is only a fallback
        // when it maps to exactly one auth user.
        try {
          const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
          if (customer.deleted) {
            errors.push(`Skipped deleted customer ${customerId}`);
            continue;
          }

          const metadataUserId = customer.metadata?.user_id;
          const emailUserId = customer.email
            ? authUserByEmail.get(customer.email.trim().toLowerCase())
            : undefined;
          const matchedUserId = metadataUserId && authUserIds.has(metadataUserId)
            ? metadataUserId
            : emailUserId || undefined;

          if (!matchedUserId) {
            errors.push(`Could not map Stripe customer ${customerId} to one auth user`);
            continue;
          }

          if (!metadataUserId) {
            await stripe.customers.update(customerId, {
              metadata: { ...customer.metadata, user_id: matchedUserId },
            });
          } else if (metadataUserId !== matchedUserId) {
            errors.push(`Stripe customer ${customerId} has conflicting ownership metadata`);
            continue;
          }

          const { error } = await supabase.from("user_entitlements").upsert({
            user_id: matchedUserId,
            plan,
            status: "active",
            current_period_end: periodEnd,
            stripe_customer_id: customerId,
            stripe_subscription_id: sub.id,
            source: "reconciliation",
          });
          if (error) {
            errors.push(`Failed to create entitlement for ${matchedUserId}: ${error.message}`);
          } else {
            fixed++;
            console.log(`${LOG} FIXED: Created entitlement for user ${matchedUserId} (${plan})`);
            const fingerprint = `billing:reconciled:${matchedUserId}`;
            await supabase.rpc("record_pipeline_alert", {
              p_fingerprint: fingerprint,
              p_alert_type: "billing_reconciled",
              p_severity: "warning",
              p_message: "Reconciliation created a missing entitlement",
              p_details: { user_id: matchedUserId, plan, subscription_id: sub.id },
            });
            await supabase.rpc("resolve_pipeline_alert", { p_fingerprint: fingerprint });
          }
        } catch (e) {
          errors.push(`Error looking up customer ${customerId}: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }

      // Check if entitlement is correct
      const isCorrect =
        entitlement.status === "active" &&
        entitlement.plan === plan &&
        entitlement.stripe_subscription_id === sub.id &&
        entitlement.current_period_end &&
        new Date(entitlement.current_period_end) >= new Date();

      if (isCorrect) {
        alreadyCorrect++;
        continue;
      }

      // Fix the entitlement
      const { error } = await supabase
        .from("user_entitlements")
        .update({
          plan,
          status: "active",
          current_period_end: periodEnd,
          stripe_subscription_id: sub.id,
          source: "reconciliation",
        })
        .eq("user_id", entitlement.user_id);

      if (error) {
        errors.push(`Failed to fix ${entitlement.user_id}: ${error.message}`);
      } else {
        fixed++;
        console.log(`${LOG} FIXED: Updated entitlement for user ${entitlement.user_id} (${entitlement.plan}→${plan})`);
        const fingerprint = `billing:reconciled:${entitlement.user_id}`;
        await supabase.rpc("record_pipeline_alert", {
          p_fingerprint: fingerprint,
          p_alert_type: "billing_reconciled",
          p_severity: "warning",
          p_message: "Reconciliation corrected entitlement drift",
          p_details: { user_id: entitlement.user_id, old_plan: entitlement.plan, new_plan: plan },
        });
        await supabase.rpc("resolve_pipeline_alert", { p_fingerprint: fingerprint });
      }
    }

    const result = { checked, fixed, already_correct: alreadyCorrect, errors: errors.length, error_details: errors };
    console.log(`${LOG} Complete:`, result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`${LOG} Error:`, error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
