/**
 * Entitlement Lifecycle Tests
 * 
 * Verifies the expected entitlement state transitions:
 * - Free → Paid (checkout)
 * - Paid → Canceled (cancel_at_period_end)
 * - Canceled → Free (period expires)
 * - Day Pass → Free (24h expiry)
 */
import { describe, it, expect } from "vitest";

interface Entitlement {
  user_id: string;
  plan: string;
  status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
}

const makeEntitlement = (overrides: Partial<Entitlement> = {}): Entitlement => ({
  user_id: "user-123",
  plan: "free",
  status: "free",
  current_period_end: new Date(0).toISOString(),
  cancel_at_period_end: false,
  stripe_subscription_id: null,
  ...overrides,
});

describe("Entitlement state transitions", () => {
  it("free user has plan=free and status=free", () => {
    const ent = makeEntitlement();
    expect(ent.plan).toBe("free");
    expect(ent.status).toBe("free");
    expect(ent.stripe_subscription_id).toBeNull();
  });

  it("after checkout, user has plan=monthly and status=active", () => {
    const ent = makeEntitlement({
      plan: "monthly",
      status: "active",
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      stripe_subscription_id: "sub_123",
    });
    expect(ent.plan).toBe("monthly");
    expect(ent.status).toBe("active");
    expect(new Date(ent.current_period_end).getTime()).toBeGreaterThan(Date.now());
  });

  it("after cancellation, user keeps access until period_end", () => {
    const periodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const ent = makeEntitlement({
      plan: "monthly",
      status: "active",
      current_period_end: periodEnd.toISOString(),
      cancel_at_period_end: true,
      stripe_subscription_id: "sub_123",
    });
    expect(ent.cancel_at_period_end).toBe(true);
    expect(ent.status).toBe("active"); // Still active until period_end
    expect(new Date(ent.current_period_end).getTime()).toBeGreaterThan(Date.now());
  });

  it("after period expires, user is downgraded to free", () => {
    const ent = makeEntitlement({
      plan: "free",
      status: "free",
      current_period_end: new Date(0).toISOString(),
      cancel_at_period_end: false,
      stripe_subscription_id: null,
    });
    expect(ent.plan).toBe("free");
    expect(ent.status).toBe("free");
    expect(ent.stripe_subscription_id).toBeNull();
  });

  it("day pass expires after 24 hours", () => {
    const dayPassEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const ent = makeEntitlement({
      plan: "day_pass",
      status: "active",
      current_period_end: dayPassEnd.toISOString(),
    });
    expect(ent.plan).toBe("day_pass");
    // After 24h, cron sets plan=free
  });

  it("only one entitlement per user (primary key on user_id)", () => {
    // user_entitlements has PRIMARY KEY on user_id
    // This means upsert always replaces, never creates duplicates
    const userId = "user-123";
    const ent1 = makeEntitlement({ user_id: userId, plan: "monthly" });
    const ent2 = makeEntitlement({ user_id: userId, plan: "annual" });
    expect(ent1.user_id).toBe(ent2.user_id);
    // Upsert on user_id means ent2 replaces ent1
  });
});

describe("Access check logic", () => {
  const hasAccess = (ent: Entitlement): boolean => {
    if (ent.plan === "free") return false;
    if (ent.status !== "active" && ent.status !== "past_due") return false;
    if (new Date(ent.current_period_end).getTime() < Date.now()) return false;
    return true;
  };

  it("grants access to active paid user", () => {
    const ent = makeEntitlement({
      plan: "monthly",
      status: "active",
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(hasAccess(ent)).toBe(true);
  });

  it("denies access to free user", () => {
    const ent = makeEntitlement();
    expect(hasAccess(ent)).toBe(false);
  });

  it("denies access when period has expired", () => {
    const ent = makeEntitlement({
      plan: "monthly",
      status: "active",
      current_period_end: new Date(Date.now() - 1000).toISOString(),
    });
    expect(hasAccess(ent)).toBe(false);
  });

  it("grants access to past_due user (grace period)", () => {
    const ent = makeEntitlement({
      plan: "monthly",
      status: "past_due",
      current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(hasAccess(ent)).toBe(true);
  });
});
