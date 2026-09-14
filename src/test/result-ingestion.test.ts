import { describe, it, expect, vi } from "vitest";
import {
  authorizeIngestionRequest,
  buildTargetedBudget,
  constantTimeEquals,
  parseProviderFixture,
  ProviderSession,
  ProviderStopError,
  requireConfirmation,
  runTargetedFixtureIngestion,
  validateBoundedInt,
  validateFixtureId,
  ValidationError,
  isTerminalStatus,
  TARGETED_GOALS_ONLY_MAX_CALLS,
  TARGETED_WITH_STATS_MAX_CALLS,
  type IngestionPayload,
} from "../../supabase/functions/_shared/result_ingestion.ts";
import { ProviderCallBudget } from "../../supabase/functions/_shared/provider_budget.ts";
import autoBackfillSrc from "../../supabase/functions/auto-backfill-results/index.ts?raw";
import resultsRefreshSrc from "../../supabase/functions/results-refresh/index.ts?raw";
import legacyBackfillSrc from "../../supabase/functions/backfill-fixture-results/index.ts?raw";
import adminVoidSrc from "../../supabase/functions/admin-void-legs/index.ts?raw";
import backfillOutcomesSrc from "../../supabase/functions/backfill-ticket-outcomes/index.ts?raw";

const API_BASE = "https://v3.football.api-sports.io";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fixturePayload(id: number, overrides: Record<string, unknown> = {}, status = "FT") {
  return {
    response: [{
      fixture: { id, timestamp: 1_700_000_000, status: { short: status } },
      league: { id: 39 },
      teams: { home: { id: 1 }, away: { id: 2 } },
      goals: { home: 2, away: 1 },
      ...overrides,
    }],
  };
}

function statsPayload() {
  return {
    response: [
      { team: { id: 1 }, statistics: [{ type: "Corner Kicks", value: 7 }, { type: "Yellow Cards", value: 2 }, { type: "Red Cards", value: 0 }] },
      { team: { id: 2 }, statistics: [{ type: "Corner Kicks", value: 3 }, { type: "Yellow Cards", value: 1 }, { type: "Red Cards", value: 1 }] },
    ],
  };
}

/** Writer double: records every atomic ingestion, or fails the transaction. */
function makeWriter(opts: { localExists?: boolean; failWrite?: boolean } = {}) {
  const writes: IngestionPayload[] = [];
  return {
    writes,
    writer: {
      loadLocalFixture: async (fixtureId: number) =>
        opts.localExists === false ? null : { id: fixtureId, status: "NS" },
      ingestAtomically: async (payload: IngestionPayload) => {
        if (opts.failWrite) throw new Error("ingest_transaction_failed: rolled back");
        writes.push(payload);
      },
    },
  };
}

function session(fetchImpl: any, limit = 2) {
  return new ProviderSession({ budget: new ProviderCallBudget(limit), fetchImpl, timeoutMs: 50 });
}

async function runWith(fetchImpl: any, opts: { fixtureId?: number; stats?: boolean; writerOpts?: any } = {}) {
  const w = makeWriter(opts.writerOpts ?? {});
  const s = session(fetchImpl);
  const outcome = await runTargetedFixtureIngestion({
    fixtureId: opts.fixtureId ?? 1001,
    apiBase: API_BASE,
    session: s,
    includeStatistics: opts.stats ?? false,
    writer: w.writer,
  });
  return { outcome, writes: w.writes, session: s };
}

// ---------------------------------------------------------------------------

describe("confirmation gate", () => {
  it("rejects a request without confirm_provider_calls", () => {
    expect(() => requireConfirmation({})).toThrow(ValidationError);
  });
  it("accepts an explicit confirmation", () => {
    expect(() => requireConfirmation({ confirm_provider_calls: true })).not.toThrow();
  });
});

describe("input validation", () => {
  it("rejects non-integers", () => {
    expect(() => validateBoundedInt("abc", { name: "x", min: 1, max: 10 })).toThrow(ValidationError);
  });
  it("rejects out-of-range values", () => {
    expect(() => validateBoundedInt(99, { name: "x", min: 1, max: 10 })).toThrow(ValidationError);
  });
  it("rejects a non-positive fixture id", () => {
    expect(() => validateFixtureId(0)).toThrow(ValidationError);
  });
  it("caps the targeted provider budget", () => {
    expect(buildTargetedBudget(false).limit).toBe(TARGETED_GOALS_ONLY_MAX_CALLS);
    expect(buildTargetedBudget(true).limit).toBe(TARGETED_WITH_STATS_MAX_CALLS);
    expect(() => buildTargetedBudget(false, 5)).toThrow(ValidationError);
  });
  it("classifies terminal statuses", () => {
    expect(isTerminalStatus("FT")).toBe(true);
    expect(isTerminalStatus("PST")).toBe(false);
  });
});

describe("constant-time secret comparison", () => {
  it("matches equal secrets and rejects others", () => {
    expect(constantTimeEquals("abc123", "abc123")).toBe(true);
    expect(constantTimeEquals("abc123", "abc124")).toBe(false);
    expect(constantTimeEquals("abc123", "abc1234")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(false);
    expect(constantTimeEquals(null, "abc")).toBe(false);
  });
});

describe("authorization (default deny)", () => {
  it("denies an unauthenticated request", async () => {
    const r = await authorizeIngestionRequest({ serviceRoleKey: "svc" });
    expect(r).toEqual({ authorized: false, method: null });
  });
  it("accepts the service role bearer", async () => {
    const r = await authorizeIngestionRequest({ serviceRoleKey: "svc", authHeader: "Bearer svc" });
    expect(r.method).toBe("service_role");
  });
  it("accepts a matching cron key only", async () => {
    const ok = await authorizeIngestionRequest({
      serviceRoleKey: "svc", cronKeyHeader: "k1", lookupCronKey: async () => "k1",
    });
    expect(ok.method).toBe("cron_key");
    const bad = await authorizeIngestionRequest({
      serviceRoleKey: "svc", cronKeyHeader: "k2", lookupCronKey: async () => "k1",
    });
    expect(bad.authorized).toBe(false);
  });
  it("denies when the admin verifier throws", async () => {
    const r = await authorizeIngestionRequest({
      serviceRoleKey: "svc", authHeader: "Bearer user", verifyAdmin: async () => { throw new Error("boom"); },
    });
    expect(r.authorized).toBe(false);
  });
});

describe("strict provider parser", () => {
  it("rejects a fixture id mismatch", () => {
    expect(() => parseProviderFixture(fixturePayload(999).response[0], 1001)).toThrow(/fixture/);
  });
  it("rejects missing goals on a terminal fixture", () => {
    const raw = fixturePayload(1001, { goals: { home: null, away: null }, score: {} }).response[0];
    expect(() => parseProviderFixture(raw, 1001)).toThrow(ValidationError);
  });
  it("rejects malformed (non-integer, negative) goals", () => {
    const raw = fixturePayload(1001, { goals: { home: -1, away: 1.5 }, score: {} }).response[0];
    expect(() => parseProviderFixture(raw, 1001)).toThrow(ValidationError);
  });
  it("rejects a missing kickoff instead of substituting now", () => {
    const raw = fixturePayload(1001).response[0] as any;
    raw.fixture.timestamp = null;
    expect(() => parseProviderFixture(raw, 1001)).toThrow(/kickoff/);
  });
  it("rejects a missing league id and missing team ids", () => {
    const noLeague = fixturePayload(1001, { league: {} }).response[0];
    expect(() => parseProviderFixture(noLeague, 1001)).toThrow(ValidationError);
    const noTeams = fixturePayload(1001, { teams: { home: {}, away: {} } }).response[0];
    expect(() => parseProviderFixture(noTeams, 1001)).toThrow(ValidationError);
  });
  it("accepts a valid terminal fixture", () => {
    const parsed = parseProviderFixture(fixturePayload(1001).response[0], 1001);
    expect(parsed).toMatchObject({ fixture_id: 1001, league_id: 39, terminal: true, goals_home: 2, goals_away: 1 });
  });
});

describe("provider session circuit breaker (zero retries)", () => {
  const cases: Array<[string, number, string]> = [
    ["401", 401, "provider_unauthorized"],
    ["403", 403, "provider_unauthorized"],
    ["404", 404, "provider_client_error"],
    ["429", 429, "provider_rate_limited"],
    ["500", 500, "provider_server_error"],
  ];
  for (const [label, status, kind] of cases) {
    it(`stops immediately on ${label}`, async () => {
      const fetchImpl = vi.fn(async () => new Response("", { status }));
      const s = session(fetchImpl);
      await expect(s.get(`${API_BASE}/fixtures?id=1`)).rejects.toMatchObject({ kind });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(s.stopped).toBe(kind);
    });
  }

  it("stops on malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 200 }));
    const s = session(fetchImpl);
    await expect(s.get(`${API_BASE}/fixtures?id=1`)).rejects.toMatchObject({ kind: "provider_malformed_json" });
  });

  it("stops on a network failure", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNRESET"); });
    const s = session(fetchImpl);
    await expect(s.get(`${API_BASE}/fixtures?id=1`)).rejects.toMatchObject({ kind: "provider_network_error" });
  });

  it("aborts and stops on timeout", async () => {
    const fetchImpl = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }));
    const s = session(fetchImpl);
    await expect(s.get(`${API_BASE}/fixtures?id=1`)).rejects.toMatchObject({ kind: "provider_timeout" });
  });

  it("stops when the call budget is exhausted", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fixturePayload(1)));
    const s = new ProviderSession({ budget: new ProviderCallBudget(1), fetchImpl, timeoutMs: 50 });
    await s.get(`${API_BASE}/a`);
    await expect(s.get(`${API_BASE}/b`)).rejects.toBeInstanceOf(ProviderStopError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("targeted ingestion — zero writes on every unsafe path", () => {
  it("refuses a fixture that does not exist locally, without a provider call", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fixturePayload(1001)));
    const { outcome, writes } = await runWith(fetchImpl, { writerOpts: { localExists: false } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ success: false, state: "unknown_local_fixture" });
    expect(writes).toHaveLength(0);
  });

  it("writes nothing when the provider returns a different fixture", async () => {
    const { outcome, writes } = await runWith(async () => jsonResponse(fixturePayload(2002)));
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "fixture_id_mismatch" });
    expect(writes).toHaveLength(0);
  });

  it("writes nothing for an empty provider response", async () => {
    const { outcome, writes } = await runWith(async () => jsonResponse({ response: [] }));
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "no_provider_data" });
    expect(writes).toHaveLength(0);
  });

  it("writes nothing for malformed JSON", async () => {
    const { outcome, writes } = await runWith(async () => new Response("<html>", { status: 200 }));
    expect(outcome).toMatchObject({ success: false, state: "provider_error", reason: "provider_malformed_json" });
    expect(writes).toHaveLength(0);
  });

  it("writes nothing when goals are missing on a terminal fixture", async () => {
    const payload = fixturePayload(1001, { goals: { home: null, away: null }, score: {} });
    const { outcome, writes } = await runWith(async () => jsonResponse(payload));
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "incomplete_score" });
    expect(writes).toHaveLength(0);
  });

  it("writes nothing when the kickoff timestamp is invalid", async () => {
    const payload = fixturePayload(1001);
    (payload.response[0] as any).fixture.timestamp = "yesterday";
    const { outcome, writes } = await runWith(async () => jsonResponse(payload));
    expect(outcome).toMatchObject({ success: false, reason: "invalid_kickoff" });
    expect(writes).toHaveLength(0);
  });

  it("reports a non-terminal fixture as an explicit no-change state", async () => {
    const payload = fixturePayload(1001, {}, "PST");
    const { outcome, writes } = await runWith(async () => jsonResponse(payload));
    expect(outcome.success).toBe(false);
    expect(outcome.state).toBe("non_terminal_no_change");
    expect(writes).toHaveLength(0);
  });

  it("reports a failed transaction as unsuccessful and records no write", async () => {
    const { outcome, writes } = await runWith(async () => jsonResponse(fixturePayload(1001)), {
      writerOpts: { failWrite: true },
    });
    expect(outcome).toMatchObject({ success: false, state: "write_failed" });
    expect(writes).toHaveLength(0);
  });

  it("stops without writing on a 429", async () => {
    const { outcome, writes } = await runWith(async () => new Response("", { status: 429 }));
    expect(outcome).toMatchObject({ success: false, state: "provider_error", stop_reason: "provider_rate_limited" });
    expect(writes).toHaveLength(0);
  });

  it("persists identity, status, kickoff and goals in one atomic payload", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("statistics") ? jsonResponse(statsPayload()) : jsonResponse(fixturePayload(1001)));
    const { outcome, writes } = await runWith(fetchImpl, { stats: true });
    expect(outcome).toMatchObject({ success: true, state: "written", result_written: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      fixture_id: 1001,
      league_id: 39,
      status: "FT",
      home_team_id: 1,
      away_team_id: 2,
      goals_home: 2,
      goals_away: 1,
    });
    // Authoritative kickoff comes from the provider timestamp, never from "now".
    expect(writes[0].kickoff_at).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(writes[0].stats.corners_home).toBe(7);
  });

  it("handles a schedule movement by writing the provider kickoff, not the stale local one", async () => {
    const moved = fixturePayload(1001);
    (moved.response[0] as any).fixture.timestamp = 1_705_000_000;
    const { writes } = await runWith(async () => jsonResponse(moved));
    expect(writes[0].kickoff_at).toBe(new Date(1_705_000_000 * 1000).toISOString());
  });

  it("records inverted team identity exactly as the provider reports it", async () => {
    const inverted = fixturePayload(1001, { teams: { home: { id: 2 }, away: { id: 1 } } });
    const { writes } = await runWith(async () => jsonResponse(inverted));
    expect(writes[0]).toMatchObject({ home_team_id: 2, away_team_id: 1 });
  });

  it("never defaults a missing statistic to zero", async () => {
    const partialStats = {
      response: [
        { team: { id: 1 }, statistics: [{ type: "Corner Kicks", value: null }] },
        { team: { id: 2 }, statistics: [{ type: "Corner Kicks", value: 4 }] },
      ],
    };
    const fetchImpl = async (url: string) =>
      url.includes("statistics") ? jsonResponse(partialStats) : jsonResponse(fixturePayload(1001));
    const { writes } = await runWith(fetchImpl, { stats: true });
    expect(writes[0].stats.corners_home).toBeNull();
    expect(writes[0].stats.cards_home).toBeNull();
    expect(writes[0].stats.corners_away).toBe(4);
  });
});

describe("source-level guarantees", () => {
  it("auto-backfill-results routes every write through the atomic transaction RPC", () => {
    expect(autoBackfillSrc).toContain("ingest_fixture_result_tx");
    expect(autoBackfillSrc).not.toContain('.from("fixture_results")');
    expect(autoBackfillSrc).toContain("requireConfirmation");
    expect(autoBackfillSrc).not.toContain("score-ticket-legs");
  });

  it("retired endpoints are default-deny with zero writes", () => {
    for (const src of [resultsRefreshSrc, legacyBackfillSrc, adminVoidSrc, backfillOutcomesSrc]) {
      expect(src).toMatch(/410/);
      expect(src).not.toContain(".upsert(");
    }
  });
});
