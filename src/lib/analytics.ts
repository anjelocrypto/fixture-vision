import { supabase } from "@/integrations/supabase/client";

type EventName =
  | "signup"
  | "paywall_hit"
  | "pricing_view"
  | "checkout_started"
  | "checkout_completed"
  | "ticket_generated"
  | "feature_used"
  | "subscription_canceled";

/**
 * Lightweight analytics event tracker.
 * Inserts into analytics_events table via RLS (user can insert own events).
 * Fire-and-forget — never blocks UI.
 */
export function trackEvent(
  eventName: EventName,
  properties: Record<string, unknown> = {}
) {
  (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await (supabase as any)
        .from("analytics_events")
        .insert({
          user_id: user?.id ?? null,
          event_name: eventName,
          properties: {
            ...properties,
            url: typeof window !== "undefined" ? window.location.pathname : undefined,
            ts: new Date().toISOString(),
          },
        });
    } catch {
      // Fire-and-forget — never crash the UI
    }
  })();
}
