// functions/user-invite — Admin adds a staff member (Admin/Analyst) to their OWN tenant.
// Runs with the service role (creating an auth user + tenant_user row needs it), but is gated to the
// caller's Admin role and pins the new user to the caller's tenant — an Admin can never provision a
// user into another tenant (Principle I, FR-016).

import { serviceClient } from "../../shared/db.ts";
import { requireAdmin, AuthError } from "../../shared/admin-auth.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("user-invite");

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "POST only");

  try {
    const caller = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const email = (body.email ?? "").trim().toLowerCase();
    const role = body.role === "admin" ? "admin" : "analyst";
    if (!email || !email.includes("@")) return errorResponse(400, "invalid_email", "valid email required");

    const svc = serviceClient();

    // Create (or find) the auth user, then attach a tenant_user row in the caller's tenant.
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    let userId = created?.user?.id;
    if (createErr || !userId) {
      // Already exists → look them up by listing (small tenants; fine for provisioning).
      const { data: list } = await svc.auth.admin.listUsers();
      userId = list?.users?.find((u) => u.email?.toLowerCase() === email)?.id;
      if (!userId) return errorResponse(409, "user_exists_elsewhere", "could not provision user");
    }

    const { error: tuErr } = await svc.from("tenant_user").insert({
      id: userId,
      tenant_id: caller.tenantId,
      role,
    });
    if (tuErr) {
      // Unique violation = already a member (possibly of another tenant); do not leak which.
      return errorResponse(409, "already_a_member", "user is already attached to a tenant");
    }

    log.info("user invited", { tenant: caller.tenantId, role });
    return jsonResponse({ user_id: userId, role }, 201);
  } catch (e) {
    if (e instanceof AuthError) return errorResponse(e.status, e.code, e.code);
    log.error("user-invite failed", { error: String(e) });
    return errorResponse(500, "internal_error", "could not invite user");
  }
});
