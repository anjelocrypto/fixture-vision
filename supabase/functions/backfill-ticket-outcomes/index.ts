/**
 * BACKFILL-TICKET-OUTCOMES — RETIRED (Gate D RC3)
 *
 * This endpoint rebuilt ticket outcome rows in bulk without exact targeting,
 * a dry-run preview, explicit confirmation or an audit trail, and could
 * overwrite settled user outcomes.
 *
 * Default deny: every request returns 410 with zero database writes. A
 * replacement must be exact-target, dry-run first, explicitly confirmed and
 * audited before it is re-enabled.
 */
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);

  return jsonResponse({
    success: false,
    code: "function_retired",
    error:
      "backfill-ticket-outcomes is retired pending an exact-target, dry-run, confirmed and audited replacement.",
    database_writes: 0,
  }, origin, 410, req);
});
