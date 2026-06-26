// functions/alert-triage/index.ts — war-room alert triage (USER JWT, RLS-scoped).
//
// Called by the signed-in analyst/admin SPA (verify_jwt = true). Unlike the cron functions, this
// uses a PER-REQUEST client that forwards the caller's Authorization header, so RLS +
// current_tenant() apply (Principle I) — we do NOT use the service role here. A user can only ever
// triage their own tenant's alerts; another tenant's alert is invisible (reads as not_found).
//
// Actions: acknowledge | assign | annotate | close. response_latency is a GENERATED column
// (closed_at − detected_at), never computed client-side (contracts/realtime.md, FR-019).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("alert-triage");

type Action = "acknowledge" | "assign" | "annotate" | "close";
const ACTIONS = new Set<Action>(["acknowledge", "assign", "annotate", "close"]);

interface TriageBody {
  alert_id?: string;
  action?: Action;
  assignee_user_id?: string | null;
  note?: string;
}

// RLS client: anon key + the caller's JWT forwarded, so every query runs AS the user.
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
  if (req.method !== "POST" && req.method !== "PATCH") {
    return errorResponse(405, "method_not_allowed", "Use POST or PATCH.");
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse(401, "unauthorized", "Missing Authorization bearer.");

  let body: TriageBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "bad_request", "Body must be JSON.");
  }
  if (!body.alert_id) return errorResponse(400, "bad_request", "alert_id is required.");
  if (!body.action || !ACTIONS.has(body.action)) {
    return errorResponse(400, "bad_request", "action must be acknowledge|assign|annotate|close.");
  }

  const db = userClient(authHeader);
  const now = new Date().toISOString();

  // Read first (RLS-scoped) so we can preserve acknowledged_at and 404 cross-tenant/unknown alerts.
  const { data: existing, error: readErr } = await db.from("alert")
    .select("id, status, acknowledged_at").eq("id", body.alert_id).maybeSingle();
  if (readErr) {
    log.error("alert read failed", { err: readErr.message });
    return errorResponse(403, "forbidden", "Not permitted to read this alert.");
  }
  if (!existing) return errorResponse(404, "not_found", "Alert not found in your tenant.");

  const patch: Record<string, unknown> = {};
  switch (body.action) {
    case "acknowledge":
      patch.status = "acknowledged";
      patch.acknowledged_at = existing.acknowledged_at ?? now;
      break;
    case "assign":
      if (!body.assignee_user_id) {
        return errorResponse(400, "bad_request", "assignee_user_id is required.");
      }
      patch.assignee_user_id = body.assignee_user_id;
      if (existing.status === "open") {
        patch.status = "acknowledged";
        patch.acknowledged_at = existing.acknowledged_at ?? now;
      }
      break;
    case "annotate":
      if (!body.note) return errorResponse(400, "bad_request", "note is required.");
      patch.response_note = body.note;
      break;
    case "close":
      patch.status = "closed";
      patch.closed_at = now;
      patch.acknowledged_at = existing.acknowledged_at ?? now;
      if (body.note) patch.response_note = body.note;
      break;
  }

  const { data: updated, error: upErr } = await db.from("alert").update(patch)
    .eq("id", body.alert_id)
    .select(
      "id, status, assignee_user_id, acknowledged_at, closed_at, response_note, response_latency",
    )
    .maybeSingle();
  if (upErr) {
    log.error("alert triage update failed", { err: upErr.message });
    return errorResponse(403, "forbidden", "Not permitted to triage this alert.");
  }
  if (!updated) return errorResponse(403, "forbidden", "Update was blocked by access policy.");

  log.info("alert triaged", { action: body.action });
  return jsonResponse({ alert: updated });
});
