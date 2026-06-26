// functions/assign-work/index.ts — generate redundant, velocity-aware work assignments (cron).
//
// Thin trigger over generate_assignments() (0007_detection.sql), which creates the redundant
// (2–3 node) account captures and velocity re-sampling leases per active tenant (Principles VI/VII,
// FR-004/006). This function just invokes it and reports current queue depth.

import { serviceClient } from "../../shared/db.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("assign-work");

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const db = serviceClient();

  const { error } = await db.rpc("generate_assignments");
  if (error) {
    log.error("generate_assignments failed", { err: error.message });
    return errorResponse(500, "assign_failed", "generate_assignments failed.");
  }

  const { count: pending } = await db.from("work_assignment")
    .select("*", { count: "exact", head: true }).eq("state", "pending");
  const { count: leased } = await db.from("work_assignment")
    .select("*", { count: "exact", head: true }).eq("state", "leased");

  log.info("assignments generated", { pending, leased });
  return jsonResponse({ ok: true, pending: pending ?? 0, leased: leased ?? 0 });
});
