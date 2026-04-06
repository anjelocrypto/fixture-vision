/**
 * Analytics Event Tests
 * 
 * Verifies the trackEvent helper works correctly.
 */
import { describe, it, expect, vi } from "vitest";

// Mock supabase
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user" } } }),
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

describe("trackEvent", () => {
  it("should export trackEvent function", async () => {
    const { trackEvent } = await import("@/lib/analytics");
    expect(typeof trackEvent).toBe("function");
  });

  it("should fire without throwing", async () => {
    const { trackEvent } = await import("@/lib/analytics");
    // trackEvent is fire-and-forget, should never throw
    expect(() => trackEvent("signup")).not.toThrow();
    expect(() => trackEvent("paywall_hit", { feature: "ticket_creator" })).not.toThrow();
    expect(() => trackEvent("pricing_view")).not.toThrow();
    expect(() => trackEvent("checkout_started", { plan: "monthly" })).not.toThrow();
    expect(() => trackEvent("checkout_completed", { plan: "monthly" })).not.toThrow();
    expect(() => trackEvent("ticket_generated", { legs: 2 })).not.toThrow();
    expect(() => trackEvent("feature_used", { feature: "filterizer" })).not.toThrow();
    expect(() => trackEvent("subscription_canceled")).not.toThrow();
  });
});
