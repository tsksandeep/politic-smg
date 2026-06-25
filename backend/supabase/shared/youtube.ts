// shared/youtube.ts — resolve a usable YouTube access token from a stored OAuth refresh token.
//
// Google/YouTube access tokens are short-lived (~1 hour), so they cannot be stored and reused for
// ongoing polling the way Instagram's long-lived token is. We therefore store the durable OAuth
// REFRESH token in Vault for YouTube accounts (see oauth-callback) and exchange it for a fresh
// access token on demand here (grant_type=refresh_token). The exchange goes through the same
// googleTokenUrl endpoint used at consent time, so the local mock covers this path too.

import { ENDPOINTS } from "./endpoints.ts";

/** Exchange a stored YouTube OAuth refresh token for a short-lived access token. */
export async function youtubeAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(ENDPOINTS.googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("YT_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("YT_CLIENT_SECRET") ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`YT access-token refresh ${res.status}: ${await res.text()}`);
  }
  const { access_token } = await res.json();
  if (!access_token) throw new Error("YT access-token refresh: response missing access_token");
  return access_token as string;
}
