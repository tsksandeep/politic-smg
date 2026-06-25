// functions/alert-detail (T028) — GET /alert-detail?id=<uuid>
// Returns board fields PLUS anonymized example comments and honest-signal labels.
// Commenter identity is NEVER included (FR-008). All probabilistic values are wrapped as
// signals (Principle V). Caller's JWT is forwarded so RLS (staff-read) applies.

import { createClient } from "npm:@supabase/supabase-js@2";
import { asSignal } from "../../shared/labels.ts";
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
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return errorResponse(400, "missing_id", "id query param required");

  const db = userClient(req);

  const { data: alert, error } = await db.from("alert_board").select("*").eq("id", id)
    .maybeSingle();
  if (error) return errorResponse(403, "forbidden", error.message);
  if (!alert) return errorResponse(404, "not_found", "alert not found");

  // Resolve narrative id via the alert row to pull anonymized example comments.
  const { data: alertRow } = await db.from("alert").select("narrative_id").eq("id", id).single();
  const { data: examples } = await db
    .from("comment")
    .select("body, sentiment, sentiment_confidence, language") // NO commenter_hash, NO identity
    .eq("narrative_id", alertRow?.narrative_id)
    .not("body", "is", null)
    .limit(8);

  return jsonResponse({
    ...alert,
    confidence_signal: asSignal(
      alert.confidence ?? 0,
      alert.confidence ?? 0,
      "anti-party narrative",
    ),
    coordination_signal: asSignal(
      alert.coordination_score ?? 0,
      alert.coordination_score ?? 0,
      "coordinated activity",
    ),
    example_comments: examples ?? [],
    labels: { is_signal_not_verdict: true },
  });
});
