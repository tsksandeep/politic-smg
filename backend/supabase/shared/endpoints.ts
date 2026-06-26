// shared/endpoints.ts — every external API base URL in ONE place.
//
// Each is read from an env var with the REAL production endpoint as the default. Prod and local
// differ ONLY by these env values (point them at a local model server for offline dev). No code
// path branches on environment. Consumers:
//   openRouter      → shared/llm.ts (chat completions: Gemini Flash/Flash-Lite via OpenRouter, or a
//                     local OpenAI-compatible server)
//   vertexEmbeddings→ shared/embeddings.ts (Vertex AI :predict — project/region specific, no default)
//   googleTokenUrl  → shared/embeddings.ts (mint a Vertex access token from the SA JWT)

function base(key: string, fallback: string): string {
  return (Deno.env.get(key) ?? fallback).replace(/\/+$/, "");
}

export const ENDPOINTS = {
  // Chat completions (OpenRouter → Gemini in prod; an OpenAI-compatible local server in dev).
  openRouter: base("OPENROUTER_BASE", "https://openrouter.ai/api/v1"),
  // Google OAuth token endpoint — used to mint a Vertex AI access token from the embedding
  // service-account JWT.
  googleTokenUrl: base("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
  // Vertex AI embeddings :predict — full URL is project/region-specific, so no universal default;
  // set per deployment (prod: https://asia-south1-aiplatform.googleapis.com/v1/projects/<id>/
  // locations/asia-south1/publishers/google/models/gemini-embedding-001:predict).
  vertexEmbeddings: base("VERTEX_EMBEDDINGS_URL", ""),
};
