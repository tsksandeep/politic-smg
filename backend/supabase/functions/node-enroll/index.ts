// functions/node-enroll — Admin issues a node-enrolment code for their tenant (war-room Admin page).
// The operator then enters this code in the browser-extension node, which calls /node-register to
// exchange it for a node token. The code is a self-contained, short-lived HMAC artifact (no DB row);
// the tenant it grants is fixed at mint time and cannot be altered by the node (Principle I/IV).

import { mintEnrolmentCode } from "../../shared/enrolment.ts";
import { requireAdmin, AuthError } from "../../shared/admin-auth.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("node-enroll");
const DEFAULT_TTL = 7 * 24 * 3600; // 7 days

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "POST only");

  try {
    const caller = await requireAdmin(req);
    let ttl = DEFAULT_TTL;
    try {
      const body = await req.json();
      if (body && Number.isFinite(body.ttl_seconds)) ttl = Math.min(Number(body.ttl_seconds), 30 * 24 * 3600);
    } catch { /* empty body is fine */ }

    const code = await mintEnrolmentCode(caller.tenantId, ttl);
    log.info("enrolment code issued", { tenant: caller.tenantId, ttl });
    return jsonResponse({ enrolment_code: code, expires_in: ttl });
  } catch (e) {
    if (e instanceof AuthError) return errorResponse(e.status, e.code, e.code);
    log.error("node-enroll failed", { error: String(e) });
    return errorResponse(500, "internal_error", "could not issue enrolment code");
  }
});
