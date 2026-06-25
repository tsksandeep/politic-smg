// boundary_assign_test.ts — two gaps not covered elsewhere:
//   • FR-011 / Principle II: ingestion is refused for accounts outside the consented perimeter —
//     a (validly signed) webhook for an unknown/non-connected account stores nothing.
//   • FR-013: an analyst can ASSIGN an alert (assignee_user_id), not only acknowledge/close.
// Function-backed; self-skips unless the local stack env is present (same guard style as e2e).

import { assertEquals } from "std/assert/mod.ts";

const FUNCTIONS_URL = Deno.env.get("FUNCTIONS_URL");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_URL");
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const IG_APP_SECRET = Deno.env.get("IG_APP_SECRET") ?? "mock-ig-secret";
const JWT_SECRET = Deno.env.get("JWT_SECRET") ??
  "super-secret-jwt-token-with-at-least-32-characters-long";
const ready = Boolean(FUNCTIONS_URL && SUPABASE_URL && SERVICE_KEY);

const svc = {
  "apikey": SERVICE_KEY ?? "",
  "Authorization": `Bearer ${SERVICE_KEY ?? ""}`,
  "Content-Type": "application/json",
};

async function pg(method: string, path: string, body?: unknown, prefer?: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: prefer ? { ...svc, Prefer: prefer } : svc,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fn(name: string, init: RequestInit = {}, bearer?: string) {
  const headers = new Headers(init.headers);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, { ...init, headers });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch { /* empty */ }
  return { status: res.status, body, raw: text };
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacHex(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return "sha256=" +
    Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintJwt(sub: string): Promise<string> {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const now = Math.floor(Date.now() / 1000);
  const data = `${enc({ alg: "HS256", typ: "JWT" })}.${
    enc({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 })
  }`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

/** Create an admin app_user; return its id + a minted JWT (RLS sees auth.uid() = id). */
async function adminUser(): Promise<{ id: string; jwt: string }> {
  const email = `e2e-${crypto.randomUUID().slice(0, 8)}@politic.test`;
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svc,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`create user → ${created.status}: ${await created.text()}`);
  const { id } = await created.json();
  await pg("PATCH", `app_user?id=eq.${id}`, { role: "admin" }, "return=minimal");
  return { id, jwt: await mintJwt(id) };
}

Deno.test({
  name: "FR-011: a signed webhook for a non-connected account ingests nothing",
  ignore: !ready,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const payload = JSON.stringify({
      entry: [{
        id: "ig_biz_NOT_CONNECTED_" + crypto.randomUUID().slice(0, 8),
        changes: [{
          field: "comments",
          value: {
            media: { id: "ig_post_outside_perimeter" },
            text: "Corrupt liars, resign now",
            from: { id: "outsider_1", username: "outsider_1" },
            created_time: Math.floor(Date.now() / 1000),
          },
        }],
      }],
    });
    const wh = await fn("ig-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": await hmacHex(IG_APP_SECRET, payload),
      },
      body: payload,
    });
    assertEquals(wh.status, 200, wh.raw);
    assertEquals(
      wh.body.accepted,
      0,
      "no comment ingested for an account outside the consented perimeter",
    );
    const posts = await pg("GET", "post?platform_post_id=eq.ig_post_outside_perimeter&select=id");
    assertEquals(posts.length, 0, "no post row created for the unknown account");
  },
});

Deno.test({
  name: "FR-013: an alert can be assigned to a user via triage",
  ignore: !ready,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { id: userId, jwt } = await adminUser();
    const [narr] = await pg(
      "POST",
      "narrative",
      {
        theme_summary: "assign-test",
        volume: 50,
        confidence: 0.9,
        coordination_score: 1,
        stance: "anti_party",
      },
      "return=representation",
    );
    const [alert] = await pg(
      "POST",
      "alert",
      {
        narrative_id: narr.id,
        status: "open",
        detected_at: new Date(Date.now() - 60000).toISOString(),
      },
      "return=representation",
    );
    try {
      const res = await fn("alert-triage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: alert.id, status: "acknowledged", assignee_user_id: userId }),
      }, jwt);
      assertEquals(res.status, 200, res.raw);
      assertEquals(res.body.assignee_user_id, userId, "alert is assigned to the user");
      assertEquals(res.body.status, "acknowledged", "status updated alongside assignment");
    } finally {
      await pg("DELETE", `narrative?id=eq.${narr.id}`).catch(() => {});
    }
  },
});
