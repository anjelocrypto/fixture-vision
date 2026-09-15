// ============================================================================
// Shared, dependency-free result-ingestion core (Gate D RC3)
// ----------------------------------------------------------------------------
// Pure TypeScript: no npm:/https: imports so it is unit-testable outside Deno.
// Every provider-touching path in the result-ingestion family MUST route
// through this module.
//
// RC3 contract:
//  - explicit confirmation + hard provider call budget, maxRetries = 0
//  - per-request AbortController timeout
//  - immediate circuit on timeout, network failure, 401, 403, 429, 5xx,
//    malformed JSON and invalid provider schema; other 4xx are explicit errors
//    and are never treated as empty successful data
//  - the requested fixture must exist locally BEFORE any provider call
//  - the provider fixture id must exactly equal the requested fixture id
//  - strict validation of terminal status, league id, team ids, kickoff and
//    finite non-negative integer goals; nothing is ever defaulted to zero and a
//    missing provider kickoff is never replaced with "now"
//  - any mismatch / incomplete / empty / malformed payload performs zero writes
//  - identity, status and results are persisted in ONE service-role transaction
//  - `success` is false for provider errors, invalid data and failed writes;
//    non-terminal fixtures are reported as an explicit no-change state
// ============================================================================

import { ProviderCallBudget, ProviderControlError } from "./provider_budget.ts";

export const TERMINAL_STATUSES = ["FT", "AET", "PEN", "AWD", "WO"] as const;
export const NON_PLAYABLE_STATUSES = ["PST", "CANC", "ABD", "TBD", "SUSP", "INT"] as const;

/** Default per-request provider timeout. */
export const PROVIDER_TIMEOUT_MS = 10_000;

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

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
  | "provider_timeout"
  | "provider_unauthorized"
  | "provider_client_error"
  | "provider_malformed_json"
  | "provider_error_envelope"
  | "provider_invalid_schema"
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
// Constant-time secret comparison
// ---------------------------------------------------------------------------

export function constantTimeEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a ?? "";
  const right = b ?? "";
  if (left.length === 0 || right.length === 0) return false;
  // Compare over a fixed width so length differences do not short-circuit.
  const width = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < width; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
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

  if (deps.serviceRoleKey && authHeader && constantTimeEquals(authHeader, `Bearer ${deps.serviceRoleKey}`)) {
    return { authorized: true, method: "service_role" };
  }

  if (cronKeyHeader && deps.lookupCronKey) {
    let expected: string | null = null;
    try {
      expected = await deps.lookupCronKey();
    } catch {
      expected = null;
    }
    if (constantTimeEquals(cronKeyHeader, String(expected ?? "").trim())) {
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
  private readonly timeoutMs: number;
  attempts = 0;
  stopped: ProviderStopKind | null = null;

  constructor(opts: {
    budget: ProviderCallBudget;
    fetchImpl: FetchLike;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }) {
    this.budget = opts.budget;
    this.fetchImpl = opts.fetchImpl;
    this.headers = opts.headers ?? {};
    this.timeoutMs = opts.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  }

  get callsUsed(): number {
    return this.budget.used;
  }

  private stop(kind: ProviderStopKind, status: number | null = null): never {
    this.stopped = kind;
    throw new ProviderStopError(kind, status);
  }

  /**
   * Latches the circuit for systemic provider schema / envelope defects so a
   * whole run cannot keep spending calls against a broken provider contract.
   */
  latchSchemaFailure(): void {
    this.stopped = "provider_invalid_schema";
  }

  /** Single attempt, hard timeout over the whole exchange, zero retries. */
  // deno-lint-ignore no-explicit-any
  async get(url: string): Promise<any> {
    if (this.stopped) throw new ProviderStopError(this.stopped);
    try {
      this.budget.reserve();
    } catch (error) {
      if (error instanceof ProviderControlError) this.stop("provider_call_budget_exhausted");
      throw error;
    }

    this.attempts++;
    const controller = new AbortController();
    // The timer is cleared only after the body has been read AND parsed, so a
    // provider that stalls mid-body still trips the timeout.
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const aborted = (error: unknown) =>
      controller.signal.aborted ||
      (error as { name?: string } | null)?.name === "AbortError" ||
      (error as { name?: string } | null)?.name === "TimeoutError";

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { headers: this.headers, signal: controller.signal });
      } catch (error) {
        this.stop(aborted(error) ? "provider_timeout" : "provider_network_error");
      }

      if (response.status === 401 || response.status === 403) this.stop("provider_unauthorized", response.status);
      if (response.status === 429) this.stop("provider_rate_limited", 429);
      if (response.status >= 500) this.stop("provider_server_error", response.status);
      if (!response.ok) this.stop("provider_client_error", response.status);

      // deno-lint-ignore no-explicit-any
      let json: any;
      try {
        const text = await response.text();
        json = JSON.parse(text);
      } catch (error) {
        if (aborted(error)) this.stop("provider_timeout", response.status);
        this.stop("provider_malformed_json", response.status);
      }
      if (json === null || typeof json !== "object") this.stop("provider_malformed_json", response.status);
      if (!("response" in json)) this.stop("provider_malformed_json", response.status);

      // API-Football reports failures inside an HTTP 200 envelope.
      const errors = (json as { errors?: unknown }).errors;
      const hasErrors = Array.isArray(errors)
        ? errors.length > 0
        : errors !== null && typeof errors === "object" && Object.keys(errors as object).length > 0;
      if (hasErrors) this.stop("provider_error_envelope", response.status);

      return json.response ?? null;
    } finally {
      clearTimeout(timer);
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
// Strict parsing / validation
// ---------------------------------------------------------------------------

export function isTerminalStatus(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

function finiteNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Identifiers may legitimately arrive as numeric strings ("1401863").
 * Anything else — floats, empty strings, "12a", booleans, objects — is
 * malformed and must never be coerced.
 */
export function parseProviderId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[0-9]{1,15}$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/** Statistic values may be numbers or numeric strings; nothing else counts. */
function parseStatValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (!/^[0-9]{1,4}$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  return null;
}

/**
 * Extracts both teams' secondary statistics.
 * A statistics payload that is malformed, empty, or not attributable to BOTH
 * requested teams is rejected outright — reporting ingestion success with
 * all-null statistics is not allowed.
 */
// deno-lint-ignore no-explicit-any
export function extractTeamStats(statsData: any, homeId: number, awayId: number) {
  const out: Record<string, number | null> = {
    corners_home: null, corners_away: null,
    cards_home: null, cards_away: null,
    fouls_home: null, fouls_away: null,
    offsides_home: null, offsides_away: null,
  };
  if (statsData === null || statsData === undefined) {
    throw new ValidationError("invalid_statistics", "statistics payload is null");
  }
  if (!Array.isArray(statsData) || statsData.length < 2) {
    throw new ValidationError("invalid_statistics", "statistics payload is missing or too short");
  }
  const TRACKED_TYPES = new Set([
    "Corner Kicks", "Corners", "Yellow Cards", "Red Cards", "Fouls", "Offsides",
  ]);

  /**
   * Indexes one side's entries, rejecting malformed entries, invalid values and
   * conflicting duplicate statistic types. A duplicate type is tolerated only
   * when every occurrence carries an identical value.
   */
  // deno-lint-ignore no-explicit-any
  const indexSide = (side: any): Map<string, number | null> => {
    const index = new Map<string, number | null>();
    // deno-lint-ignore no-explicit-any
    for (const entry of side.statistics as any[]) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new ValidationError("invalid_statistics", "statistics payload contains a malformed entry");
      }
      if (typeof entry.type !== "string" || entry.type.trim() === "") {
        throw new ValidationError("invalid_statistics", "statistics entry has no usable type");
      }
      const type = entry.type.trim();
      if (!TRACKED_TYPES.has(type)) continue;

      const raw = entry.value;
      const parsed = parseStatValue(raw);
      // Present but unparseable (negative, fractional, "12a", object, boolean)
      // is an invalid value, never a silent null.
      if (parsed === null && raw !== null && raw !== undefined && String(raw).trim() !== "") {
        throw new ValidationError(
          "invalid_statistics",
          `statistics entry "${type}" has an invalid value`,
        );
      }

      if (index.has(type) && index.get(type) !== parsed) {
        throw new ValidationError(
          "invalid_statistics",
          `statistics payload contains conflicting duplicate entries for "${type}"`,
        );
      }
      index.set(type, parsed);
    }
    return index;
  };

  // deno-lint-ignore no-explicit-any
  const homeMatches = statsData.filter((s: any) => parseProviderId(s?.team?.id) === homeId);
  // deno-lint-ignore no-explicit-any
  const awayMatches = statsData.filter((s: any) => parseProviderId(s?.team?.id) === awayId);

  // Conflicting duplicate team records make attribution ambiguous: reject the
  // whole payload instead of silently taking the first record.
  if (homeMatches.length > 1 || awayMatches.length > 1) {
    throw new ValidationError(
      "invalid_statistics",
      "statistics payload contains duplicate records for a requested team",
    );
  }

  const home = homeMatches[0];
  const away = awayMatches[0];

  // Team association must be unambiguous for BOTH sides, and each side must
  // carry a NON-EMPTY statistics array; otherwise the whole payload is
  // rejected rather than attributed to a guess or written as all-null.
  if (
    !Array.isArray(home?.statistics) || home.statistics.length === 0 ||
    !Array.isArray(away?.statistics) || away.statistics.length === 0 ||
    home === away
  ) {
    throw new ValidationError(
      "invalid_statistics",
      "statistics payload cannot be attributed to both requested teams",
    );
  }

  for (const [side, suffix] of [[home, "home"], [away, "away"]] as const) {
    const index = indexSide(side);
    const get = (type: string) => (index.has(type) ? index.get(type)! : null);

    out[`corners_${suffix}`] = get("Corner Kicks") ?? get("Corners");
    const yellow = get("Yellow Cards");
    const red = get("Red Cards");
    // A missing card component is unknown, never zero.
    out[`cards_${suffix}`] = yellow === null || red === null ? null : yellow + red;
    out[`fouls_${suffix}`] = get("Fouls");
    out[`offsides_${suffix}`] = get("Offsides");
  }

  // Requested statistics must be usable: a payload that yields nothing at all
  // for a side is a rejection, never a "successful" all-null write.
  for (const suffix of ["home", "away"] as const) {
    const usable = ["corners", "cards", "fouls", "offsides"]
      .some((metric) => out[`${metric}_${suffix}`] !== null);
    if (!usable) {
      throw new ValidationError(
        "invalid_statistics",
        `statistics payload carries no usable values for the ${suffix} team`,
      );
    }
  }

  return out;
}


export interface ValidatedFixture {
  fixture_id: number;
  league_id: number;
  status: string;
  terminal: boolean;
  kickoff_at: string;
  home_team_id: number;
  away_team_id: number;
  home_team_name: string | null;
  away_team_name: string | null;
  goals_home: number | null;
  goals_away: number | null;
}

/** Schema/envelope defects that indicate a systemic provider contract break. */
export const SYSTEMIC_SCHEMA_CODES = new Set([
  "invalid_provider_schema",
  "invalid_league",
  "invalid_teams",
  "invalid_kickoff",
  "invalid_statistics",
]);


function cleanTeamName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 120 ? trimmed : null;
}

/**
 * Strictly validates one provider fixture payload against the requested id.
 * Throws ValidationError (zero writes) on any deviation.
 */
export function parseProviderFixture(
  // deno-lint-ignore no-explicit-any
  raw: any,
  requestedFixtureId: number,
): ValidatedFixture {
  if (!raw || typeof raw !== "object" || !raw.fixture || typeof raw.fixture !== "object") {
    throw new ValidationError("invalid_provider_schema", "provider payload is not a fixture object");
  }

  const providerId = parseProviderId(raw.fixture.id);
  if (providerId === null) {
    throw new ValidationError("invalid_provider_schema", "provider fixture id is missing or malformed");
  }
  if (providerId !== requestedFixtureId) {
    throw new ValidationError(
      "fixture_id_mismatch",
      `provider returned fixture ${providerId} for requested ${requestedFixtureId}`,
    );
  }

  const status = raw.fixture?.status?.short;
  if (typeof status !== "string" || status.length === 0) {
    throw new ValidationError("invalid_provider_schema", "provider status is missing");
  }

  const leagueId = parseProviderId(raw.league?.id);
  if (leagueId === null) {
    throw new ValidationError("invalid_league", "provider league id is missing or malformed");
  }

  const homeId = parseProviderId(raw.teams?.home?.id);
  const awayId = parseProviderId(raw.teams?.away?.id);
  if (homeId === null || awayId === null || homeId === awayId) {
    throw new ValidationError("invalid_teams", "provider team ids are missing, malformed or identical");
  }


  const timestamp = raw.fixture?.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
    throw new ValidationError("invalid_kickoff", "provider kickoff timestamp is missing or malformed");
  }
  const kickoff = new Date(timestamp * 1000);
  if (Number.isNaN(kickoff.getTime())) {
    throw new ValidationError("invalid_kickoff", "provider kickoff timestamp is not a valid date");
  }

  const terminal = isTerminalStatus(status);
  let goalsHome: number | null = null;
  let goalsAway: number | null = null;

  if (terminal) {
    goalsHome = finiteNonNegativeInt(raw.goals?.home) ?? finiteNonNegativeInt(raw.score?.fulltime?.home);
    goalsAway = finiteNonNegativeInt(raw.goals?.away) ?? finiteNonNegativeInt(raw.score?.fulltime?.away);
    if (goalsHome === null || goalsAway === null) {
      throw new ValidationError("incomplete_score", "terminal fixture is missing finite non-negative goals");
    }
  }

  return {
    fixture_id: providerId,
    league_id: leagueId,
    status,
    terminal,
    kickoff_at: kickoff.toISOString(),
    home_team_id: homeId,
    away_team_id: awayId,
    home_team_name: cleanTeamName(raw.teams?.home?.name),
    away_team_name: cleanTeamName(raw.teams?.away?.name),
    goals_home: goalsHome,
    goals_away: goalsAway,
  };
}

// ---------------------------------------------------------------------------
// Targeted single-fixture ingestion
// ---------------------------------------------------------------------------

export interface IngestionPayload {
  fixture_id: number;
  league_id: number;
  status: string;
  kickoff_at: string;
  home_team_id: number;
  away_team_id: number;
  home_team_name: string | null;
  away_team_name: string | null;
  goals_home: number;
  goals_away: number;
  stats: Record<string, number | null>;
}

export interface TargetedWriter {
  /** Must resolve to the local fixture row (or null) — checked before any provider call. */
  loadLocalFixture: (fixtureId: number) => Promise<{ id: number; status: string | null } | null>;
  /** Single service-role transaction: identity + status + results, all or nothing. */
  ingestAtomically: (payload: IngestionPayload) => Promise<void>;
}

export interface TargetedOptions {
  fixtureId: number;
  apiBase: string;
  session: ProviderSession;
  writer: TargetedWriter;
  includeStatistics: boolean;
}

export type IngestionState =
  | "written"
  | "non_terminal_no_change"
  | "provider_error"
  | "invalid_data"
  | "write_failed"
  | "unknown_local_fixture";

export interface TargetedOutcome {
  success: boolean;
  state: IngestionState;
  fixture_id: number;
  provider_status: string | null;
  terminal: boolean;
  result_written: boolean;
  stop_reason: ProviderStopKind | null;
  provider_calls: number;
  reason?: string;
}

export async function runTargetedFixtureIngestion(opts: TargetedOptions): Promise<TargetedOutcome> {
  const { fixtureId, session, writer } = opts;
  const base: Omit<TargetedOutcome, "success" | "state"> = {
    fixture_id: fixtureId,
    provider_status: null,
    terminal: false,
    result_written: false,
    stop_reason: null,
    provider_calls: 0,
  };

  // 1. The fixture must exist locally BEFORE we spend a provider call.
  const local = await writer.loadLocalFixture(fixtureId);
  if (!local) {
    return {
      ...base,
      success: false,
      state: "unknown_local_fixture",
      reason: "unknown_local_fixture",
    };
  }

  // 2. Single provider call, zero retries, hard timeout.
  // deno-lint-ignore no-explicit-any
  let data: any = null;
  try {
    data = await session.get(`${opts.apiBase}/fixtures?id=${fixtureId}`);
  } catch (error) {
    if (error instanceof ProviderStopError) {
      return {
        ...base,
        success: false,
        state: "provider_error",
        stop_reason: error.kind,
        provider_calls: session.callsUsed,
        reason: error.kind,
      };
    }
    throw error;
  }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ...base,
      success: false,
      state: "invalid_data",
      provider_calls: session.callsUsed,
      reason: "no_provider_data",
    };
  }

  // 3. Strict validation — any deviation means zero writes.
  let parsed: ValidatedFixture;
  try {
    parsed = parseProviderFixture(data[0], fixtureId);
  } catch (error) {
    const code = error instanceof ValidationError ? error.code : "invalid_provider_schema";
    // Systemic contract breaks latch the circuit for the whole run.
    if (SYSTEMIC_SCHEMA_CODES.has(code)) session.latchSchemaFailure();
    return {
      ...base,
      success: false,
      state: "invalid_data",
      stop_reason: session.stopped,
      provider_calls: session.callsUsed,
      reason: code,
    };
  }

  // 4. Non-terminal fixtures are an explicit no-change state: never written here.
  if (!parsed.terminal) {
    return {
      ...base,
      success: false,
      state: "non_terminal_no_change",
      provider_status: parsed.status,
      provider_calls: session.callsUsed,
      reason: "not_terminal",
    };
  }

  // 5. Optional statistics call (same circuit rules).
  // deno-lint-ignore no-explicit-any
  let statsData: any = null;
  if (opts.includeStatistics) {
    try {
      statsData = await session.get(`${opts.apiBase}/fixtures/statistics?fixture=${fixtureId}`);
    } catch (error) {
      if (error instanceof ProviderStopError) {
        return {
          ...base,
          success: false,
          state: "provider_error",
          provider_status: parsed.status,
          terminal: true,
          stop_reason: error.kind,
          provider_calls: session.callsUsed,
          reason: error.kind,
        };
      }
      throw error;
    }
  }

  // A requested statistics payload that cannot be validated is a failure:
  // the result is NOT written with all-null statistics. A null response, an
  // empty team statistics array and conflicting duplicate team records are all
  // validation failures, and they latch the circuit so no further provider
  // call is made in this run.
  let stats: Record<string, number | null> = {};
  if (opts.includeStatistics) {
    try {
      stats = extractTeamStats(statsData, parsed.home_team_id, parsed.away_team_id);
    } catch (error) {
      const code = error instanceof ValidationError ? error.code : "invalid_statistics";
      session.latchSchemaFailure();
      return {
        ...base,
        success: false,
        state: "invalid_data",
        provider_status: parsed.status,
        terminal: true,
        stop_reason: session.stopped,
        provider_calls: session.callsUsed,
        reason: code,
      };
    }
  }



  // 6. One atomic service-role transaction: identity + status + results.
  try {
    await writer.ingestAtomically({
      fixture_id: parsed.fixture_id,
      league_id: parsed.league_id,
      status: parsed.status,
      kickoff_at: parsed.kickoff_at,
      home_team_id: parsed.home_team_id,
      away_team_id: parsed.away_team_id,
      home_team_name: parsed.home_team_name,
      away_team_name: parsed.away_team_name,
      goals_home: parsed.goals_home as number,
      goals_away: parsed.goals_away as number,
      stats,
    });
  } catch (error) {
    return {
      ...base,
      success: false,
      state: "write_failed",
      provider_status: parsed.status,
      terminal: true,
      provider_calls: session.callsUsed,
      reason: error instanceof Error ? error.message : "write_failed",
    };
  }

  return {
    success: true,
    state: "written",
    fixture_id: fixtureId,
    provider_status: parsed.status,
    terminal: true,
    result_written: true,
    stop_reason: null,
    provider_calls: session.callsUsed,
  };
}
