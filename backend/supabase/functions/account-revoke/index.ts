// functions/account-revoke (T037) — POST { account_id }. Admin-only.
// Stops ingestion IMMEDIATELY (consent flip; ingestion funcs skip non-connected accounts) and
// recomputes so the account's data drops out of active alerts at once (FR-010 / T037a). The
// physical deletion of its content happens on the scheduled retention-purge run.

import { createClient } from "npm:@supabase/supabase-js@2";
import { serviceClient } from "../../shared/db.ts";
import { errorResponse, jsonResponse, preflight } from "../../shared/log.ts";

async function callerRole(req: Request): Promise<string | null> {
  const user = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    },
  );
  const { data } = await user.rpc("current_app_role");
  return (data as string | null) ?? null;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "POST only");
  if ((await callerRole(req)) !== "admin") {
    return errorResponse(403, "forbidden", "admin role required to revoke accounts");
  }

  const { account_id } = await req.json();
  const db = serviceClient();

  const { error } = await db
    .from("connected_account")
    .update({ consent_status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", account_id);
  if (error) return errorResponse(400, "revoke_failed", error.message);

  // Immediate exclusion from active detection; physical purge runs on schedule.
  await db.rpc("recompute_after_revoke");

  return jsonResponse({ status: "revoked", purge: "scheduled" });
});
