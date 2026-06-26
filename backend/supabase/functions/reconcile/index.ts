// functions/reconcile/index.ts — reconcile redundant submissions + adjust node trust (cron).
//
// Thin trigger over reconcile_submissions() (0007_detection.sql): cross-checks the 2–3 redundant
// submissions per target, flags divergence, decays/raises node trust, and quarantines persistently
// low-trust nodes (Principle VII — a compromised node can't silently poison metrics). Reports counts.

import { serviceClient } from "../../shared/db.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("reconcile");

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const db = serviceClient();

  const { error } = await db.rpc("reconcile_submissions");
  if (error) {
    log.error("reconcile_submissions failed", { err: error.message });
    return errorResponse(500, "reconcile_failed", "reconcile_submissions failed.");
  }

  const { count: diverged } = await db.from("submission")
    .select("*", { count: "exact", head: true }).eq("reconciled", true).eq("diverged", true);
  const { count: pending } = await db.from("submission")
    .select("*", { count: "exact", head: true }).eq("reconciled", false);
  const { count: quarantined } = await db.from("node")
    .select("*", { count: "exact", head: true }).eq("status", "quarantined");

  log.info("submissions reconciled", { diverged, pending, quarantined });
  return jsonResponse({
    ok: true,
    diverged: diverged ?? 0,
    pending_unreconciled: pending ?? 0,
    quarantined_nodes: quarantined ?? 0,
  });
});
