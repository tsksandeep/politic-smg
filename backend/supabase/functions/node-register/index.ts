// functions/node-register/index.ts — POST /node-register (Coordinator API).
//
// First-run node registration. The operator presents a tenant ENROLMENT CODE (issued by an Admin),
// not a node token. We verify the code → tenant_id (the node never asserts its own tenant — Principle
// I), create an `active` node with trust_score 0.5, store only the token HMAC, and return the raw
// node token EXACTLY ONCE. verify_jwt=false: nodes have no Supabase JWT.

import { serviceClient } from "../../shared/db.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";
import { verifyEnrolmentCode } from "../../shared/enrolment.ts";
import { generateNodeToken, hashNodeToken, NODE_RATE } from "../../shared/node-auth.ts";

const log = logger("node-register");

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST.");

  let body: { enrolment_code?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "bad_request", "Body must be JSON.");
  }

  const tenantId = await verifyEnrolmentCode(body.enrolment_code);
  if (!tenantId) {
    // Never echo the supplied code (Principle III).
    log.warn("rejected enrolment");
    return errorResponse(403, "invalid_enrolment", "Enrolment code is invalid or expired.");
  }

  const label = (body.label ?? "").toString().trim().slice(0, 120) || "unnamed-node";
  const rawToken = generateNodeToken();
  const tokenHash = await hashNodeToken(rawToken);

  const db = serviceClient();
  const { data, error } = await db
    .from("node")
    .insert({
      tenant_id: tenantId,
      label,
      token_hash: tokenHash,
      trust_score: 0.5,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) {
    log.error("node insert failed", { tenant_id: tenantId, code: error?.code });
    return errorResponse(500, "register_failed", "Could not register node.");
  }

  log.info("node registered", { tenant_id: tenantId, node_id: data.id });
  // Raw token returned once and never persisted (only its hash is stored).
  return jsonResponse({
    node_id: data.id,
    node_token: rawToken,
    tenant_id: tenantId,
    rate: NODE_RATE,
  }, 201);
});
