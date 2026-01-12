import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

    // Verify admin access
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user is admin
    const { data: isAdmin } = await supabaseAdmin.rpc("is_user_whitelisted", { uid: user.id });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
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

    // Generate CSV content
    const csvRows = ["User ID,Email,Registration Date,Email Confirmed"];
    
    for (const user of allUsers) {
      const id = user.id;
      const email = user.email || "";
      const createdAt = user.created_at ? new Date(user.created_at).toISOString().replace("T", " ").split(".")[0] : "";
      const confirmed = user.email_confirmed_at ? "Yes" : "No";
      
      // Escape email if it contains commas
      const escapedEmail = email.includes(",") ? `"${email}"` : email;
      
      csvRows.push(`${id},${escapedEmail},${createdAt},${confirmed}`);
    }

    const csvContent = csvRows.join("\n");

    return new Response(csvContent, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="registered_users_${new Date().toISOString().split("T")[0]}.csv"`,
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
