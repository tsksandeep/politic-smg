// functions/oauth-start (T034) — begin cadre consent via Nango. POST { cadre_id, platform } →
// { connect_session_token, connect_link, provider_config_key }. The SPA hands the session token to
// the Nango frontend SDK, which renders the consent UI and runs the OAuth dance (against the mock
// locally, real Meta/Google in prod). Only Creator/Business IG + YouTube are supported (FR-001);
// the unsupported-account check happens at oauth-callback once we can read the account.

import { createConnectSession } from "../../shared/nango.ts";
import { errorResponse, jsonResponse, preflight } from "../../shared/log.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "POST only");
  const { cadre_id, platform } = await req.json();
  if (!["instagram", "youtube"].includes(platform)) {
    return errorResponse(400, "unsupported_platform", "platform must be instagram or youtube");
  }
  if (!cadre_id) return errorResponse(400, "missing_cadre", "cadre_id required");

  try {
    // provider_config_key matches the Nango integration unique_key (instagram / youtube).
    const session = await createConnectSession(`cadre:${cadre_id}`, platform);
    return jsonResponse({
      connect_session_token: session.token,
      connect_link: session.connect_link,
      provider_config_key: platform,
    });
  } catch (e) {
    return errorResponse(502, "nango_error", String(e));
  }
});
