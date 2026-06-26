// functions/heartbeat/index.ts — POST /heartbeat (Coordinator API, FR-015).
//
// Liveness + health, sent on an interval whether or not work is leased. Updates node.last_seen_at,
// writes a node_heartbeat row (feeds the coverage-gap view), and tells the node how to behave: a
// blocked IP gets a backoff (Principle IX — degrade gracefully, surface the gap), and a quarantined /
// trust-decayed node is told to stand down (Principle VII). Unlike work-lease/submit we still answer a
// quarantined node so it learns its status; a revoked node is rejected.

import { serviceClient } from "../../shared/db.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";
import {
  BLOCKED_BACKOFF_MS,
  QUARANTINE_TRUST_THRESHOLD,
  verifyNodeToken,
} from "../../shared/node-auth.ts";

const log = logger("heartbeat");

const IP_STATUSES = new Set(["healthy", "throttled", "blocked"]);

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST.");

  const node = await verifyNodeToken(req);
  if (!node) return errorResponse(401, "invalid_node", "Missing or invalid node token.");
  if (node.status === "revoked") {
    return errorResponse(403, "node_revoked", "This node has been revoked.");
  }

  let body: { ok_count?: number; error_count?: number; ip_status?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const okCount = Math.max(0, Math.trunc(Number(body.ok_count ?? 0)) || 0);
  const errorCount = Math.max(0, Math.trunc(Number(body.error_count ?? 0)) || 0);
  const ipStatus = IP_STATUSES.has(body.ip_status ?? "") ? body.ip_status! : "healthy";

  const db = serviceClient();
  const tid = node.tenant_id;
  const nowIso = new Date().toISOString();

  await db.from("node").update({ last_seen_at: nowIso }).eq("id", node.node_id).eq(
    "tenant_id",
    tid,
  );
  const { error: hbErr } = await db.from("node_heartbeat").insert({
    tenant_id: tid,
    node_id: node.node_id,
    at: nowIso,
    ok_count: okCount,
    error_count: errorCount,
    ip_status: ipStatus,
  });
  if (hbErr) log.warn("heartbeat insert failed", { code: hbErr.code });

  const quarantined = node.status === "quarantined" ||
    node.trust_score < QUARANTINE_TRUST_THRESHOLD;
  const backoffMs = ipStatus === "blocked" ? BLOCKED_BACKOFF_MS : 0;

  log.info("heartbeat", { tenant_id: tid, node_id: node.node_id, ip_status: ipStatus });
  return jsonResponse({
    node_status: quarantined ? "quarantined" : "active",
    backoff_ms: backoffMs,
  });
});
