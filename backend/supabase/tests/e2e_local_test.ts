// e2e_local_test.ts — comprehensive local end-to-end across EVERY Edge Function + DB path,
// against the mock external APIs (platform OAuth/data + embeddings) with optionally-real LLM.
//
// Drives the same code paths cron/webhooks/the SPA would, in deterministic sequence and asserts
// the observable result of each feature. Self-skips unless the local stack env is present, so a
// plain `deno test` stays green.
//
// Prereqs (the `make e2e` target wires these up): stack running + migrations applied; mock server
// running; functions served with the mock env; env: FUNCTIONS_URL, SUPABASE_URL, SERVICE_ROLE_KEY.

import { assert, assertEquals } from "std/assert/mod.ts";

const FUNCTIONS_URL = Deno.env.get("FUNCTIONS_URL");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_URL");
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const IG_APP_SECRET = Deno.env.get("IG_APP_SECRET") ?? "mock-ig-secret";
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
  } catch { /* redirect / empty */ }
  return { status: res.status, body, raw: text };
}

// Local JWT secret (the app is passwordless, so we mint a user JWT directly for RLS-scoped tests).
const JWT_SECRET = Deno.env.get("JWT_SECRET") ??
  "super-secret-jwt-token-with-at-least-32-characters-long";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

/** Create an admin app_user and return a minted JWT for it (RLS sees auth.uid() = sub). */
async function adminJwt(): Promise<string> {
  const email = `e2e-${crypto.randomUUID().slice(0, 8)}@politic.test`;
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svc,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`create user → ${created.status}: ${await created.text()}`);
  const { id } = await created.json();
  await pg("PATCH", `app_user?id=eq.${id}`, { role: "admin" }, "return=minimal");
  return await mintJwt(id);
}

async function hmacSha256Hex(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return "sha256=" + Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function onboard(cadreId: string, platform: "instagram" | "youtube", code: string) {
  const start = await fn("oauth-start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cadre_id: cadreId, platform }),
  });
  assertEquals(start.status, 200, `oauth-start(${platform}): ${start.raw}`);
  const state = start.body.state as string;
  const cb = await fetch(`${FUNCTIONS_URL}/oauth-callback?code=${code}&state=${encodeURIComponent(state)}`, {
    redirect: "manual",
  });
  await cb.body?.cancel();
  assert(cb.status >= 200 && cb.status < 400, `oauth-callback(${platform}) status ${cb.status}`);
}

Deno.test({
  name: "comprehensive local e2e: all Edge Functions + DB paths (mock externals)",
  ignore: !ready,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const jwt = await adminJwt();
    const [cadre] = await pg("POST", "cadre", { display_name: "e2e-cadre" }, "return=representation");
    const cadreId = cadre.id as string;
    let alertId = "";

    try {
      await t.step("US2: Instagram consent → connected account", async () => {
        await onboard(cadreId, "instagram", "mock_ig_code");
        const acc = await pg("GET", `connected_account?cadre_id=eq.${cadreId}&platform=eq.instagram&select=id,consent_status`);
        assertEquals(acc.length, 1);
        assertEquals(acc[0].consent_status, "connected");
      });

      const igAccount = (await pg("GET", `connected_account?cadre_id=eq.${cadreId}&platform=eq.instagram&select=id`))[0].id;

      await t.step("US2: backfill ingests last-30-day posts + comments", async () => {
        const bf = await fn("backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: igAccount }) });
        assertEquals(bf.status, 200, bf.raw);
        assert((bf.body.comments as number) >= 25, `ingested ${bf.body.comments} comments`);
      });

      await t.step("US1: analyze classifies + embeds (real LLM if configured)", async () => {
        const an = await fn("analyze-comments", { method: "POST" });
        assertEquals(an.status, 200, an.raw);
        assert((an.body.processed as number) >= 25, `analyzed ${an.body.processed}`);
      });

      await t.step("US1: detect raises a live, summarized alert", async () => {
        const det = await fn("detect-narratives", { method: "POST" });
        assertEquals(det.status, 200, det.raw);
        const board = await pg("GET", "alert_board?status=eq.open&select=id,volume,confidence,coordination_score,theme_summary&order=volume.desc");
        assert(board.length >= 1, "an open alert exists");
        assert(board[0].volume >= 25 && board[0].confidence > 0 && board[0].coordination_score > 0, `metrics ${JSON.stringify(board[0])}`);
        assert(board[0].theme_summary, "alert has a theme summary");
        alertId = board[0].id;
        console.log(`[e2e] alert vol=${board[0].volume} conf=${board[0].confidence} theme="${board[0].theme_summary}"`);
      });

      await t.step("US1: alert-detail returns anonymized examples + honest signals (RLS via admin JWT)", async () => {
        const d = await fn(`alert-detail?id=${alertId}`, {}, jwt);
        assertEquals(d.status, 200, d.raw);
        assert(d.body.confidence_signal && d.body.coordination_signal, "signals present");
        const examples = d.body.example_comments as Array<Record<string, unknown>>;
        assert(examples.length > 0, "example comments present");
        assert(!("commenter_hash" in examples[0]) && !("from" in examples[0]), "no commenter identity leaked");
      });

      await t.step("US3: triage acknowledge → close records response latency", async () => {
        const ack = await fn("alert-triage", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: alertId, status: "acknowledged" }) }, jwt);
        assertEquals(ack.status, 200, ack.raw);
        assertEquals(ack.body.status, "acknowledged");
        const close = await fn("alert-triage", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: alertId, status: "closed", response_note: "counter-message issued" }) }, jwt);
        assertEquals(close.status, 200, close.raw);
        const [row] = await pg("GET", `alert?id=eq.${alertId}&select=status,response_latency`);
        assertEquals(row.status, "closed");
        assert(row.response_latency !== null, "response_latency recorded");
      });

      await t.step("FR-005/FR-016: detection-settings admin read + tune", async () => {
        const get = await fn("detection-settings", { method: "GET" }, jwt);
        assertEquals(get.status, 200, get.raw);
        const put = await fn("detection-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ min_volume: 20, min_growth_rate: 2.0, coordination_window: "00:20:00", coordination_min_accounts: 8 }) }, jwt);
        assertEquals(put.status, 200, put.raw);
        assertEquals(put.body.min_volume, 20);
      });

      await t.step("FR-016: accounts list (no token reference leaked)", async () => {
        const acc = await fn("accounts", { method: "GET" }, jwt);
        assertEquals(acc.status, 200, acc.raw);
        const list = acc.body as unknown as Array<Record<string, unknown>>;
        assert(list.length >= 1 && !("token_ref" in list[0]), "accounts listed without token_ref");
      });

      await t.step("Ingestion: ig-webhook accepts a signed comment event", async () => {
        const payload = JSON.stringify({ entry: [{ id: "ig_biz_mock_1", changes: [{ field: "comments", value: { media: { id: "ig_post_webhook_1" }, text: "Corrupt liars, resign now", from: { id: "wh_user_1", username: "wh_user_1" }, created_time: Math.floor(Date.now() / 1000) } }] }] });
        const sig = await hmacSha256Hex(IG_APP_SECRET, payload);
        const wh = await fn("ig-webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": sig }, body: payload });
        assertEquals(wh.status, 200, wh.raw);
        assert((wh.body.accepted as number) >= 1, `webhook accepted ${wh.body.accepted}`);
        // A bad signature must be rejected.
        const bad = await fn("ig-webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=deadbeef" }, body: payload });
        assertEquals(bad.status, 401, "bad signature rejected");
      });

      await t.step("US2: YouTube consent → backfill", async () => {
        await onboard(cadreId, "youtube", "mock_yt_code");
        const yt = (await pg("GET", `connected_account?cadre_id=eq.${cadreId}&platform=eq.youtube&select=id`))[0];
        const bf = await fn("backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: yt.id }) });
        assertEquals(bf.status, 200, bf.raw);
        assert((bf.body.comments as number) >= 25, `YT ingested ${bf.body.comments} comments`);
      });

      await t.step("Principle VII: ingest-youtube stays gated until quota audit", async () => {
        const ig = await fn("ingest-youtube", { method: "POST" });
        assertEquals(ig.status, 200, ig.raw);
        assertEquals(ig.body.disabled, true, "YouTube polling gated off by default");
      });

      await t.step("Lifecycle: token-refresh renews expiring IG tokens", async () => {
        await pg("PATCH", `connected_account?id=eq.${igAccount}`, { token_expires_at: new Date(Date.now() + 86400_000).toISOString() }, "return=minimal");
        const tr = await fn("token-refresh", { method: "POST" });
        assertEquals(tr.status, 200, tr.raw);
        assert((tr.body.refreshed as number) >= 1, `refreshed ${tr.body.refreshed}`);
        const [row] = await pg("GET", `connected_account?id=eq.${igAccount}&select=token_expires_at`);
        assert(new Date(row.token_expires_at).getTime() > Date.now() + 50 * 86400_000, "expiry pushed ~60 days out");
      });

      await t.step("FR-010: account-revoke stops ingestion + recomputes", async () => {
        const rv = await fn("account-revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: igAccount }) }, jwt);
        assertEquals(rv.status, 200, rv.raw);
        const [row] = await pg("GET", `connected_account?id=eq.${igAccount}&select=consent_status`);
        assertEquals(row.consent_status, "revoked");
      });

      await t.step("Principle III: retention-purge deletes revoked-account content", async () => {
        const rp = await fn("retention-purge", { method: "POST" });
        assertEquals(rp.status, 200, rp.raw);
        const purged = rp.body.purged as Record<string, unknown> | undefined;
        assert(purged && "revoked_posts_deleted" in purged, `purge summary returned: ${rp.raw}`);
        const posts = await pg("GET", `post?connected_account_id=eq.${igAccount}&select=id`);
        assertEquals(posts.length, 0, "revoked account's posts purged");
      });

      console.log("[e2e] all feature steps passed ✓");
    } finally {
      await pg("DELETE", `cadre?id=eq.${cadreId}`).catch(() => {});
      await fn("detect-narratives", { method: "POST" }).catch(() => {});
    }
  },
});
