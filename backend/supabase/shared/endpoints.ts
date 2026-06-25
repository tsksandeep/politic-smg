// shared/endpoints.ts — every external API base URL in ONE place.
//
// Each is read from an env var with the REAL production endpoint as the default. Prod and local
// differ ONLY by these env values: in prod they are unset (real defaults apply); in local dev
// they point at backend/supabase/mocks/server.ts. No code path branches on environment.
//
// Consumers:
//   graphApi        → oauth-callback (token, me/accounts), token-refresh, backfill (media)
//   facebookDialog  → oauth-start (browser consent URL)
//   googleAuthDialog→ oauth-start (browser consent URL)
//   googleTokenUrl  → oauth-callback (YouTube token exchange)
//   youtubeApi      → oauth-callback (channels), backfill, ingest-youtube
//   openRouter      → shared/llm.ts (chat completions)
//   gemini          → shared/embeddings.ts (embeddings)

function base(key: string, fallback: string): string {
  return (Deno.env.get(key) ?? fallback).replace(/\/+$/, "");
}

export const ENDPOINTS = {
  // Meta / Facebook / Instagram Graph (base; callers append /oauth/access_token, /me/accounts, /<id>/media)
  graphApi: base("GRAPH_API_BASE", "https://graph.facebook.com/v21.0"),
  // Browser consent dialogs (full URLs; callers append a query string)
  facebookDialog: base("FACEBOOK_DIALOG_URL", "https://www.facebook.com/v21.0/dialog/oauth"),
  googleAuthDialog: base("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
  // Google OAuth token exchange (full URL; POST)
  googleTokenUrl: base("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
  // YouTube Data API v3 (base; callers append /channels, /playlistItems, /commentThreads)
  youtubeApi: base("YOUTUBE_API_BASE", "https://www.googleapis.com/youtube/v3"),
  // AI (bases; callers append /chat/completions and /models/<model>:embedContent)
  openRouter: base("OPENROUTER_BASE", "https://openrouter.ai/api/v1"),
  gemini: base("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta"),
};
