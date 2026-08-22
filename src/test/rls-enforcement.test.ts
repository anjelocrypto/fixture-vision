/**
 * RLS Enforcement Tests
 * 
 * Uses a staging Supabase client with the publishable key (no auth session)
 * to verify that premium tables return 0 rows to unauthenticated users.
 * The suite is skipped unless TEST_SUPABASE_URL and
 * TEST_SUPABASE_PUBLISHABLE_KEY are explicitly configured.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const testEnv = import.meta.env as Record<string, string | undefined>;
const SUPABASE_URL = testEnv.TEST_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = testEnv.TEST_SUPABASE_PUBLISHABLE_KEY;
const integrationEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

const anonClient = createClient(
  SUPABASE_URL ?? "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY ?? "integration-test-not-configured",
);
const describeIntegration = integrationEnabled ? describe : describe.skip;

/**
 * Tables that MUST return 0 rows (or error) to anon users.
 * These are admin-only via RLS.
 */
const ADMIN_ONLY_TABLES = [
  "optimized_selections",
  "safe_zone_picks",
  "team_totals_candidates",
  "performance_weights",
] as const;

/**
 * Tables that should be publicly readable (fixtures, leagues, etc.)
 */
const PUBLIC_READ_TABLES = [
  "fixtures",
  "leagues",
  "countries",
] as const;

describeIntegration("RLS: Admin-only premium tables block anon reads", () => {
  for (const table of ADMIN_ONLY_TABLES) {
    it(`anon user gets 0 rows from ${table}`, async () => {
      const { data, error } = await (anonClient as any)
        .from(table)
        .select("*")
        .limit(1);

      // RLS blocks: either error or empty array
      if (error) {
        // Permission denied is acceptable
        expect(error.code).toBeTruthy();
      } else {
        expect(data).toEqual([]);
      }
    });
  }
});

describeIntegration("RLS: Public tables are readable by anon", () => {
  for (const table of PUBLIC_READ_TABLES) {
    it(`anon user can read from ${table}`, async () => {
      const { data, error } = await (anonClient as any)
        .from(table)
        .select("id")
        .limit(1);

      // Should succeed (no RLS block)
      expect(error).toBeNull();
      // data may be empty if no rows, but shouldn't be blocked
      expect(Array.isArray(data)).toBe(true);
    });
  }
});

describeIntegration("RLS: User-scoped tables block anon", () => {
  it("anon user gets 0 rows from user_entitlements", async () => {
    const { data, error } = await (anonClient as any)
      .from("user_entitlements")
      .select("*")
      .limit(1);

    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
  });

  it("anon user gets 0 rows from generated_tickets", async () => {
    const { data, error } = await (anonClient as any)
      .from("generated_tickets")
      .select("*")
      .limit(1);

    if (error) {
      expect(error.code).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
  });
});

describeIntegration("Premium edge functions require auth", () => {
  const PREMIUM_FUNCTIONS = [
    "generate-ticket",
    "analyze-fixture",
    "filterizer-query",
    "safe-zone",
    "card-war",
    "who-concedes",
    "btts-index",
  ];

  for (const fn of PREMIUM_FUNCTIONS) {
    it(`${fn} returns 401/402 without auth token`, async () => {
      const { error } = await anonClient.functions.invoke(fn, {
        body: {},
      });

      // Should fail with auth or paywall error
      expect(error).toBeTruthy();
    });
  }
});

/**
 * GATE D SECURITY WARNINGS RC — anon exposure of leaderboard snapshots and
 * SECURITY DEFINER routines. Anon must be denied at the GRANT layer (42501),
 * never merely filtered by RLS.
 */
describeIntegration("Anon cannot reach leaderboard snapshots or privileged RPCs", () => {
  it("anon cannot select market_leaderboard_snapshots", async () => {
    const { data, error } = await (anonClient as any)
      .from("market_leaderboard_snapshots")
      .select("user_id")
      .limit(1);

    expect(error).toBeTruthy();
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("anon cannot count market_leaderboard_snapshots rows", async () => {
    const { count, error } = await (anonClient as any)
      .from("market_leaderboard_snapshots")
      .select("*", { count: "exact", head: true });

    expect(error).toBeTruthy();
    expect(count).toBeNull();
  });

  it("anon cannot execute get_market_leaderboard", async () => {
    const { error } = await (anonClient as any).rpc("get_market_leaderboard", { p_limit: 5 });
    expect(error?.code).toBe("42501");
  });

  it("anon cannot execute is_user_subscriber with an arbitrary user id", async () => {
    const { error } = await (anonClient as any).rpc("is_user_subscriber", {
      check_user_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error?.code).toBe("42501");
  });

  it("anon cannot execute try_use_feature", async () => {
    const { error } = await (anonClient as any).rpc("try_use_feature", {
      feature_key: "bet_optimizer",
    });
    expect(error?.code).toBe("42501");
  });

  it("get_market_aggregates is the only anon-callable definer routine and leaks no user ids", async () => {
    const { data, error } = await (anonClient as any).rpc("get_market_aggregates", {
      _market_id: "00000000-0000-0000-0000-000000000000",
    });

    expect(error).toBeNull();
    const payload = JSON.stringify(data ?? {});
    expect(payload).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(Object.keys(data ?? {}).sort()).toEqual([
      "no_positions",
      "no_stake",
      "total_pool",
      "total_positions",
      "unique_traders",
      "yes_positions",
      "yes_stake",
    ]);
  });
});

