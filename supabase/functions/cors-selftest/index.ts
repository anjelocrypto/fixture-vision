import { getCorsHeaders, handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const corsHeaders = getCorsHeaders(origin, req);

  // Echo back exactly what headers we're sending + what we received
  const response = {
    ok: true,
    cors_config: {
      allow_origin: corsHeaders["Access-Control-Allow-Origin"],
      allow_headers: corsHeaders["Access-Control-Allow-Headers"],
      allow_methods: corsHeaders["Access-Control-Allow-Methods"],
      max_age: corsHeaders["Access-Control-Max-Age"],
    },
    received_headers: {
      origin: origin,
      authorization: req.headers.has("authorization") ? "[present]" : "[missing]",
      apikey: req.headers.has("apikey") ? "[present]" : "[missing]",
      content_type: req.headers.get("content-type"),
      x_client_info: req.headers.get("x-client-info"),
      x_supabase_client_platform: req.headers.get("x-supabase-client-platform"),
      x_supabase_client_runtime: req.headers.get("x-supabase-client-runtime"),
    },
    timestamp: new Date().toISOString(),
  };

  console.log("[cors-selftest]", JSON.stringify(response));

  return jsonResponse(response, origin, 200, req);
});
