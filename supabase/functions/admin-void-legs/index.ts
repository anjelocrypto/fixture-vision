/**
 * ADMIN-VOID-LEGS — RETIRED (Gate D RC3)
 *
 * The underlying RPC `void_non_ft_pending_legs` performed an unbounded,
 * unconfirmed, unaudited bulk VOID over pending legs. Both the RPC and this
 * endpoint are disabled until an exact-target, dry-run, confirmed and audited
 * replacement exists.
 *
 * Default deny: every request returns 410 with zero database writes.
 */
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);

  return jsonResponse({
    success: false,
    code: "function_retired",
    error:
      "admin-void-legs is retired pending an exact-target, dry-run, confirmed and audited replacement.",
    database_writes: 0,
  }, origin, 410, req);
});
