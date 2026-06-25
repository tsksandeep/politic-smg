// functions/oauth-callback (T035) — record a completed Nango connection. The SPA calls this (POST)
// after the Nango Connect UI fires its 'connect' event, which yields the connection_id. We:
//   1) read a token from Nango and resolve the SUPPORTED platform account id (IG business / YT
//      channel) — a personal IG account has no business account → unsupported, no data collected,
//   2) upsert the connected_account with its Nango connection handle,
//   3) kick off the 30-day backfill.
// Tokens are stored + auto-refreshed by Nango; we never persist them (Principle III).

import { serviceClient } from "../../shared/db.ts";
import { ENDPOINTS } from "../../shared/endpoints.ts";
import { getAccessToken } from "../../shared/nango.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";

const log = logger("oauth-callback");
const FUNCTIONS_BASE = Deno.env.get("FUNCTIONS_BASE_URL") ?? "";

// Resolve the platform account id used by ingestion. Returns null for an unsupported account.
async function resolveExternalId(platform: string, token: string): Promise<string | null> {
  if (platform === "instagram") {
    const pages = await (await fetch(
      `${ENDPOINTS.graphApi}/me/accounts?fields=instagram_business_account&access_token=${token}`,
    )).json();
    return pages.data?.map((p: { instagram_business_account?: { id: string } }) =>
      p.instagram_business_account?.id
    ).find(Boolean) ?? null;
  }
  const ch = await (await fetch(
    `${ENDPOINTS.youtubeApi}/channels?part=id&mine=true&access_token=${token}`,
  )).json();
  return ch.items?.[0]?.id ?? null;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "POST only");
  const { cadre_id, platform, connection_id } = await req.json();
  if (!cadre_id || !platform || !connection_id) {
    return errorResponse(400, "missing_params", "cadre_id, platform, connection_id required");
  }

  let externalId: string | null;
  try {
    const token = await getAccessToken(connection_id, platform);
    externalId = await resolveExternalId(platform, token);
  } catch (e) {
    log.error("account resolution failed", { error: String(e) });
    return errorResponse(502, "resolve_failed", "could not resolve account from Nango connection");
  }
  if (!externalId) {
    // No data collected for unsupported (e.g. personal IG) accounts.
    return errorResponse(
      422,
      "unsupported_account_type",
      "account is not a Creator/Business account",
    );
  }

  const db = serviceClient();
  const { data: account, error } = await db.from("connected_account").upsert({
    cadre_id,
    platform,
    external_id: externalId,
    consent_status: "connected",
    nango_connection_id: connection_id,
    provider_config_key: platform,
  }, { onConflict: "platform,external_id" }).select("id").single();
  if (error || !account) {
    log.error("account upsert failed", { error: error?.message });
    return errorResponse(500, "account_error", error?.message ?? "upsert failed");
  }

  // Fire-and-forget 30-day backfill (FR-010a).
  fetch(`${FUNCTIONS_BASE}/backfill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: account.id }),
  }).catch((e) => log.error("backfill kickoff failed", { error: String(e) }));

  return jsonResponse({ connected_account_id: account.id, platform, backfill: "queued" });
});
