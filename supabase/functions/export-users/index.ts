import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const auth = await checkCronOrAdminAuth(
      req,
      supabaseAdmin,
      serviceRoleKey,
      "[export-users]",
    );
    if (!auth.authorized || auth.method === "cron_key") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch ALL users with pagination
    const allUsers: any[] = [];
    let page = 1;
    const perPage = 1000;
    
    while (true) {
      console.log(`Fetching page ${page}...`);
      const { data, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });

      if (usersError) {
        console.error("Error fetching users:", usersError);
        return new Response(JSON.stringify({ error: "Failed to fetch users" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!data.users || data.users.length === 0) {
        break;
      }

      allUsers.push(...data.users);
      console.log(`Page ${page}: fetched ${data.users.length} users, total: ${allUsers.length}`);

      // If we got less than perPage, we've reached the end
      if (data.users.length < perPage) {
        break;
      }
      
      page++;
    }

    console.log(`Total users fetched: ${allUsers.length}`);

    const format = new URL(req.url).searchParams.get("format")?.toLowerCase();
    const exportDate = new Date().toISOString().split("T")[0];

    if (format === "jsonl") {
      const jsonLines = allUsers.map((user) =>
        JSON.stringify({
          id: user.id,
          email: user.email ?? null,
          phone: user.phone ?? null,
          created_at: user.created_at ?? null,
          updated_at: user.updated_at ?? null,
          confirmed_at: user.confirmed_at ?? null,
          email_confirmed_at: user.email_confirmed_at ?? null,
          phone_confirmed_at: user.phone_confirmed_at ?? null,
          last_sign_in_at: user.last_sign_in_at ?? null,
          role: user.role ?? null,
          aud: user.aud ?? null,
          app_metadata: user.app_metadata ?? {},
          user_metadata: user.user_metadata ?? {},
          identities: (user.identities ?? []).map((identity: any) => ({
            id: identity.id,
            identity_id: identity.identity_id,
            provider: identity.provider,
            created_at: identity.created_at,
            updated_at: identity.updated_at,
            last_sign_in_at: identity.last_sign_in_at,
          })),
        })
      ).join("\n");

      return new Response(`${jsonLines}\n`, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": `attachment; filename="registered_users_${exportDate}.jsonl"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // CSV is for human review. JSONL is the preferred migration artifact.
    const csvRows = ["User ID,Email,Registration Date,Email Confirmed"];
    
    for (const user of allUsers) {
      const id = user.id;
      const email = user.email || "";
      const createdAt = user.created_at ? new Date(user.created_at).toISOString().replace("T", " ").split(".")[0] : "";
      const confirmed = user.email_confirmed_at ? "Yes" : "No";
      
      const escapedEmail = escapeCsvCell(email);
      
      csvRows.push(`${id},${escapedEmail},${createdAt},${confirmed}`);
    }

    const csvContent = csvRows.join("\n");

    return new Response(csvContent, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="registered_users_${exportDate}.csv"`,
        "Cache-Control": "no-store",
      },
    });

  } catch (error: unknown) {
    console.error("Export error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeCsvCell(value: string): string {
  const formulaSafeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (!/[",\r\n]/.test(formulaSafeValue)) {
    return formulaSafeValue;
  }

  return `"${formulaSafeValue.replaceAll('"', '""')}"`;
}
