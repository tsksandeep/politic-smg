// functions/retention-purge/index.ts — automated raw-text + media purge (cron, service role).
//
// Principle III (NON-NEGOTIABLE — data minimisation / no-warehousing): raw text columns
// (post.caption, comment.body) carry a retention window and MUST be purged on schedule (FR-018), and
// raw media is NEVER warehoused — media_url is cleared the moment a transcript is emitted, and this
// job nulls any leftover media_url as defence-in-depth.
//
// Retention window: the launch IN-DPDP profile is 30 days (overridable per deployment via
// RETENTION_DAYS). There is no per-tenant retention column in the schema yet, so the same default
// applies to every tenant; the loop is per-tenant so future per-tenant windows drop in cleanly and
// so counts are reported per tenant. Anchors: post.first_seen_at / comment.ingested_at (when we
// captured the text), which is the correct retention clock — not the source timestamp.

import { serviceClient } from "../../shared/db.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("retention-purge");

const RETENTION_DAYS = Number(Deno.env.get("RETENTION_DAYS") ?? "30");

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const db = serviceClient();

  // Delegate to the canonical SQL routine (migration 0007). One set-based UPDATE per column across
  // all tenants — no PostgREST row cap, one shared definition with the tests. p_tenant=null = all.
  const { error } = await db.rpc("retention_purge", { p_tenant: null, p_days: RETENTION_DAYS });
  if (error) {
    log.error("retention purge failed", { err: error.message });
    return errorResponse(500, "purge_failed", "Could not run retention purge.");
  }

  log.info("retention purge complete", { retention_days: RETENTION_DAYS });
  return jsonResponse({ ok: true, retention_days: RETENTION_DAYS });
});
