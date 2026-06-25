// shared/endpoints.ts — every external API base URL in ONE place.
//
// Each is read from an env var with the REAL production endpoint as the default. Prod and local
// differ ONLY by these env values: in prod they are unset (real defaults apply); in local dev
// they point at backend/supabase/mocks/server.ts. No code path branches on environment.
//
// Consumers (cadre OAuth itself is brokered by Nango — see shared/nango.ts — so the app holds no
// consent-dialog URLs; tokens used below are fetched fresh from Nango per call):
//   graphApi        → oauth-callback (me/accounts), backfill (media)
//   googleTokenUrl  → shared/embeddings.ts (mint Vertex access token from the service-account JWT)
//   youtubeApi      → oauth-callback (channels), backfill, ingest-youtube
//   openRouter      → shared/llm.ts (chat completions)
//   vertexEmbeddings→ shared/embeddings.ts (Vertex AI :predict — project/region specific, no default)

function base(key: string, fallback: string): string {
  return (Deno.env.get(key) ?? fallback).replace(/\/+$/, "");
}

export const ENDPOINTS = {
  // Meta / Facebook / Instagram Graph (base; callers append /me/accounts, /<id>/media)
  graphApi: base("GRAPH_API_BASE", "https://graph.facebook.com/v21.0"),
  // Google OAuth token endpoint — used to mint a Vertex AI access token from the embedding
  // service-account JWT (NOT for cadre OAuth, which Nango handles).
  googleTokenUrl: base("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
  // YouTube Data API v3 (base; callers append /channels, /playlistItems, /commentThreads)
  youtubeApi: base("YOUTUBE_API_BASE", "https://www.googleapis.com/youtube/v3"),
  // AI
  openRouter: base("OPENROUTER_BASE", "https://openrouter.ai/api/v1"),
  // Vertex AI embeddings :predict — full URL is project/region-specific, so no universal default;
  // set per deployment (prod: https://asia-south1-aiplatform.googleapis.com/v1/projects/<id>/
  // locations/asia-south1/publishers/google/models/gemini-embedding-001:predict).
  vertexEmbeddings: base("VERTEX_EMBEDDINGS_URL", ""),
};
