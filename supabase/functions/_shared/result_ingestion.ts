// ============================================================================
// Shared, dependency-free result-ingestion core (Gate D remediation)
// ----------------------------------------------------------------------------
// Pure TypeScript: no npm:/https: imports so it is unit-testable outside Deno.
// Every provider-touching path in the result-ingestion family MUST route
// through this module: explicit confirmation, hard call budget, zero retries
// and an immediate circuit breaker on 429/5xx/timeout/network failure.
// ============================================================================

import { ProviderCallBudget, ProviderControlError } from "./provider_budget.ts";

export const TERMINAL_STATUSES = ["FT", "AET", "PEN", "AWD", "WO"] as const;
export const NON_PLAYABLE_STATUSES = ["PST", "CANC", "ABD", "TBD", "SUSP", "INT"] as const;

export type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export class ValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

export type ProviderStopKind =
  | "provider_rate_limited"
  | "provider_server_error"
  | "provider_network_error"
  | "provider_call_budget_exhausted";

export class ProviderStopError extends Error {
  readonly kind: ProviderStopKind;
  readonly status: number | null;
  constructor(kind: ProviderStopKind, status: number | null = null) {
    super(kind);
    this.name = "ProviderStopError";
    this.kind = kind;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Input validation (fail closed — no provider call, no mutation)
// ---------------------------------------------------------------------------

export function validateBoundedInt(
  value: unknown,
  opts: { name: string; min: number; max: number; fallback?: number },
): number {
  if (value === undefined || value === null || value === "") {
    if (opts.fallback === undefined) {
      throw new ValidationError("missing_parameter", `${opts.name} is required`);
    }
    return opts.fallback;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ValidationError("invalid_parameter", `${opts.name} must be an integer`);
  }
  if (parsed < opts.min || parsed > opts.max) {
    throw new ValidationError(
      "out_of_range_parameter",
      `${opts.name} must be between ${opts.min} and ${opts.max}`,
    );
  }
  return parsed;
}

export function requireConfirmation(body: Record<string, unknown>, field = "confirm_provider_calls"): void {
  if (body?.[field] !== true) {
    throw new ValidationError("confirmation_required", `${field}=true is required before any provider call`);
  }
}

export function validateFixtureId(value: unknown): number {
  return validateBoundedInt(value, { name: "fixture_id", min: 1, max: 999_999_999 });
}

/** Hard ceilings enforced by the targeted mode. */
export const TARGETED_GOALS_ONLY_MAX_CALLS = 1;
export const TARGETED_WITH_STATS_MAX_CALLS = 2;

export function buildTargetedBudget(includeStatistics: boolean, requested?: unknown): ProviderCallBudget {
  const hard = includeStatistics ? TARGETED_WITH_STATS_MAX_CALLS : TARGETED_GOALS_ONLY_MAX_CALLS;
  const limit = requested === undefined || requested === null
    ? hard
    : validateBoundedInt(requested, { name: "max_provider_calls", min: 1, max: hard });
  return new ProviderCallBudget(limit);
}

// ---------------------------------------------------------------------------
// Authorization (default deny, never logs secrets or secret prefixes)
// ---------------------------------------------------------------------------

export interface AuthDeps {
  serviceRoleKey: string | null | undefined;
  cronKeyHeader?: string | null;
  authHeader?: string | null;
  lookupCronKey?: () => Promise<string | null>;
  verifyAdmin?: (authHeader: string) => Promise<boolean>;
}

export type AuthMethod = "service_role" | "cron_key" | "admin_user";

export async function authorizeIngestionRequest(
  deps: AuthDeps,
): Promise<{ authorized: boolean; method: AuthMethod | null }> {
  const authHeader = deps.authHeader?.trim() || "";
  const cronKeyHeader = deps.cronKeyHeader?.trim() || "";

  if (deps.serviceRoleKey && authHeader && authHeader === `Bearer ${deps.serviceRoleKey}`) {
    return { authorized: true, method: "service_role" };
  }

  if (cronKeyHeader && deps.lookupCronKey) {
    let expected: string | null = null;
    try {
      expected = await deps.lookupCronKey();
    } catch {
      expected = null;
    }
    const expectedKey = String(expected ?? "").trim();
    if (expectedKey.length > 0 && cronKeyHeader === expectedKey) {
      return { authorized: true, method: "cron_key" };
    }
  }

  if (authHeader && deps.verifyAdmin) {
    let ok = false;
    try {
      ok = await deps.verifyAdmin(authHeader);
    } catch {
      ok = false;
    }
    if (ok === true) return { authorized: true, method: "admin_user" };
  }

  // Default deny.
  return { authorized: false, method: null };
}

// ---------------------------------------------------------------------------
// Provider session: one attempt per request, immediate circuit breaker
// ---------------------------------------------------------------------------

export class ProviderSession {
  readonly budget: ProviderCallBudget;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  attempts = 0;
  stopped: ProviderStopKind | null = null;

  constructor(opts: { budget: ProviderCallBudget; fetchImpl: FetchLike; headers?: Record<string, string> }) {
    this.budget = opts.budget;
    this.fetchImpl = opts.fetchImpl;
    this.headers = opts.headers ?? {};
  }

  get callsUsed(): number {
    return this.budget.used;
  }

  /** Single attempt. maxRetries = 0 by contract. */
  async get(url: string): Promise<any> {
    if (this.stopped) throw new ProviderStopError(this.stopped);
    try {
      this.budget.reserve();
    } catch (error) {
      if (error instanceof ProviderControlError) {
        this.stopped = "provider_call_budget_exhausted";
        throw new ProviderStopError(this.stopped);
      }
      throw error;
    }

    this.attempts++;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: this.headers });
    } catch {
      this.stopped = "provider_network_error";
      throw new ProviderStopError(this.stopped);
    }

    if (response.status === 429) {
      this.stopped = "provider_rate_limited";
      throw new ProviderStopError(this.stopped, 429);
    }
    if (response.status >= 500) {
      this.stopped = "provider_server_error";
      throw new ProviderStopError(this.stopped, response.status);
    }
    if (!response.ok) {
      return null;
    }
    try {
      const json = await response.json();
      return json?.response ?? null;
    } catch {
      return null;
    }
  }

  snapshot(): Record<string, unknown> {
    return {
      provider_calls: this.budget.used,
      provider_call_limit: this.budget.limit,
      provider_attempts: this.attempts,
      provider_stop_reason: this.stopped,
    };
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export function isTerminalStatus(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function extractTeamStats(statsData: any, homeId: number, awayId: number) {
  const out: Record<string, number | null> = {
    corners_home: null, corners_away: null,
    cards_home: null, cards_away: null,
    fouls_home: null, fouls_away: null,
    offsides_home: null, offsides_away: null,
  };
  if (!Array.isArray(statsData) || statsData.length < 2) return out;
  const pick = (side: any, type: string) =>
    side?.statistics?.find((st: any) => st.type === type)?.value ?? null;

  const home = statsData.find((s: any) => s.team?.id === homeId);
  const away = statsData.find((s: any) => s.team?.id === awayId);

  for (const [side, suffix] of [[home, "home"], [away, "away"]] as const) {
    if (!side?.statistics) continue;
    out[`corners_${suffix}`] = pick(side, "Corner Kicks") ?? pick(side, "Corners");
    const yellow = pick(side, "Yellow Cards") ?? 0;
    const red = pick(side, "Red Cards") ?? 0;
    out[`cards_${suffix}`] = (yellow || 0) + (red || 0);
    out[`fouls_${suffix}`] = pick(side, "Fouls");
    out[`offsides_${suffix}`] = pick(side, "Offsides");
  }
  return out;
}

export interface FixtureResultRow {
  fixture_id: number;
  league_id: number;
  kickoff_at: string;
  finished_at: string;
  goals_home: number;
  goals_away: number;
  corners_home?: number;
  corners_away?: number;
  cards_home?: number;
  cards_away?: number;
  fouls_home?: number;
  fouls_away?: number;
  offsides_home?: number;
  offsides_away?: number;
  status: string;
  source: string;
  fetched_at: string;
}

export function buildFixtureResultRow(apiFixture: any, statsData: any | null): FixtureResultRow {
  const status = apiFixture?.fixture?.status?.short as string;
  const timestamp = apiFixture?.fixture?.timestamp;
  const stats = statsData
    ? extractTeamStats(statsData, apiFixture?.teams?.home?.id, apiFixture?.teams?.away?.id)
    : null;
  const now = new Date().toISOString();
  const undef = (v: number | null | undefined) => (v === null || v === undefined ? undefined : v);
  return {
    fixture_id: apiFixture.fixture.id,
    league_id: apiFixture.league?.id,
    kickoff_at: timestamp ? new Date(timestamp * 1000).toISOString() : now,
    finished_at: now,
    goals_home: apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0,
    goals_away: apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0,
    corners_home: undef(stats?.corners_home),
    corners_away: undef(stats?.corners_away),
    cards_home: undef(stats?.cards_home),
    cards_away: undef(stats?.cards_away),
    fouls_home: undef(stats?.fouls_home),
    fouls_away: undef(stats?.fouls_away),
    offsides_home: undef(stats?.offsides_home),
    offsides_away: undef(stats?.offsides_away),
    status,
    source: "api-football",
    fetched_at: now,
  };
}

// ---------------------------------------------------------------------------
// Targeted single-fixture ingestion
// ---------------------------------------------------------------------------

export interface TargetedWriter {
  upsertFixtureResult: (row: FixtureResultRow) => Promise<void>;
  updateFixtureStatus: (fixtureId: number, status: string) => Promise<void>;
}

export interface TargetedOptions {
  fixtureId: number;
  apiBase: string;
  session: ProviderSession;
  writer: TargetedWriter;
  includeStatistics: boolean;
  localStatus?: string | null;
}

export interface TargetedOutcome {
  fixture_id: number;
  provider_status: string | null;
  terminal: boolean;
  result_written: boolean;
  status_updated: boolean;
  stop_reason: ProviderStopKind | null;
  provider_calls: number;
  reason?: string;
}

export async function runTargetedFixtureIngestion(opts: TargetedOptions): Promise<TargetedOutcome> {
  const { fixtureId, session, writer } = opts;
  const base: TargetedOutcome = {
    fixture_id: fixtureId,
    provider_status: null,
    terminal: false,
    result_written: false,
    status_updated: false,
    stop_reason: null,
    provider_calls: 0,
  };

  let apiFixture: any = null;
  try {
    const data = await session.get(`${opts.apiBase}/fixtures?id=${fixtureId}`);
    apiFixture = Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch (error) {
    if (error instanceof ProviderStopError) {
      return { ...base, stop_reason: error.kind, provider_calls: session.callsUsed, reason: error.kind };
    }
    throw error;
  }

  if (!apiFixture?.fixture) {
    return { ...base, provider_calls: session.callsUsed, reason: "no_provider_data" };
  }

  const providerStatus: string = apiFixture.fixture?.status?.short ?? "NS";
  const terminal = isTerminalStatus(providerStatus);

  // Non-terminal: never create fixture_results, never touch ticket outcomes.
  if (!terminal) {
    let statusUpdated = false;
    if (opts.localStatus !== undefined && opts.localStatus !== providerStatus) {
      await writer.updateFixtureStatus(fixtureId, providerStatus);
      statusUpdated = true;
    }
    return {
      ...base,
      provider_status: providerStatus,
      terminal: false,
      status_updated: statusUpdated,
      provider_calls: session.callsUsed,
      reason: "not_terminal",
    };
  }

  let statsData: any = null;
  if (opts.includeStatistics) {
    try {
      statsData = await session.get(`${opts.apiBase}/fixtures/statistics?fixture=${fixtureId}`);
    } catch (error) {
      if (error instanceof ProviderStopError) {
        return {
          ...base,
          provider_status: providerStatus,
          terminal: true,
          stop_reason: error.kind,
          provider_calls: session.callsUsed,
          reason: error.kind,
        };
      }
      throw error;
    }
  }

  const row = buildFixtureResultRow(apiFixture, statsData);
  await writer.upsertFixtureResult(row);

  let statusUpdated = false;
  if (opts.localStatus !== undefined && opts.localStatus !== providerStatus) {
    await writer.updateFixtureStatus(fixtureId, providerStatus);
    statusUpdated = true;
  }

  return {
    fixture_id: fixtureId,
    provider_status: providerStatus,
    terminal: true,
    result_written: true,
    status_updated: statusUpdated,
    stop_reason: null,
    provider_calls: session.callsUsed,
  };
}
