/**
 * RESULTS-REFRESH — RETIRED (Gate D RC3)
 *
 * This function carried three legacy bulk modes that wrote fixture_results and
 * fixtures.status with separate, non-atomic statements, defaulted missing goals
 * to zero and deleted historical rows on a retention sweep.
 *
 * It is replaced by `auto-backfill-results`, which routes every fixture through
 * the single strict parser (`_shared/result_ingestion.ts`) and the single
 * service-role atomic writer (`public.ingest_fixture_result_tx`).
 *
 * Default deny: every request returns 410 and performs zero provider calls and
 * zero database writes.
 */
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);

  return jsonResponse({
    success: false,
    code: "function_retired",
    error: "results-refresh is retired. Use auto-backfill-results (targeted or bulk mode).",
    replacement: "auto-backfill-results",
    provider_calls: 0,
    database_writes: 0,
  }, origin, 410, req);
});
