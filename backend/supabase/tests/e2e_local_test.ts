// e2e_local_test.ts — full local pipeline against the mock external APIs (no real credentials).
//
// Drives the SAME code paths cron/webhooks would, in deterministic sequence:
//   oauth-start → oauth-callback (mock consent) → backfill (mock IG media+comments)
//   → analyze-comments (mock OpenRouter + Gemini) → detect-narratives → assert a live alert.
//
// Prereqs (the `make e2e` target wires these up):
//   - supabase stack running, migrations applied
//   - mock server running (make mock)
//   - edge functions served with mock env (make functions-mock)
//   - env: FUNCTIONS_URL, SUPABASE_URL, SERVICE_ROLE_KEY
// The test self-skips if those env vars are absent, so plain `deno test` stays green.

import { assert, assertEquals } from "std/assert/mod.ts";

const FUNCTIONS_URL = Deno.env.get("FUNCTIONS_URL");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_URL");
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ready = Boolean(FUNCTIONS_URL && SUPABASE_URL && SERVICE_KEY);

const rest = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`;
const svcHeaders = {
  "apikey": SERVICE_KEY ?? "",
  "Authorization": `Bearer ${SERVICE_KEY ?? ""}`,
  "Content-Type": "application/json",
};

async function pg(method: string, path: string, body?: unknown, prefer?: string) {
  const res = await fetch(rest(path), {
    method,
    headers: prefer ? { ...svcHeaders, Prefer: prefer } : svcHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fn(name: string, init?: RequestInit) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, init);
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch { /* non-JSON (e.g. redirect body) */ }
  return { status: res.status, body: parsed as Record<string, unknown> };
}

Deno.test({
  name: "local end-to-end: consent → ingest → analyze → detect → live alert (mocked externals)",
  ignore: !ready,
  fn: async () => {
    // 1) Create a cadre to own the connected account.
    const [cadre] = await pg(
      "POST",
      "cadre",
      { display_name: "e2e-mock-cadre" },
      "return=representation",
    );
    const cadreId = cadre.id as string;

    try {
      // 2) Start consent — get the platform authorize URL + the server-issued state.
      const start = await fn("oauth-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadre_id: cadreId, platform: "instagram" }),
      });
      assertEquals(start.status, 200, `oauth-start: ${JSON.stringify(start.body)}`);
      const state = start.body.state as string;
      assert(state, "oauth-start returned a state");

      // 3) Simulate the browser returning from consent: hit oauth-callback with the mock code.
      //    oauth-callback calls the MOCK token + me/accounts endpoints and creates the account.
      const cb = await fetch(
        `${FUNCTIONS_URL}/oauth-callback?code=mock_ig_code&state=${encodeURIComponent(state)}`,
        { redirect: "manual" },
      );
      await cb.body?.cancel(); // consume body (303 redirect) to avoid a resource leak
      assert(cb.status >= 200 && cb.status < 400, `oauth-callback status ${cb.status}`);

      // 4) The connected account now exists for this cadre.
      const accounts = await pg(
        "GET",
        `connected_account?cadre_id=eq.${cadreId}&select=id,consent_status,external_id`,
      );
      assertEquals(accounts.length, 1, "one connected account created");
      assertEquals(accounts[0].consent_status, "connected");
      const accountId = accounts[0].id as string;

      // 5) Backfill — pulls mock IG media + comments (hostile burst).
      const bf = await fn("backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });
      assertEquals(bf.status, 200, `backfill: ${JSON.stringify(bf.body)}`);
      assert((bf.body.comments as number) >= 25, `backfill ingested ${bf.body.comments} comments (need ≥25)`);

      // 6) Analyze — mock OpenRouter classifies + mock Gemini embeds.
      const an = await fn("analyze-comments", { method: "POST" });
      assertEquals(an.status, 200, `analyze: ${JSON.stringify(an.body)}`);
      assert((an.body.processed as number) >= 25, `analyzed ${an.body.processed} comments`);

      // 7) Detect — cluster + threshold → raise alert, then mock-summarize the theme.
      const det = await fn("detect-narratives", { method: "POST" });
      assertEquals(det.status, 200, `detect: ${JSON.stringify(det.body)}`);

      // 8) Assert a live alert on the board, summarizing the hostile narrative.
      const board = await pg(
        "GET",
        "alert_board?status=eq.open&select=id,status,theme_summary,volume,confidence,coordination_score&order=volume.desc",
      );
      assert(board.length >= 1, "at least one open alert on the board");
      const top = board[0];
      assert(top.volume >= 25, `alert volume ${top.volume} (≥25)`);
      assert(top.confidence > 0, `alert confidence ${top.confidence} > 0`);
      assert(top.theme_summary && String(top.theme_summary).length > 0, "alert has a theme summary");
      assert(top.coordination_score > 0, `coordination signal ${top.coordination_score} > 0`);

      console.log(
        `[e2e] OK — alert volume=${top.volume} conf=${top.confidence} coord=${top.coordination_score} theme="${top.theme_summary}"`,
      );
    } finally {
      // Cleanup — deleting the cadre cascades to account/posts/comments; recompute closes alerts.
      await pg("DELETE", `cadre?id=eq.${cadreId}`).catch(() => {});
      await fn("detect-narratives", { method: "POST" }).catch(() => {});
    }
  },
});
