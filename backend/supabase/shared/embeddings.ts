// shared/embeddings.ts (T015) — Gemini embeddings via the direct Google AI endpoint (R5).
// OpenRouter is completion-focused, so embeddings use the provider endpoint directly.
// EMBED_DIM MUST equal the vector(...) dimension in migration 0002_vector.sql.

import { ENDPOINTS } from "./endpoints.ts";

const API_KEY = Deno.env.get("GEMINI_EMBEDDING_API_KEY");
const MODEL = "text-embedding-004";
export const EMBED_DIM = 768;

const ENDPOINT = `${ENDPOINTS.gemini}/models/${MODEL}:embedContent`;

/** Returns an EMBED_DIM-length embedding for a single text. */
export async function embed(text: string): Promise<number[]> {
  if (!API_KEY) throw new Error("GEMINI_EMBEDDING_API_KEY is not set");
  const res = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIM,
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini embedding error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const values: number[] = data.embedding?.values ?? [];
  if (values.length !== EMBED_DIM) {
    throw new Error(`embedding dim ${values.length} != EMBED_DIM ${EMBED_DIM}`);
  }
  return values;
}

/** pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
