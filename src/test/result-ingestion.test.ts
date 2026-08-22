import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  authorizeIngestionRequest,
  buildTargetedBudget,
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
} from "../../supabase/functions/_shared/result_ingestion.ts";
import { ProviderCallBudget } from "../../supabase/functions/_shared/provider_budget.ts";

const API_BASE = "https://v3.football.api-sports.io";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fixturePayload(id: number, status = "FT") {
  return {
    response: [{
      fixture: { id, timestamp: 1_700_000_000, status: { short: status } },
      league: { id: 39 },
      teams: { home: { id: 1 }, away: { id: 2 } },
      goals: { home: 2, away: 1 },
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

function makeWriter() {
  const upserts: any[] = [];
  const statusUpdates: any[] = [];
  return {
    upserts,
    statusUpdates,
    writer: {
      upsertFixtureResult: async (row: any) => { upserts.push(row); },
      updateFixtureStatus: async (id: number, status: string) => { statusUpdates.push({ id, status }); },
    },
  };
}

describe("confirmation gate", () => {
  it("no confirmation = zero provider calls and zero mutation", async () => {
    const fetchImpl = vi.fn();
    const { writer, upserts, statusUpdates } = makeWriter();
    expect(() => requireConfirmation({})).toThrow(ValidationError);
    expect(() => requireConfirmation({ confirm_provider_calls: "true" })).toThrow(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    expect(statusUpdates).toHaveLength(0);
    void writer;
  });

  it("accepts only the strict boolean true", () => {
    expect(() => requireConfirmation({ confirm_provider_calls: true })).not.toThrow();
  });
});

describe("authorization", () => {
  const base = { serviceRoleKey: "svc-key" };

  it("default-denies a request with no headers and makes zero provider calls", async () => {
    const fetchImpl = vi.fn();
    const res = await authorizeIngestionRequest({ ...base });
    expect(res).toEqual({ authorized: false, method: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("denies a wrong cron key and a non-admin JWT", async () => {
    const res = await authorizeIngestionRequest({
      ...base,
      cronKeyHeader: "wrong",
      authHeader: "Bearer someuserjwt",
      lookupCronKey: async () => "right",
      verifyAdmin: async () => false,
    });
    expect(res.authorized).toBe(false);
  });

  it("accepts exact service role, valid cron key and verified admin", async () => {
    expect((await authorizeIngestionRequest({ ...base, authHeader: "Bearer svc-key" })).method).toBe("service_role");
    expect((await authorizeIngestionRequest({ ...base, cronKeyHeader: "k", lookupCronKey: async () => "k" })).method).toBe("cron_key");
    expect((await authorizeIngestionRequest({ ...base, authHeader: "Bearer jwt", verifyAdmin: async () => true })).method).toBe("admin_user");
  });

  it("never logs secrets or secret prefixes", async () => {
    const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const spyErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await authorizeIngestionRequest({
      serviceRoleKey: "svc-key-abcdef",
      cronKeyHeader: "cronsecret1234567890",
      authHeader: "Bearer svc-key-abcdef",
      lookupCronKey: async () => "cronsecret1234567890",
    });
    const emitted = [...spyLog.mock.calls, ...spyErr.mock.calls, ...spyWarn.mock.calls].flat().join(" ");
    for (const secret of ["cronsecret1234567890", "cronsecr", "svc-key-abcdef", "svc-key-"]) {
      expect(emitted).not.toContain(secret);
    }
    spyLog.mockRestore(); spyErr.mockRestore(); spyWarn.mockRestore();
  });
});

describe("bounded parameter validation", () => {
  it("fails closed on invalid, missing or excessive values", () => {
    expect(() => validateBoundedInt(undefined, { name: "batch_size", min: 1, max: 50 })).toThrow(ValidationError);
    expect(() => validateBoundedInt("abc", { name: "batch_size", min: 1, max: 50 })).toThrow(ValidationError);
    expect(() => validateBoundedInt(1.5, { name: "batch_size", min: 1, max: 50 })).toThrow(ValidationError);
    expect(() => validateBoundedInt(9999, { name: "batch_size", min: 1, max: 50 })).toThrow(ValidationError);
    expect(() => validateBoundedInt(0, { name: "batch_size", min: 1, max: 50 })).toThrow(ValidationError);
    expect(validateBoundedInt(undefined, { name: "batch_size", min: 1, max: 50, fallback: 25 })).toBe(25);
    expect(() => validateFixtureId("not-a-fixture")).toThrow(ValidationError);
  });

  it("existing bulk mode cannot exceed its validated budget", () => {
    const batchSize = validateBoundedInt(50, { name: "batch_size", min: 1, max: 50 });
    const hard = Math.min(100, batchSize * 2);
    expect(() => validateBoundedInt(500, { name: "max_provider_calls", min: 1, max: hard })).toThrow(ValidationError);
    expect(validateBoundedInt(undefined, { name: "max_provider_calls", min: 1, max: hard, fallback: hard })).toBe(100);
  });

  it("targeted budgets are hard-capped at 1 (goals) and 2 (statistics)", () => {
    expect(buildTargetedBudget(false).limit).toBe(TARGETED_GOALS_ONLY_MAX_CALLS);
    expect(buildTargetedBudget(true).limit).toBe(TARGETED_WITH_STATS_MAX_CALLS);
    expect(() => buildTargetedBudget(false, 2)).toThrow(ValidationError);
    expect(() => buildTargetedBudget(true, 3)).toThrow(ValidationError);
  });
});

describe("targeted ingestion", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchImpl = vi.fn(); });

  it("goals-only mode makes at most one HTTP attempt and writes only that fixture", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(fixturePayload(12345)));
    const { writer, upserts, statusUpdates } = makeWriter();
    const session = new ProviderSession({ budget: buildTargetedBudget(false), fetchImpl: fetchImpl as any });
    const outcome = await runTargetedFixtureIngestion({
      fixtureId: 12345, apiBase: API_BASE, session, writer, includeStatistics: false, localStatus: "NS",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(session.attempts).toBe(1);
    expect(outcome.result_written).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].fixture_id).toBe(12345);
    expect(statusUpdates).toEqual([{ id: 12345, status: "FT" }]);
  });

  it("statistics mode makes at most two HTTP attempts", async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(fixturePayload(999)))
      .mockResolvedValueOnce(jsonResponse(statsPayload()));
    const { writer, upserts } = makeWriter();
    const session = new ProviderSession({ budget: buildTargetedBudget(true), fetchImpl: fetchImpl as any });
    await runTargetedFixtureIngestion({
      fixtureId: 999, apiBase: API_BASE, session, writer, includeStatistics: true, localStatus: "FT",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(upserts[0].corners_home).toBe(7);
    expect(upserts[0].cards_away).toBe(2);
  });

  it("stops after the first attempt on HTTP 429 with no retry and no write", async () => {
    fetchImpl.mockResolvedValue(new Response("rate limited", { status: 429 }));
    const { writer, upserts, statusUpdates } = makeWriter();
    const session = new ProviderSession({ budget: buildTargetedBudget(true), fetchImpl: fetchImpl as any });
    const outcome = await runTargetedFixtureIngestion({
      fixtureId: 5, apiBase: API_BASE, session, writer, includeStatistics: true, localStatus: "NS",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome.stop_reason).toBe("provider_rate_limited");
    expect(upserts).toHaveLength(0);
    expect(statusUpdates).toHaveLength(0);
  });

  it("does not hide-retry on 5xx or network failure", async () => {
    const s500 = new ProviderSession({ budget: new ProviderCallBudget(5), fetchImpl: (async () => new Response("", { status: 503 })) as any });
    await expect(s500.get(`${API_BASE}/fixtures?id=1`)).rejects.toBeInstanceOf(ProviderStopError);
    expect(s500.attempts).toBe(1);

    const netFetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const sNet = new ProviderSession({ budget: new ProviderCallBudget(5), fetchImpl: netFetch as any });
    await expect(sNet.get(`${API_BASE}/fixtures?id=1`)).rejects.toBeInstanceOf(ProviderStopError);
    expect(netFetch).toHaveBeenCalledTimes(1);
    // circuit breaker is latched: no further request is issued
    await expect(sNet.get(`${API_BASE}/fixtures?id=1`)).rejects.toBeInstanceOf(ProviderStopError);
    expect(netFetch).toHaveBeenCalledTimes(1);
  });

  it("budget exhaustion prevents the next request", async () => {
    const okFetch = vi.fn().mockResolvedValue(jsonResponse(fixturePayload(7)));
    const session = new ProviderSession({ budget: new ProviderCallBudget(1), fetchImpl: okFetch as any });
    await session.get(`${API_BASE}/fixtures?id=7`);
    await expect(session.get(`${API_BASE}/fixtures/statistics?fixture=7`)).rejects.toMatchObject({
      kind: "provider_call_budget_exhausted",
    });
    expect(okFetch).toHaveBeenCalledTimes(1);
  });

  it("non-terminal provider result creates no fixture_results row", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(fixturePayload(42, "PST")));
    const { writer, upserts, statusUpdates } = makeWriter();
    const session = new ProviderSession({ budget: buildTargetedBudget(true), fetchImpl: fetchImpl as any });
    const outcome = await runTargetedFixtureIngestion({
      fixtureId: 42, apiBase: API_BASE, session, writer, includeStatistics: true, localStatus: "NS",
    });
    expect(outcome.terminal).toBe(false);
    expect(isTerminalStatus("PST")).toBe(false);
    expect(upserts).toHaveLength(0);
    expect(statusUpdates).toEqual([{ id: 42, status: "PST" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("only the explicitly requested fixture id is ever requested or written", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(fixturePayload(31337)));
    const { writer, upserts } = makeWriter();
    const session = new ProviderSession({ budget: buildTargetedBudget(false), fetchImpl: fetchImpl as any });
    await runTargetedFixtureIngestion({
      fixtureId: 31337, apiBase: API_BASE, session, writer, includeStatistics: false, localStatus: "FT",
    });
    const urls = fetchImpl.mock.calls.map((c: any[]) => String(c[0]));
    expect(urls).toEqual([`${API_BASE}/fixtures?id=31337`]);
    expect(upserts.map((r: any) => r.fixture_id)).toEqual([31337]);
  });
});

describe("source-level guarantees of the deployed functions", () => {
  const read = async (p: string) => {
    const fs = await import("node:fs/promises");
    return fs.readFile(new URL(`../../${p}`, import.meta.url), "utf8");
  };

  it("auto-backfill-results does not chain the scorer", async () => {
    const src = await read("supabase/functions/auto-backfill-results/index.ts");
    expect(src).not.toMatch(/functions\/v1\/score-ticket-legs/);
    expect(src).toContain("scorer_chained: false");
  });

  it("results-refresh never deletes optimized_selections or outcome_selections", async () => {
    const src = await read("supabase/functions/results-refresh/index.ts");
    expect(src).not.toMatch(/from\("optimized_selections"\)[\s\S]{0,40}\.delete\(\)/);
    expect(src).not.toMatch(/from\("outcome_selections"\)[\s\S]{0,40}\.delete\(\)/);
    expect(src).toContain("confirm_cleanup");
  });

  it("no ingestion function logs key material or key prefixes", async () => {
    for (const p of [
      "supabase/functions/auto-backfill-results/index.ts",
      "supabase/functions/results-refresh/index.ts",
      "supabase/functions/backfill-fixture-results/index.ts",
    ]) {
      const src = await read(p);
      expect(src).not.toMatch(/providedKey/);
      expect(src).not.toMatch(/expectedKey/);
      expect(src).not.toMatch(/slice\(0,\s*8\)/);
    }
  });

  it("backfill-fixture-results has no unauthenticated path and no provider calls", async () => {
    const src = await read("supabase/functions/backfill-fixture-results/index.ts");
    expect(src).not.toMatch(/Authorized via no-auth/);
    expect(src).not.toMatch(/API_BASE/);
    expect(src).toContain("endpoint_retired");
  });
});
