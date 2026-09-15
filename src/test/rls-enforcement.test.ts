/**
 * Protected integration suite (RC3.3).
 *
 * Runs ONLY against a dedicated non-production staging backend seeded with
 * `supabase/staging/seed_staging_integration.sql`. It never points at
 * production and never uses a service-role key.
 *
 * Required environment (see docs/staging-integration-setup.md):
 *   TEST_SUPABASE_URL, TEST_SUPABASE_PUBLISHABLE_KEY
 *   TEST_USER_A_EMAIL, TEST_USER_A_PASSWORD
 *   TEST_USER_B_EMAIL, TEST_USER_B_PASSWORD
 *
 * Failure policy: a missing function (PGRST202), an invalid schema reference
 * (PGRST204 / 42703), a network error or an HTTP 500 is a FAILURE, never a
 * "denial". Only genuine authorization denials pass.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = import.meta.env as Record<string, string | undefined>;
const SUPABASE_URL = env.TEST_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = env.TEST_SUPABASE_PUBLISHABLE_KEY;
const USER_A = { email: env.TEST_USER_A_EMAIL, password: env.TEST_USER_A_PASSWORD };
const USER_B = { email: env.TEST_USER_B_EMAIL, password: env.TEST_USER_B_PASSWORD };

const anonEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const usersEnabled = Boolean(
  anonEnabled && USER_A.email && USER_A.password && USER_B.email && USER_B.password,
);

const anonClient = createClient(
  SUPABASE_URL ?? "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY ?? "integration-test-not-configured",
  { auth: { persistSession: false } },
);

const describeIntegration = anonEnabled ? describe : describe.skip;
const describeUsers = usersEnabled ? describe : describe.skip;

/** Seeded synthetic rows — identical ids in the staging seed script. */
const SEED = {
  ticketA: "11111111-1111-4111-8111-111111111111",
  ticketB: "22222222-2222-4222-8222-222222222222",
  legA: "33333333-3333-4333-8333-333333333333",
  legB: "44444444-4444-4444-8444-444444444444",
  fixtureId: 990001,
  marketId: "55555555-5555-4555-8555-555555555555",
};

/** Postgres/PostgREST codes that mean "the test itself is wrong". */
const BROKEN_TEST_CODES = new Set([
  "PGRST202", // function does not exist / wrong arguments
  "PGRST204", // column does not exist in the schema cache
  "42703", // undefined column
  "42P01", // undefined table
  "42883", // undefined function
]);

type AnyError = any;


function assertNotBroken(error: AnyError, what: string) {
  if (!error) return;
  expect(
    BROKEN_TEST_CODES.has(error.code),
    `${what}: the request itself is invalid (${error.code}: ${error.message})`,
  ).toBe(false);
  expect(
    /fetch failed|ECONNREFUSED|network/i.test(String(error.message ?? "")),
    `${what}: network error, not an authorization result`,
  ).toBe(false);
}

function assertDenied(error: AnyError, what: string) {
  expect(error, `${what}: expected an authorization denial, got success`).toBeTruthy();
  assertNotBroken(error, what);
  expect(
    ["42501", "PGRST301", "PGRST116", "401", "403"].includes(String(error.code)),
    `${what}: expected a permission denial, got ${error.code}: ${error.message}`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------

describeIntegration("anon is denied on every privileged table", () => {
  const DENIED_TABLES = [
    { table: "optimized_selections", key: "id" },
    { table: "safe_zone_picks", key: "id" },
    { table: "team_totals_candidates", key: "id" },
    { table: "performance_weights", key: "id" },
    { table: "user_entitlements", key: "user_id" },
    { table: "generated_tickets", key: "id" },
    { table: "ticket_outcomes", key: "ticket_id" }, // composite-free PK is ticket_id
    { table: "ticket_leg_outcomes", key: "id" },
    { table: "market_leaderboard_snapshots", key: "user_id" },
  ] as const;

  for (const { table, key } of DENIED_TABLES) {
    it(`anon cannot read ${table} (correct key: ${key})`, async () => {
      const { data, error } = await (anonClient as AnyError).from(table).select(key).limit(1);
      assertNotBroken(error, `${table}.select(${key})`);
      if (error) expect(["42501", "PGRST301"]).toContain(String(error.code));
      else expect(data).toEqual([]);
    });
  }
});

describeIntegration("anon can read genuinely public reference data", () => {
  for (const table of ["fixtures", "leagues", "countries"] as const) {
    it(`anon can read ${table}`, async () => {
      const { data, error } = await (anonClient as AnyError).from(table).select("id").limit(1);
      assertNotBroken(error, `${table}.select(id)`);
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });
  }
});

describeIntegration("premium edge functions deny unauthenticated callers", () => {
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
    it(`${fn} answers 401 or 402 to a seeded valid request`, async () => {
      const { error } = await anonClient.functions.invoke(fn, {
        // A structurally valid body: a rejection must come from authorization,
        // not from a validation error or a crash.
        body: { fixture_id: SEED.fixtureId, confirm: false, limit: 1 },
      });
      expect(error, `${fn}: expected a denial`).toBeTruthy();
      const status = Number((error as AnyError)?.context?.status ?? 0);
      expect(
        [401, 402, 403].includes(status),
        `${fn}: expected 401/402/403, got ${status || (error as AnyError)?.message}`,
      ).toBe(true);
    });
  }
});

describeIntegration("anon cannot execute privileged routines (valid arguments)", () => {
  const CALLS: Array<[string, Record<string, unknown>]> = [
    ["get_market_leaderboard", { p_limit: 5 }],
    ["is_user_subscriber", { check_user_id: "00000000-0000-0000-0000-000000000000" }],
    ["try_use_feature", { feature_key: "bet_optimizer" }],
    ["preview_settlement_holds_v3", { p_limit: 1 }],
    ["apply_settlement_holds_v3", { p_limit: 1, p_expected_leg_ids: [], p_snapshot_hash: "x" }],
    ["release_settlement_holds_v3", { p_limit: 1, p_expected_leg_ids: [], p_snapshot_hash: "x" }],
    ["claim_scorable_ticket_legs", { batch_limit: 1 }],
    ["has_role", { _user_id: "00000000-0000-0000-0000-000000000000", _role: "admin" }],
  ];

  for (const [fn, args] of CALLS) {
    it(`anon cannot execute ${fn}`, async () => {
      const { error } = await (anonClient as AnyError).rpc(fn, args);
      assertDenied(error, `rpc ${fn}`);
      expect(String(error.code)).toBe("42501");
    });
  }

  it("get_market_aggregates is the only anon routine and leaks no user ids", async () => {
    const { data, error } = await (anonClient as AnyError).rpc("get_market_aggregates", {
      _market_id: SEED.marketId,
    });
    assertNotBroken(error, "rpc get_market_aggregates");
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

describeIntegration("anon cannot write persisted ticket history", () => {
  const WRITES: Array<[string, Record<string, unknown>, string]> = [
    ["generated_tickets", { id: SEED.ticketA, user_id: null, legs: [], total_odds: 1.5, min_target: 1.4, max_target: 2.0 }, "id"],
    ["ticket_outcomes", { ticket_id: SEED.ticketA, user_id: null, legs_total: 2, total_odds: 2.1, ticket_status: "WON" }, "ticket_id"],
    ["ticket_leg_outcomes", { id: SEED.legA, ticket_id: SEED.ticketA, user_id: null, fixture_id: SEED.fixtureId, market: "goals", side: "over", line: 1.5, odds: 1.4, selection_key: "over_1_5", selection: "Over 1.5", result_status: "WIN" }, "id"],
  ];

  for (const [table, row, key] of WRITES) {
    it(`anon cannot insert a schema-valid row into ${table}`, async () => {
      const { error } = await (anonClient as AnyError).from(table).insert(row);
      assertDenied(error, `${table}.insert`);
    });

    it(`anon cannot update ${table}`, async () => {
      const { data, error } = await (anonClient as AnyError)
        .from(table)
        .update({ [key]: row[key] })
        .eq(key, row[key])
        .select();
      assertNotBroken(error, `${table}.update`);
      if (error) expect(["42501", "PGRST301"]).toContain(String(error.code));
      else expect(data).toEqual([]);
    });

    it(`anon cannot delete from ${table}`, async () => {
      const { data, error } = await (anonClient as AnyError)
        .from(table)
        .delete()
        .eq(key, row[key])
        .select();
      assertNotBroken(error, `${table}.delete`);
      if (error) expect(["42501", "PGRST301"]).toContain(String(error.code));
      else expect(data).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Authenticated ownership: user A must never reach user B, and the persisted
// history must survive a rejected client delete.
// ---------------------------------------------------------------------------

describeUsers("authenticated ownership and child-row preservation", () => {
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let userAId = "";
  let userBId = "";

  beforeAll(async () => {
    clientA = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    clientB = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });

    const a = await clientA.auth.signInWithPassword({ email: USER_A.email!, password: USER_A.password! });
    const b = await clientB.auth.signInWithPassword({ email: USER_B.email!, password: USER_B.password! });
    expect(a.error, `staging user A sign-in failed: ${a.error?.message}`).toBeNull();
    expect(b.error, `staging user B sign-in failed: ${b.error?.message}`).toBeNull();
    userAId = a.data.user!.id;
    userBId = b.data.user!.id;
    expect(userAId).not.toBe(userBId);
  });

  it("user A sees only their own tickets", async () => {
    const { data, error } = await (clientA as AnyError)
      .from("generated_tickets")
      .select("id,user_id")
      .limit(100);
    assertNotBroken(error, "A generated_tickets.select");
    expect(error).toBeNull();
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) expect(row.user_id).toBe(userAId);
    expect(data.map((r: AnyError) => r.id)).toContain(SEED.ticketA);
  });

  it("user A cannot fetch user B's ticket by its exact id", async () => {
    const { data, error } = await (clientA as AnyError)
      .from("generated_tickets")
      .select("id")
      .eq("id", SEED.ticketB);
    assertNotBroken(error, "A reads B ticket");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user A cannot reach user B's legs through a nested select or a cursor", async () => {
    const nested = await (clientA as AnyError)
      .from("ticket_leg_outcomes")
      .select("id,ticket_id,generated_tickets(id,user_id)")
      .eq("ticket_id", SEED.ticketB);
    assertNotBroken(nested.error, "A nested read of B legs");
    expect(nested.data ?? []).toEqual([]);

    const paged = await (clientA as AnyError)
      .from("ticket_leg_outcomes")
      .select("id,user_id")
      .range(0, 999);
    assertNotBroken(paged.error, "A paginated leg read");
    for (const row of paged.data ?? []) expect(row.user_id).toBe(userAId);
  });

  it("user B cannot update or delete user A's leg", async () => {
    const upd = await (clientB as AnyError)
      .from("ticket_leg_outcomes")
      .update({ result_status: "WIN" })
      .eq("id", SEED.legA)
      .select();
    assertNotBroken(upd.error, "B updates A leg");
    if (upd.error) expect(["42501", "PGRST301"]).toContain(String(upd.error.code));
    else expect(upd.data).toEqual([]);

    const del = await (clientB as AnyError)
      .from("ticket_leg_outcomes")
      .delete()
      .eq("id", SEED.legA)
      .select();
    assertNotBroken(del.error, "B deletes A leg");
    if (del.error) expect(["42501", "PGRST301"]).toContain(String(del.error.code));
    else expect(del.data).toEqual([]);
  });

  it("a rejected parent delete leaves the parent and its child rows intact", async () => {
    const before = await (clientA as AnyError)
      .from("ticket_leg_outcomes")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", SEED.ticketA);
    assertNotBroken(before.error, "A counts own legs");
    expect(before.count).toBeGreaterThan(0);

    const del = await (clientA as AnyError)
      .from("generated_tickets")
      .delete()
      .eq("id", SEED.ticketA)
      .select();
    assertNotBroken(del.error, "A deletes own ticket");
    if (del.error) expect(["42501", "PGRST301"]).toContain(String(del.error.code));
    else expect(del.data).toEqual([]);

    const parent = await (clientA as AnyError)
      .from("generated_tickets")
      .select("id")
      .eq("id", SEED.ticketA);
    expect(parent.data).toHaveLength(1);

    const after = await (clientA as AnyError)
      .from("ticket_leg_outcomes")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", SEED.ticketA);
    expect(after.count).toBe(before.count);
  });

  it("an authenticated user cannot execute service-role settlement routines", async () => {
    for (const [fn, args] of [
      ["claim_scorable_ticket_legs", { batch_limit: 1 }],
      ["finalize_scored_ticket_leg", { p_leg_id: SEED.legA, p_claim_token: SEED.ticketA, p_result_status: "WIN", p_actual_value: 3, p_scored_version: "test", p_result_fingerprint: "x" }],
      ["apply_settlement_holds_v3", { p_limit: 1, p_expected_leg_ids: [], p_snapshot_hash: "x" }],
    ] as Array<[string, Record<string, unknown>]>) {
      const { error } = await (clientA as AnyError).rpc(fn, args);
      assertDenied(error, `authenticated rpc ${fn}`);
    }
  });

  it("a self-service routine works for the caller and never for another user", async () => {
    const mine = await (clientA as AnyError).rpc("get_trial_credits");
    assertNotBroken(mine.error, "A get_trial_credits");

    const other = await (clientA as AnyError).rpc("is_user_subscriber", { check_user_id: userBId });
    assertNotBroken(other.error, "A probes B subscription");
    if (!other.error) expect(other.data === true).toBe(false);
  });
});
