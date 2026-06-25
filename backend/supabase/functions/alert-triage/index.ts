// functions/alert-triage (T042) — PATCH triage for an alert (User Story 3, FR-013/FR-014).
// Body: { id, status?, assignee_user_id?, response_note? }. Staff-only via RLS (the caller's
// JWT is forwarded; the alert_triage_update policy enforces is_staff()). Sets acknowledged_at /
// closed_at; closing records response_latency (generated column → SC-006). Change broadcasts
// live to other analysts via Realtime on the alert table.

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorResponse, jsonResponse, preflight } from "../../shared/log.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "PATCH") return errorResponse(405, "method_not_allowed", "PATCH only");
  const body = await req.json();
  if (!body.id) return errorResponse(400, "missing_id", "alert id required");

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    },
  );

  const patch: Record<string, unknown> = {};
  if (body.assignee_user_id !== undefined) patch.assignee_user_id = body.assignee_user_id;
  if (body.response_note !== undefined) patch.response_note = body.response_note;
  if (body.status === "acknowledged") {
    patch.status = "acknowledged";
    patch.acknowledged_at = new Date().toISOString();
  } else if (body.status === "closed") {
    patch.status = "closed";
    patch.closed_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from("alert")
    .update(patch)
    .eq("id", body.id)
    .select("id, status, assignee_user_id, acknowledged_at, closed_at, response_note")
    .maybeSingle();
  if (error || !data) return errorResponse(403, "forbidden", error?.message ?? "denied");
  return jsonResponse(data);
});
