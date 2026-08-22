import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticateUser } from "../_shared/user_auth.ts";
import { getCorsHeaders, handlePreflight, errorResponse } from "../_shared/cors.ts";

const PAGE_SIZE = 1000;
const MAX_ROWS_PER_TABLE = 50_000;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);
  if (req.method !== "POST") return errorResponse("Method not allowed", origin, 405, req);

  try {
    const auth = await authenticateUser(req, "[export-my-data]");
    if (!auth.authorized || !auth.user) return errorResponse("Unauthorized", origin, 401, req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing server configuration", origin, 500, req);
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rateData, error: rateError } = await admin.rpc("consume_rate_limit", {
      p_user_id: auth.user.id,
      p_feature: "personal_data_export",
      p_max_per_minute: 2,
    });
    if (rateError) throw new Error(`export rate limit: ${rateError.message}`);
    const rateDecision = Array.isArray(rateData) ? rateData[0] : rateData;
    if (rateDecision?.allowed !== true) {
      return errorResponse("Too many export requests; retry in one minute", origin, 429, req);
    }

    async function readAll(table: string, userColumn = "user_id", columns = "*") {
      const rows: unknown[] = [];
      for (let offset = 0; offset < MAX_ROWS_PER_TABLE; offset += PAGE_SIZE) {
        const { data, error } = await admin
          .from(table)
          .select(columns)
          .eq(userColumn, auth.user!.id)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < PAGE_SIZE) return rows;
      }
      throw new Error(`${table}: export exceeds ${MAX_ROWS_PER_TABLE} rows; contact support`);
    }

    const tableSpecs = [
      ["profiles", "user_id"],
      ["user_entitlements", "user_id"],
      ["user_trial_credits", "user_id"],
      ["user_tickets", "user_id"],
      ["generated_tickets", "user_id"],
      ["ticket_leg_outcomes", "user_id"],
      ["ticket_outcomes", "user_id"],
      ["market_coins", "user_id"],
      ["market_positions", "user_id"],
      ["market_leaderboard_snapshots", "user_id"],
      ["prediction_markets", "created_by"],
      ["admin_market_audit_log", "admin_user_id"],
      ["analytics_events", "user_id"],
      ["user_rate_limits", "user_id"],
      ["feature_usage_reservations", "user_id"],
      ["user_roles", "user_id"],
      [
        "privacy_requests",
        "user_id",
        "id,user_id,request_type,status,details,requested_at,completed_at",
      ],
    ] as const;
    const entries = await Promise.all(
      tableSpecs.map(async ([table, column, columns]) => [
        table,
        await readAll(table, column, columns),
      ] as const),
    );

    const exportPayload = {
      schema_version: "ticket-ai-personal-export-v1",
      exported_at: new Date().toISOString(),
      account: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        phone: auth.user.phone ?? null,
        created_at: auth.user.created_at,
        updated_at: auth.user.updated_at,
        last_sign_in_at: auth.user.last_sign_in_at ?? null,
        user_metadata: auth.user.user_metadata ?? {},
      },
      data: Object.fromEntries(entries),
    };

    return new Response(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        ...getCorsHeaders(origin, req),
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ticket-ai-data-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    console.error("[export-my-data]", error);
    return errorResponse("Unable to create a complete data export", origin, 500, req);
  }
});
