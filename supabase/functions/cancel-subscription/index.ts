import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CANCEL-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Find the user's Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      throw new Error("No Stripe customer found for this user");
    }
    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    // Find active or past_due subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 10,
    });

    const activeOrPastDue = subscriptions.data.filter(
      (sub: { status: string }) => sub.status === "active" || sub.status === "past_due"
    );

    if (activeOrPastDue.length === 0) {
      throw new Error("No active subscription found to cancel");
    }

    logStep("Found subscriptions to cancel at period end", { count: activeOrPastDue.length });

    // Use cancel_at_period_end instead of immediate cancellation
    // This allows users to keep access until their paid period ends
    const canceledSubs: Array<{ id: string; currentPeriodEnd: string }> = [];
    
    for (const sub of activeOrPastDue) {
      // Set cancel_at_period_end = true instead of immediate cancellation
      await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true
      });
      
      const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
      canceledSubs.push({ id: sub.id, currentPeriodEnd: periodEnd });
      
      logStep("Set subscription to cancel at period end", { 
        subscriptionId: sub.id, 
        status: sub.status,
        currentPeriodEnd: periodEnd
      });
    }

    // Void any open invoices to stop payment collection attempts
    let voidedInvoices = 0;
    try {
      const openInvoices = await stripe.invoices.list({
        customer: customerId,
        status: "open",
        limit: 10,
      });

      for (const invoice of openInvoices.data) {
        try {
          await stripe.invoices.voidInvoice(invoice.id);
          voidedInvoices++;
          logStep("Voided open invoice", { invoiceId: invoice.id, amount: invoice.amount_due });
        } catch (voidError) {
          logStep("Failed to void invoice", { 
            invoiceId: invoice.id, 
            error: voidError instanceof Error ? voidError.message : String(voidError) 
          });
        }
      }
      logStep("Invoice voiding complete", { voidedCount: voidedInvoices, totalOpen: openInvoices.data.length });
    } catch (invoiceError) {
      logStep("Warning: Failed to fetch/void invoices", { 
        error: invoiceError instanceof Error ? invoiceError.message : String(invoiceError) 
      });
    }

    // Update user_entitlements to mark as pending cancellation
    // DO NOT downgrade plan/status - user keeps access until current_period_end
    const { error: updateError } = await supabaseClient
      .from("user_entitlements")
      .update({
        cancel_at_period_end: true,
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // Keep status as 'active' and plan unchanged - user keeps access until period ends
      })
      .eq("user_id", user.id);

    if (updateError) {
      logStep("Warning: Failed to update entitlements", { error: updateError.message });
    } else {
      logStep("Updated user entitlements - marked for cancellation at period end");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Subscription will be cancelled at the end of your billing period. You'll keep access until then.",
        cancelledCount: activeOrPastDue.length,
        voidedInvoices,
        accessUntil: canceledSubs[0]?.currentPeriodEnd || null
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
