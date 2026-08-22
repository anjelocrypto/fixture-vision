import {
  ALLOWED_LEAGUE_IDS,
  ALLOWED_MARKET_LINES,
  buildGreenBucketsContext,
  isAllowlisted,
  isInGreenBucket,
  normalizeLine,
  type GreenBucket,
  type GreenBucketsContext,
} from "./green_allowlist.ts";

export type GreenPolicyMode = "learned" | "legacy" | "bootstrap";

export interface GreenPolicy {
  mode: GreenPolicyMode;
  versionId: string | null;
  activatedAt: string | null;
  stale: boolean;
  context: GreenBucketsContext | null;
  leagueIds: number[];
  markets: string[];
  bucketCount: number;
}

export interface GreenPolicyCandidate {
  league_id: number;
  market: string;
  side: string;
  line: number;
  odds: number | null;
}

const POLICY_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function isStale(timestamp: string | null): boolean {
  if (!timestamp) return true;
  const parsed = new Date(timestamp).getTime();
  return !Number.isFinite(parsed) || Date.now() - parsed > POLICY_STALE_AFTER_MS;
}

function bootstrapPolicy(): GreenPolicy {
  return {
    mode: "bootstrap",
    versionId: null,
    activatedAt: null,
    stale: false,
    context: null,
    leagueIds: [...ALLOWED_LEAGUE_IDS],
    markets: [...new Set(ALLOWED_MARKET_LINES.map((entry) => entry.market))],
    bucketCount: 0,
  };
}

/**
 * Load one immutable policy snapshot for an entire function run.
 *
 * A versioned learned policy is preferred. The old green_buckets table is a
 * transition-only fallback. If neither has data, the explicit conservative
 * bootstrap policy keeps ticket generation available and labels the result.
 */
export async function loadGreenPolicy(supabase: any): Promise<GreenPolicy> {
  const { data: version, error: versionError } = await supabase
    .from("green_bucket_policy_versions")
    .select("id, activated_at")
    .eq("status", "active")
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!versionError && version?.id) {
    const { data: entries, error: entriesError } = await supabase
      .from("green_bucket_policy_entries")
      .select("league_id, market, side, line_norm, odds_band, hit_rate_pct, sample_size, roi_pct")
      .eq("policy_version_id", version.id);

    if (!entriesError && entries?.length) {
      const context = buildGreenBucketsContext(entries as GreenBucket[]);
      return {
        mode: "learned",
        versionId: version.id,
        activatedAt: version.activated_at,
        stale: isStale(version.activated_at),
        context,
        leagueIds: context.leagueIds,
        markets: context.markets,
        bucketCount: entries.length,
      };
    }

    console.error("[green-policy] Active policy has no usable entries", entriesError);
  } else if (versionError) {
    console.warn("[green-policy] Versioned policy unavailable; checking legacy snapshot", versionError.message);
  }

  const { data: legacyRows, error: legacyError } = await supabase
    .from("green_buckets")
    .select("league_id, market, side, line_norm, odds_band, hit_rate_pct, sample_size, roi_pct, updated_at");

  if (!legacyError && legacyRows?.length) {
    const context = buildGreenBucketsContext(legacyRows as GreenBucket[]);
    let newestUpdate: string | null = null;
    for (const row of legacyRows as Array<{ updated_at?: string | null }>) {
      if (row.updated_at && (!newestUpdate || row.updated_at > newestUpdate)) {
        newestUpdate = row.updated_at;
      }
    }
    return {
      mode: "legacy",
      versionId: null,
      activatedAt: newestUpdate,
      stale: isStale(newestUpdate),
      context,
      leagueIds: context.leagueIds,
      markets: context.markets,
      bucketCount: legacyRows.length,
    };
  }

  if (legacyError) {
    console.warn("[green-policy] Legacy policy unavailable; using bootstrap", legacyError.message);
  } else {
    console.warn("[green-policy] No learned policy exists; using explicit bootstrap policy");
  }
  return bootstrapPolicy();
}

export function isAllowedByGreenPolicy(
  policy: GreenPolicy,
  candidate: GreenPolicyCandidate,
): { allowed: boolean; reason?: string; bucketKey?: string } {
  if (policy.context) return isInGreenBucket(policy.context, candidate);
  return isAllowlisted(candidate);
}

/** Model-only rows have no odds band; require at least one allowed band. */
export function isLineAllowedByGreenPolicy(
  policy: GreenPolicy,
  candidate: Omit<GreenPolicyCandidate, "odds">,
): { allowed: boolean; reason?: string } {
  if (!policy.context) {
    return isAllowlisted({ ...candidate, odds: 1.5 });
  }

  const prefix = `${candidate.league_id}|${candidate.market}|${candidate.side}|${normalizeLine(candidate.line)}|`;
  const allowed = [...policy.context.bucketSet].some((key) => key.startsWith(prefix));
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `no green policy line for ${prefix}` };
}
