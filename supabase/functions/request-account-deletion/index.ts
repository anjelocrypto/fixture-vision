import { authenticateUser } from "../_shared/user_auth.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { readJsonWithLimit, RequestBodyTooLargeError } from "../_shared/request.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);
  if (req.method !== "POST") return errorResponse("Method not allowed", origin, 405, req);

  try {
    const auth = await authenticateUser(req, "[request-account-deletion]");
    if (!auth.authorized || !auth.client) return errorResponse("Unauthorized", origin, 401, req);
    const body = await readJsonWithLimit(req, 1024) as { confirmation?: unknown } | null;
    if (body?.confirmation !== "DELETE MY ACCOUNT") {
      return errorResponse('Type "DELETE MY ACCOUNT" to confirm', origin, 400, req);
    }
    const { data: requestId, error } = await auth.client.rpc("request_account_deletion", {
      p_confirmation: body.confirmation,
    });
    if (error) throw error;
    return jsonResponse({ success: true, request_id: requestId, status: "pending" }, origin, 200, req);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(error.message, origin, 413, req);
    }
    console.error("[request-account-deletion]", error);
    return errorResponse("Unable to create deletion request", origin, 500, req);
  }
});
