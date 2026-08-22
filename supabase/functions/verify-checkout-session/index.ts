import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Authentication required", origin, 401, req);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !stripeKey) {
      return errorResponse("Server configuration unavailable", origin, 500, req);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return errorResponse("Invalid session", origin, 401, req);

    const body = req.method === "GET"
      ? { session_id: new URL(req.url).searchParams.get("session_id") }
      : await req.json().catch(() => ({}));
    const sessionId = typeof body?.session_id === "string" ? body.session_id.trim() : "";
    if (!/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 255) {
      return errorResponse("Invalid checkout session", origin, 400, req);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const ownerId = session.client_reference_id || session.metadata?.user_id;
    if (ownerId !== user.id) return errorResponse("Checkout session not found", origin, 404, req);

    const paymentConfirmed = session.status === "complete"
      && ["paid", "no_payment_required"].includes(session.payment_status);
    const { data: entitlementActive, error: entitlementError } = await userClient.rpc("user_has_access");
    if (entitlementError) {
      console.error("[verify-checkout-session] Entitlement lookup failed", entitlementError);
      return errorResponse("Unable to verify access", origin, 503, req);
    }

    const verified = paymentConfirmed && entitlementActive === true;
    const state = verified
      ? "verified"
      : paymentConfirmed
        ? "processing_entitlement"
        : session.status === "expired"
          ? "expired"
          : "payment_pending";

    return jsonResponse({
      verified,
      state,
      checkout_status: session.status,
      payment_status: session.payment_status,
      plan: session.metadata?.plan ?? null,
    }, origin, 200, req);
  } catch (error) {
    console.error("[verify-checkout-session] Error", error);
    return errorResponse("Unable to verify checkout", origin, 500, req);
  }
});
