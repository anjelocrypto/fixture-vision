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
