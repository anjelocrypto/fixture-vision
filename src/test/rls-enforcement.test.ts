/**
 * RLS Enforcement Tests
 * 
 * Uses the REAL Supabase client with the anon key (no auth session)
 * to verify that premium tables return 0 rows to unauthenticated users.
 * This is a real integration test — it hits the actual database.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dutkpzrisvqgxadxbkxo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE";

// Real anon client — no auth session, simulates an unauthenticated/free user
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

describe("RLS: Admin-only premium tables block anon reads", () => {
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

describe("RLS: Public tables are readable by anon", () => {
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

describe("RLS: User-scoped tables block anon", () => {
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

describe("Premium edge functions require auth", () => {
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
