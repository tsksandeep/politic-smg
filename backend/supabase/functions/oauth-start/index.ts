// functions/oauth-start (T034) — POST { cadre_id, platform } → { authorize_url, state }.
// Persists a short-lived oauth_state row; the client redirects the cadre to the platform's
// consent screen. Only Creator/Business IG + YouTube are supported (FR-001).

import { serviceClient } from "../../shared/db.ts";
import { ENDPOINTS } from "../../shared/endpoints.ts";
import { errorResponse, jsonResponse, preflight } from "../../shared/log.ts";

const FUNCTIONS_BASE = Deno.env.get("FUNCTIONS_BASE_URL") ?? "";
const REDIRECT = `${FUNCTIONS_BASE}/oauth-callback`;

function authorizeUrl(platform: string, state: string): string {
  if (platform === "instagram") {
    const p = new URLSearchParams({
      client_id: Deno.env.get("IG_APP_ID") ?? "",
      redirect_uri: REDIRECT,
      state,
      response_type: "code",
      scope: "instagram_basic,instagram_manage_comments,pages_show_list,business_management",
    });
    return `${ENDPOINTS.facebookDialog}?${p}`;
  }
  // youtube
  const p = new URLSearchParams({
    client_id: Deno.env.get("YT_CLIENT_ID") ?? "",
    redirect_uri: REDIRECT,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    state,
    scope: "https://www.googleapis.com/auth/youtube.readonly",
  });
  return `${ENDPOINTS.googleAuthDialog}?${p}`;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "POST only");
  const { cadre_id, platform } = await req.json();
  if (!["instagram", "youtube"].includes(platform)) {
    return errorResponse(400, "unsupported_platform", "platform must be instagram or youtube");
  }

  const state = crypto.randomUUID();
  const db = serviceClient();
  const { error } = await db.from("oauth_state").insert({ state, cadre_id, platform });
  if (error) return errorResponse(400, "state_error", error.message);

  return jsonResponse({ authorize_url: authorizeUrl(platform, state), state });
});
