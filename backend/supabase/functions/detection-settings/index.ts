// functions/detection-settings/index.ts — read/update a tenant's detection thresholds (USER JWT).
//
// verify_jwt = true. Uses a PER-REQUEST client forwarding the caller's Authorization header so RLS +
// current_tenant() apply (Principle I) — NOT the service role.
//   GET → the caller's own detection_settings row (settings_read: any staff).
//   PUT/PATCH → update thresholds (settings_admin_write: Admin only; RLS blocks non-admins).
// A user can only ever touch their own tenant's single settings row (FR-011).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("detection-settings");

// Only these threshold columns are user-tunable.
const ALLOWED = [
  "emerging_velocity_threshold",
  "coordination_window",
  "coordination_min_accounts",
  "min_cluster_volume",
  "sim_threshold",
] as const;

function userClient(authHeader: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not set");
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse(401, "unauthorized", "Missing Authorization bearer.");

  const db = userClient(authHeader);

  // ---- GET: return the tenant's settings row (RLS scopes it to the one row) ----
  if (req.method === "GET") {
    const { data, error } = await db.from("detection_settings").select("*").maybeSingle();
    if (error) {
      log.error("settings read failed", { err: error.message });
      return errorResponse(403, "forbidden", "Not permitted to read settings.");
    }
    if (!data) return errorResponse(404, "not_found", "No detection_settings row for your tenant.");
    return jsonResponse({ settings: data });
  }

  // ---- PUT/PATCH: Admin updates thresholds (RLS settings_admin_write enforces Admin) ----
  if (req.method === "PUT" || req.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "bad_request", "Body must be JSON.");
    }

    const patch: Record<string, unknown> = {};
    for (const k of ALLOWED) {
      if (body[k] !== undefined && body[k] !== null) patch[k] = body[k];
    }
    if (Object.keys(patch).length === 0) {
      return errorResponse(400, "bad_request", `Provide at least one of: ${ALLOWED.join(", ")}.`);
    }

    // Stamp the editor + time. updated_by must be the caller's own user id (RLS allows only same-tenant).
    const { data: who } = await db.auth.getUser();
    if (who?.user?.id) patch.updated_by = who.user.id;
    patch.updated_at = new Date().toISOString();

    // No tenant filter needed: RLS confines the UPDATE to the caller's own row, and a non-admin's
    // UPDATE matches zero rows (the admin-write policy denies it) → returns null → 403.
    const { data, error } = await db.from("detection_settings").update(patch).select("*")
      .maybeSingle();
    if (error) {
      log.error("settings update failed", { err: error.message });
      return errorResponse(403, "forbidden", "Not permitted to update settings (Admin only).");
    }
    if (!data) return errorResponse(403, "forbidden", "Update blocked — Admin role required.");

    log.info("settings updated", { fields: Object.keys(patch) });
    return jsonResponse({ settings: data });
  }

  return errorResponse(405, "method_not_allowed", "Use GET or PUT.");
});
