import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[VOID-CANCELLED-INVOICES] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase environment variables not set");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check using shared helper
    const authResult = await checkCronOrAdminAuth(req, supabase, supabaseServiceKey, "[VOID-CANCELLED-INVOICES]");
    if (!authResult.authorized) {
      logStep("Unauthorized access attempt", { method: authResult.method });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    logStep("Authorized", { method: authResult.method });

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Get all cancelled entitlements with stripe_customer_id
    const { data: cancelledUsers, error: dbError } = await supabase
      .from("user_entitlements")
      .select("user_id, stripe_customer_id, plan, status")
      .in("status", ["canceled", "cancelled", "free"])
      .not("stripe_customer_id", "is", null);

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    logStep("Found cancelled users with Stripe customers", { count: cancelledUsers?.length || 0 });

    const results: Array<{
      customer_id: string;
      invoice_id: string;
      amount: number;
      status: string;
      error?: string;
    }> = [];

    let totalVoided = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    // Process each cancelled user
    for (const user of cancelledUsers || []) {
      if (!user.stripe_customer_id) continue;

      try {
        // List open invoices for this customer
        const openInvoices = await stripe.invoices.list({
          customer: user.stripe_customer_id,
          status: "open",
          limit: 10,
        });

        if (openInvoices.data.length === 0) {
          totalSkipped++;
          continue;
        }

        logStep("Processing customer", { 
          customer_id: user.stripe_customer_id, 
          open_invoices: openInvoices.data.length 
        });

        // Void each open invoice
        for (const invoice of openInvoices.data) {
          try {
            await stripe.invoices.voidInvoice(invoice.id);
            totalVoided++;
            results.push({
              customer_id: user.stripe_customer_id,
              invoice_id: invoice.id,
              amount: invoice.amount_due,
              status: "voided",
            });
            logStep("Voided invoice", { 
              invoice_id: invoice.id, 
              amount: invoice.amount_due / 100 
            });
          } catch (voidError) {
            totalFailed++;
            const errorMsg = voidError instanceof Error ? voidError.message : String(voidError);
            results.push({
              customer_id: user.stripe_customer_id,
              invoice_id: invoice.id,
              amount: invoice.amount_due,
              status: "failed",
              error: errorMsg,
            });
            logStep("Failed to void invoice", { invoice_id: invoice.id, error: errorMsg });
          }
        }
      } catch (customerError) {
        const errorMsg = customerError instanceof Error ? customerError.message : String(customerError);
        logStep("Error processing customer", { 
          customer_id: user.stripe_customer_id, 
          error: errorMsg 
        });
      }
    }

    logStep("Completed", { 
      total_voided: totalVoided, 
      total_failed: totalFailed,
      total_skipped: totalSkipped,
      total_cancelled_users: cancelledUsers?.length || 0
    });

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          cancelled_users_checked: cancelledUsers?.length || 0,
          invoices_voided: totalVoided,
          invoices_failed: totalFailed,
          customers_without_open_invoices: totalSkipped,
        },
        details: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
