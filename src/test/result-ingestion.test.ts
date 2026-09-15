import { describe, it, expect, vi } from "vitest";
import {
  authorizeIngestionRequest,
  buildTargetedBudget,
  constantTimeEquals,
  extractTeamStats,
  parseProviderFixture,

  parseProviderId,
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

describe("RC3.2 — identifier parsing and statistics rejection", () => {
  it("accepts legitimate numeric-string identifiers", () => {
    expect(parseProviderId("1401863")).toBe(1401863);
    expect(parseProviderId(" 42 ")).toBe(42);
    expect(parseProviderId(42)).toBe(42);
  });

  it("rejects malformed identifiers instead of coercing them", () => {
    for (const bad of ["", " ", "12a", "1.5", "-7", "0", 0, -1, 1.5, true, null, undefined, {}, []]) {
      expect(parseProviderId(bad as unknown)).toBeNull();
    }
  });

  it("parses a fixture whose ids arrive as numeric strings", () => {
    const payload = fixturePayload(1001, {
      fixture: { id: "1001", timestamp: 1_700_000_000, status: { short: "FT" } },
      league: { id: "39" },
      teams: { home: { id: "1" }, away: { id: "2" } },
    });
    const parsed = parseProviderFixture(payload.response[0], 1001);
    expect(parsed).toMatchObject({ fixture_id: 1001, league_id: 39, home_team_id: 1, away_team_id: 2 });
  });

  it("rejects a malformed team id rather than falling back to names", () => {
    const payload = fixturePayload(1001, { teams: { home: { id: "1a", name: "A" }, away: { id: 2, name: "B" } } });
    expect(() => parseProviderFixture(payload.response[0], 1001)).toThrow(ValidationError);
  });

  it("rejects an empty statistics payload instead of writing all-null statistics", async () => {
    const fetchImpl = async (url: string) =>
      url.includes("statistics") ? jsonResponse({ response: [] }) : jsonResponse(fixturePayload(1001));
    const { outcome, writes } = await runWith(fetchImpl, { stats: true });
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "invalid_statistics" });
    expect(writes).toHaveLength(0);
  });

  it("rejects a statistics payload belonging to the wrong teams", async () => {
    const wrongTeams = {
      response: [
        { team: { id: 77 }, statistics: [{ type: "Corner Kicks", value: 5 }] },
        { team: { id: 88 }, statistics: [{ type: "Corner Kicks", value: 6 }] },
      ],
    };
    const fetchImpl = async (url: string) =>
      url.includes("statistics") ? jsonResponse(wrongTeams) : jsonResponse(fixturePayload(1001));
    const { outcome, writes } = await runWith(fetchImpl, { stats: true });
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "invalid_statistics" });
    expect(writes).toHaveLength(0);
  });

  it("rejects a malformed statistics envelope", async () => {
    const fetchImpl = async (url: string) =>
      url.includes("statistics") ? jsonResponse({ response: [{ nope: true }, { nope: true }] }) : jsonResponse(fixturePayload(1001));
    const { outcome, writes } = await runWith(fetchImpl, { stats: true });
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "invalid_statistics" });
    expect(writes).toHaveLength(0);
  });

  it("accepts numeric-string statistic values and numeric-string team ids", async () => {
    const stringStats = {
      response: [
        { team: { id: "1" }, statistics: [{ type: "Corner Kicks", value: "7" }, { type: "Yellow Cards", value: "2" }, { type: "Red Cards", value: "0" }] },
        { team: { id: "2" }, statistics: [{ type: "Corner Kicks", value: "3" }, { type: "Yellow Cards", value: "1" }, { type: "Red Cards", value: "1" }] },
      ],
    };
    const fetchImpl = async (url: string) =>
      url.includes("statistics") ? jsonResponse(stringStats) : jsonResponse(fixturePayload(1001));
    const { outcome, writes } = await runWith(fetchImpl, { stats: true });
    expect(outcome).toMatchObject({ success: true, state: "written" });
    expect(writes[0].stats).toMatchObject({ corners_home: 7, cards_home: 2, corners_away: 3, cards_away: 2 });
  });

  it("treats a non-numeric statistic value as unknown, never as zero", async () => {
    const dirty = {
      response: [
        { team: { id: 1 }, statistics: [{ type: "Corner Kicks", value: "n/a" }, { type: "Yellow Cards", value: 1 }, { type: "Red Cards", value: 0 }] },
        { team: { id: 2 }, statistics: [{ type: "Corner Kicks", value: 3 }, { type: "Yellow Cards", value: 1 }, { type: "Red Cards", value: 0 }] },
      ],
    };
    const fetchImpl = async (url: string) =>
      url.includes("statistics") ? jsonResponse(dirty) : jsonResponse(fixturePayload(1001));
    const { writes } = await runWith(fetchImpl, { stats: true });
    expect(writes[0].stats.corners_home).toBeNull();
    expect(writes[0].stats.corners_away).toBe(3);
  });
});

/**
 * RC3.3 — a requested statistics payload must be unambiguous or rejected, and
 * a systemic validation failure must stop every subsequent provider call.
 */
describe("RC3.3 — statistics request validation and circuit latching", () => {
  const withStats = (statsBody: unknown) => async (url: string) =>
    url.includes("statistics") ? jsonResponse(statsBody) : jsonResponse(fixturePayload(1001));

  it("rejects a null statistics response instead of writing goals with no statistics", async () => {
    const { outcome, writes } = await runWith(withStats({ response: null }), { stats: true });
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "invalid_statistics" });
    expect(writes).toHaveLength(0);
  });

  it("rejects empty team statistics arrays", async () => {
    const { outcome, writes } = await runWith(
      withStats({ response: [{ team: { id: 1 }, statistics: [] }, { team: { id: 2 }, statistics: [] }] }),
      { stats: true },
    );
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "invalid_statistics" });
    expect(writes).toHaveLength(0);
  });

  it("rejects an empty statistics array on a single side", async () => {
    const { outcome, writes } = await runWith(
      withStats({
        response: [
          { team: { id: 1 }, statistics: [{ type: "Corner Kicks", value: 7 }] },
          { team: { id: 2 }, statistics: [] },
        ],
      }),
      { stats: true },
    );
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "invalid_statistics" });
    expect(writes).toHaveLength(0);
  });

  it("rejects conflicting duplicate team records rather than taking the first", async () => {
    const { outcome, writes } = await runWith(
      withStats({
        response: [
          { team: { id: 1 }, statistics: [{ type: "Corner Kicks", value: 7 }] },
          { team: { id: 1 }, statistics: [{ type: "Corner Kicks", value: 2 }] },
          { team: { id: 2 }, statistics: [{ type: "Corner Kicks", value: 3 }] },
        ],
      }),
      { stats: true },
    );
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "invalid_statistics" });
    expect(writes).toHaveLength(0);
  });

  it("requires unambiguous attribution: a duplicated away record is also rejected", () => {
    expect(() =>
      extractTeamStats(
        [
          { team: { id: 1 }, statistics: [{ type: "Corner Kicks", value: 7 }] },
          { team: { id: 2 }, statistics: [{ type: "Corner Kicks", value: 3 }] },
          { team: { id: "2" }, statistics: [{ type: "Corner Kicks", value: 9 }] },
        ],
        1,
        2,
      )
    ).toThrow(ValidationError);
  });

  it("latches the circuit so no further provider call is made in the run", async () => {
    const fetchImpl = vi.fn(withStats({ response: null }));
    const { outcome, writes, session: s } = await runWith(fetchImpl, { stats: true });
    expect(outcome.success).toBe(false);
    expect(writes).toHaveLength(0);
    expect(s.stopped).toBe("provider_invalid_schema");
    await expect(s.get(`${API_BASE}/fixtures?id=1002`)).rejects.toBeInstanceOf(ProviderStopError);
    // Exactly the two calls of this fixture: nothing after the latch.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("RC3.4 — statistic entry validation", () => {
  const withStats = (statsBody: unknown) => async (url: string) =>
    url.includes("statistics") ? jsonResponse(statsBody) : jsonResponse(fixturePayload(1001));

  const sides = (homeEntries: unknown[], awayEntries: unknown[] = [{ type: "Corner Kicks", value: 3 }]) => [
    { team: { id: 1 }, statistics: homeEntries },
    { team: { id: 2 }, statistics: awayEntries },
  ];

  it("rejects a malformed statistic entry", () => {
    expect(() => extractTeamStats(sides(["Corner Kicks: 7"]), 1, 2)).toThrow(ValidationError);
    expect(() => extractTeamStats(sides([null]), 1, 2)).toThrow(ValidationError);
    expect(() => extractTeamStats(sides([{ value: 7 }]), 1, 2)).toThrow(ValidationError);
    expect(() => extractTeamStats(sides([{ type: "   ", value: 7 }]), 1, 2)).toThrow(ValidationError);
  });

  it("rejects invalid statistic values instead of storing null", () => {
    for (const bad of [-3, 4.5, "12a", true, {}, Number.NaN]) {
      expect(() => extractTeamStats(sides([{ type: "Corner Kicks", value: bad }]), 1, 2))
        .toThrow(ValidationError);
    }
  });

  it("rejects conflicting duplicate statistic types within one side", () => {
    expect(() =>
      extractTeamStats(
        sides([
          { type: "Corner Kicks", value: 7 },
          { type: "Corner Kicks", value: 2 },
        ]),
        1,
        2,
      )
    ).toThrow(ValidationError);
  });

  it("tolerates an identical duplicate statistic type", () => {
    const out = extractTeamStats(
      sides([
        { type: "Corner Kicks", value: 7 },
        { type: "Corner Kicks", value: 7 },
      ]),
      1,
      2,
    );
    expect(out.corners_home).toBe(7);
    expect(out.corners_away).toBe(3);
  });

  it("requires usable attributed statistics on both sides", () => {
    expect(() =>
      extractTeamStats(sides([{ type: "Ball Possession", value: "55%" }]), 1, 2)
    ).toThrow(ValidationError);
    expect(() =>
      extractTeamStats(
        sides([{ type: "Corner Kicks", value: 7 }], [{ type: "Corner Kicks", value: null }]),
        1,
        2,
      )
    ).toThrow(ValidationError);
  });

  it("writes nothing and latches the circuit when an entry is invalid", async () => {
    const fetchImpl = vi.fn(
      withStats({
        response: sides([
          { type: "Corner Kicks", value: 7 },
          { type: "Corner Kicks", value: 2 },
        ]),
      }),
    );
    const { outcome, writes, session: s } = await runWith(fetchImpl, { stats: true });
    expect(outcome).toMatchObject({ success: false, state: "invalid_data", reason: "invalid_statistics" });
    expect(writes).toHaveLength(0);
    expect(s.stopped).toBe("provider_invalid_schema");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});





describe("source-level guarantees", () => {
  it("auto-backfill-results routes every write through the atomic transaction RPC", () => {
    expect(autoBackfillSrc).toContain("ingest_fixture_result_tx");
    expect(autoBackfillSrc).not.toContain('.from("fixture_results")');
    expect(autoBackfillSrc).toContain("requireConfirmation");
    expect(autoBackfillSrc).not.toContain("functions.invoke");
    expect(autoBackfillSrc).toContain("scorer_chained: false");
  });

  it("retired endpoints are default-deny with zero writes", () => {
    for (const src of [resultsRefreshSrc, legacyBackfillSrc, adminVoidSrc, backfillOutcomesSrc]) {
      expect(src).toMatch(/410/);
      expect(src).not.toContain(".upsert(");
    }
  });
});
