// functions/oauth-callback (T035) — handle the platform redirect after consent.
// Exchanges code → token, verifies the account is a SUPPORTED type (Creator/Business for IG),
// creates the connected_account, stores the token in Vault (reference only), and kicks off the
// 30-day backfill. Unsupported (e.g. personal IG) → 422 with guidance, NO data collected (FR Acc 2.3).

import { serviceClient } from "../../shared/db.ts";
import { ENDPOINTS } from "../../shared/endpoints.ts";
import { errorResponse, logger } from "../../shared/log.ts";

const log = logger("oauth-callback");
const FUNCTIONS_BASE = Deno.env.get("FUNCTIONS_BASE_URL") ?? "";
const REDIRECT = `${FUNCTIONS_BASE}/oauth-callback`;
// Where to send the cadre's browser back to after consent (the onboarding UI reads ?error=/?connected=).
const FRONTEND_ORIGIN = Deno.env.get("FRONTEND_ORIGIN") ?? "http://localhost:5173";

/** Redirect the browser back to the onboarding page with a status query param. */
function backToOnboarding(params: Record<string, string>): Response {
  const qs = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 303,
    headers: { Location: `${FRONTEND_ORIGIN}/onboarding?${qs}` },
  });
}

interface TokenResult {
  accessToken: string;
  externalId: string;
  supported: boolean;
  reason?: string;
}

// Exchange + account-type verification. The external HTTP calls are platform-specific;
// IG must resolve an instagram_business_account (else unsupported personal account).
async function exchange(platform: string, code: string): Promise<TokenResult> {
  if (platform === "instagram") {
    const tokenRes = await fetch(
      `${ENDPOINTS.graphApi}/oauth/access_token?` +
        new URLSearchParams({
          client_id: Deno.env.get("IG_APP_ID") ?? "",
          client_secret: Deno.env.get("IG_APP_SECRET") ?? "",
          redirect_uri: REDIRECT,
          code,
        }),
    );
    if (!tokenRes.ok) throw new Error(`IG token ${tokenRes.status}: ${await tokenRes.text()}`);
    const { access_token } = await tokenRes.json();

    // Resolve a connected IG business account via the user's Pages.
    const pages = await (await fetch(
      `${ENDPOINTS.graphApi}/me/accounts?fields=instagram_business_account&access_token=${access_token}`,
    )).json();
    const iga = pages.data?.map((p: { instagram_business_account?: { id: string } }) =>
      p.instagram_business_account?.id
    ).find(Boolean);
    if (!iga) {
      return {
        accessToken: access_token,
        externalId: "",
        supported: false,
        reason: "no_business_account",
      };
    }
    return { accessToken: access_token, externalId: iga, supported: true };
  }

  // youtube
  const tokenRes = await fetch(ENDPOINTS.googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("YT_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("YT_CLIENT_SECRET") ?? "",
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!tokenRes.ok) throw new Error(`YT token ${tokenRes.status}: ${await tokenRes.text()}`);
  const { access_token } = await tokenRes.json();
  const ch = await (await fetch(
    `${ENDPOINTS.youtubeApi}/channels?part=id&mine=true&access_token=${access_token}`,
  )).json();
  const channelId = ch.items?.[0]?.id;
  if (!channelId) {
    return { accessToken: access_token, externalId: "", supported: false, reason: "no_channel" };
  }
  return { accessToken: access_token, externalId: channelId, supported: true };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return errorResponse(400, "missing_params", "code and state required");

  const db = serviceClient();
  const { data: st } = await db.from("oauth_state").select("*").eq("state", state).maybeSingle();
  if (!st) return errorResponse(400, "bad_state", "unknown or expired state");

  let result: TokenResult;
  try {
    result = await exchange(st.platform, code);
  } catch (e) {
    log.error("token exchange failed", { error: String(e) });
    await db.from("oauth_state").delete().eq("state", state);
    return backToOnboarding({ error: "exchange_failed" });
  }

  if (!result.supported) {
    // No data is collected for unsupported (e.g. personal) accounts.
    await db.from("oauth_state").delete().eq("state", state);
    return backToOnboarding({ error: "unsupported_account_type" });
  }

  const { data: account, error } = await db.from("connected_account").upsert({
    cadre_id: st.cadre_id,
    platform: st.platform,
    external_id: result.externalId,
    consent_status: "connected",
    token_ref: "pending",
  }, { onConflict: "platform,external_id" }).select("id").single();
  if (error || !account) {
    log.error("account upsert failed", { error: error?.message });
    await db.from("oauth_state").delete().eq("state", state);
    return backToOnboarding({ error: "account_error" });
  }

  await db.rpc("store_account_token", { p_account: account.id, p_token: result.accessToken });
  await db.from("oauth_state").delete().eq("state", state);

  // Fire-and-forget 30-day backfill (FR-010a).
  fetch(`${FUNCTIONS_BASE}/backfill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: account.id }),
  }).catch((e) => log.error("backfill kickoff failed", { error: String(e) }));

  return backToOnboarding({ connected: "1", platform: st.platform });
});
