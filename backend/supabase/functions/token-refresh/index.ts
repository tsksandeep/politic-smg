// functions/token-refresh (T038) — pg_cron daily. Refreshes Instagram long-lived tokens
// nearing the ~60-day expiry so consented ingestion keeps working without re-auth.
//
// IG accounts are connected via Facebook Login, so the stored token is a long-lived Facebook
// user access token. Extending it uses the fb_exchange_token grant, which returns a fresh token
// (~60-day lifetime). The current token is read from Vault, the new one is rotated back into the
// same Vault secret, and token_expires_at is updated from the API's expires_in.

import { serviceClient } from "../../shared/db.ts";
import { ENDPOINTS } from "../../shared/endpoints.ts";
import { jsonResponse, logger } from "../../shared/log.ts";

const log = logger("token-refresh");
const IG_APP_ID = Deno.env.get("IG_APP_ID") ?? "";
const IG_APP_SECRET = Deno.env.get("IG_APP_SECRET") ?? "";
const SIXTY_DAYS_S = 60 * 86400;

Deno.serve(async () => {
  if (!IG_APP_ID || !IG_APP_SECRET) {
    log.error("IG app credentials not configured; cannot refresh tokens");
    return jsonResponse({ error: "ig_app_not_configured", refreshed: 0 }, 503);
  }

  const db = serviceClient();
  // Accounts whose token expires within 7 days.
  const soon = new Date(Date.now() + 7 * 86400_000).toISOString();
  const { data: accounts } = await db
    .from("connected_account")
    .select("id, platform, token_expires_at")
    .eq("platform", "instagram")
    .eq("consent_status", "connected")
    .lt("token_expires_at", soon);

  let refreshed = 0;
  let failed = 0;
  for (const acct of accounts ?? []) {
    try {
      const { data: token } = await db.rpc("read_account_token", { p_account: acct.id });
      if (!token) {
        log.warn("no token in vault for account", { account: acct.id });
        failed++;
        continue;
      }

      const res = await fetch(
        `${ENDPOINTS.graphApi}/oauth/access_token?` +
          new URLSearchParams({
            grant_type: "fb_exchange_token",
            client_id: IG_APP_ID,
            client_secret: IG_APP_SECRET,
            fb_exchange_token: token as string,
          }),
      );
      if (!res.ok) {
        log.error("refresh http error", { account: acct.id, status: res.status });
        failed++;
        continue;
      }
      const { access_token, expires_in } = await res.json();
      if (!access_token) {
        log.error("refresh response missing access_token", { account: acct.id });
        failed++;
        continue;
      }

      // Rotate the new token back into the same Vault secret (reference unchanged).
      await db.rpc("rotate_account_token", { p_account: acct.id, p_token: access_token });
      const ttl = Number(expires_in) > 0 ? Number(expires_in) : SIXTY_DAYS_S;
      const newExpiry = new Date(Date.now() + ttl * 1000).toISOString();
      await db.from("connected_account").update({ token_expires_at: newExpiry }).eq("id", acct.id);
      refreshed++;
    } catch (e) {
      failed++;
      log.error("refresh failed", { account: acct.id, error: String(e) });
    }
  }

  log.info("token refresh done", { refreshed, failed, candidates: accounts?.length ?? 0 });
  return jsonResponse({ refreshed, failed });
});
