// shared/admin-auth.ts — resolve the calling tenant staffer from their Supabase JWT and enforce role.
// Used by privileged provisioning functions (node-enroll, user-invite) that must run with the service
// role (to mint codes / create auth users) but are only allowed for a tenant Admin. The caller's
// tenant is ALWAYS derived from their JWT → tenant_user row, never from the request body (Principle I).

import { createClient } from "npm:@supabase/supabase-js@2";
import { serviceClient } from "./db.ts";

export interface Caller {
  uid: string;
  tenantId: string;
  role: "admin" | "analyst";
}

export class AuthError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

/** Resolve the caller from `Authorization: Bearer <user-jwt>`; throws AuthError on failure. */
export async function resolveCaller(req: Request): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new AuthError(401, "missing_token");
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new AuthError(500, "server_misconfigured");

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new AuthError(401, "invalid_token");

  const { data: tu } = await serviceClient()
    .from("tenant_user").select("tenant_id, role").eq("id", user.id).maybeSingle();
  if (!tu) throw new AuthError(403, "not_a_tenant_user");
  return { uid: user.id, tenantId: tu.tenant_id, role: tu.role };
}

/** Resolve the caller and require the Admin role. */
export async function requireAdmin(req: Request): Promise<Caller> {
  const caller = await resolveCaller(req);
  if (caller.role !== "admin") throw new AuthError(403, "admin_only");
  return caller;
}
