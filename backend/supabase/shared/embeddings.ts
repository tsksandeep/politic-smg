// shared/embeddings.ts (T015) — comment embeddings, written into pgvector for clustering.
//
// Provider is selected by env (EMBEDDINGS_PROVIDER), so the same code serves prod and local:
//   • "vertex" (default) — Vertex AI gemini-embedding-001, pinned to an India region (asia-south1)
//     so comment text is embedded IN-COUNTRY (DPDP / Principle III). Auth is a Google OAuth bearer
//     (a static VERTEX_ACCESS_TOKEN short-circuits minting; otherwise minted from a service-account
//     JWT via ENDPOINTS.googleTokenUrl and cached until shortly before expiry).
//   • "openai" — any OpenAI-compatible /v1/embeddings server (e.g. a local LM Studio running
//     EmbeddingGemma at http://host.docker.internal:1234/v1). Used for local dev now; switch back
//     to "vertex" for the India-region cloud deployment with no code change.
// EMBED_DIM MUST equal the vector(...) dimension in migration 0002_vector.sql (768). EmbeddingGemma
// is natively 768-dim, matching gemini-embedding-001's outputDimensionality here.

import { ENDPOINTS } from "./endpoints.ts";

const PROVIDER = Deno.env.get("EMBEDDINGS_PROVIDER") ?? "vertex"; // "vertex" (prod) | "openai" (local)
const MODEL = Deno.env.get("VERTEX_EMBEDDING_MODEL") ?? "gemini-embedding-001";
export const EMBED_DIM = Number(Deno.env.get("EMBED_DIM") ?? "768");

// ---- access token: static override (local) OR service-account-minted (prod), cached ----
let cached: { token: string; expiresAt: number } | null = null;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

// Mint a Google access token from a service-account JWT (RS256) — the standard JWT-bearer grant.
async function mintAccessToken(): Promise<{ token: string; ttl: number }> {
  const email = Deno.env.get("VERTEX_SA_EMAIL") ?? "";
  const privateKey = Deno.env.get("VERTEX_SA_PRIVATE_KEY") ?? "";
  if (!email || !privateKey) {
    throw new Error(
      "VERTEX_ACCESS_TOKEN unset and VERTEX_SA_EMAIL / VERTEX_SA_PRIVATE_KEY missing — cannot mint",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: ENDPOINTS.googleTokenUrl,
    iat: now,
    exp: now + 3600,
  })));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(ENDPOINTS.googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Vertex token mint ${res.status}: ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  if (!access_token) throw new Error("Vertex token mint: response missing access_token");
  return { token: access_token, ttl: Number(expires_in) > 0 ? Number(expires_in) : 3600 };
}

async function accessToken(): Promise<string> {
  const override = Deno.env.get("VERTEX_ACCESS_TOKEN");
  if (override) return override;
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token;
  const { token, ttl } = await mintAccessToken();
  cached = { token, expiresAt: now + ttl * 1000 };
  return token;
}

async function embedVertex(text: string): Promise<number[]> {
  const url = ENDPOINTS.vertexEmbeddings;
  if (!url) throw new Error("VERTEX_EMBEDDINGS_URL is not set");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ content: text }],
      parameters: { outputDimensionality: EMBED_DIM },
    }),
  });
  if (!res.ok) {
    throw new Error(`Vertex embedding (${MODEL}) error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.predictions?.[0]?.embeddings?.values ?? [];
}

// OpenAI-compatible embeddings (POST {base}/embeddings → { data: [{ embedding }] }). For local
// servers like LM Studio; no key needed (sent only if EMBEDDINGS_API_KEY is set).
async function embedOpenAI(text: string): Promise<number[]> {
  const base = (Deno.env.get("EMBEDDINGS_BASE") ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("EMBEDDINGS_BASE is not set (EMBEDDINGS_PROVIDER=openai)");
  const model = Deno.env.get("EMBEDDINGS_MODEL") ?? "text-embedding-embeddinggemma-300m";
  const key = Deno.env.get("EMBEDDINGS_API_KEY") ?? "";
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Authorization": `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ model, input: text }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embedding (${model}) error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.data?.[0]?.embedding ?? [];
}

/** Returns an EMBED_DIM-length embedding for a single text (provider chosen by EMBEDDINGS_PROVIDER). */
export async function embed(text: string): Promise<number[]> {
  const values = PROVIDER === "openai" ? await embedOpenAI(text) : await embedVertex(text);
  if (values.length !== EMBED_DIM) {
    throw new Error(`embedding dim ${values.length} != EMBED_DIM ${EMBED_DIM}`);
  }
  return values;
}

/** pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
