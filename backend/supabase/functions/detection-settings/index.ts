// functions/detection-settings (T026) — read settings (staff) / update settings (Admin only).
// Authorization is enforced by RLS on detection_settings: the function forwards the caller's
// JWT to a user-scoped client so the admin-only UPDATE policy applies (FR-005, FR-016).

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorResponse, jsonResponse, preflight } from "../../shared/log.ts";

function userClient(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  const db = userClient(req);

  if (req.method === "GET") {
    const { data, error } = await db
      .from("detection_settings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return errorResponse(403, "forbidden", error.message);
    return jsonResponse(data);
  }

  if (req.method === "PUT") {
    const body = await req.json();
    const { data: current } = await db
      .from("detection_settings")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!current) return errorResponse(404, "not_found", "no settings row");

    // RLS denies this UPDATE for analysts (admin-only policy) → 403 surfaces naturally.
    const { data, error } = await db
      .from("detection_settings")
      .update({
        min_volume: body.min_volume,
        min_growth_rate: body.min_growth_rate,
        coordination_window: body.coordination_window,
        coordination_min_accounts: body.coordination_min_accounts,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id)
      .select()
      .maybeSingle();
    if (error || !data) return errorResponse(403, "forbidden", error?.message ?? "denied");
    return jsonResponse(data);
  }

  return errorResponse(405, "method_not_allowed", "GET or PUT");
});
