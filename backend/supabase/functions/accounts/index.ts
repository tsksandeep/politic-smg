// functions/accounts (T039) — GET list of connected accounts (RLS: staff read).
// Forwards the caller's JWT so row-level security applies; returns non-sensitive fields only
// (never the token reference).

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorResponse, jsonResponse, preflight } from "../../shared/log.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "GET") return errorResponse(405, "method_not_allowed", "GET only");
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    },
  );

  const { data, error } = await db
    .from("connected_account")
    .select(
      "id, cadre_id, platform, consent_status, connected_at, revoked_at, token_expires_at, backfill_done",
    )
    .order("connected_at", { ascending: false });
  if (error) return errorResponse(403, "forbidden", error.message);
  return jsonResponse(data ?? []);
});
