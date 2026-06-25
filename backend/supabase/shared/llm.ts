// shared/llm.ts (T014) — OpenRouter → Gemini client with two-tier routing (R5).
//   Tier "bulk"    → gemini-2.5-flash-lite  (per-comment sentiment/language/troll features)
//   Tier "nuanced" → gemini-2.5-flash       (theme synthesis, coordination judgment, summaries)
// Escalate ambiguous bulk cases to nuanced. All callers must keep outputs labeled with
// confidence (Principle V) — see shared/labels.ts.

import { ENDPOINTS } from "./endpoints.ts";

const OPENROUTER_URL = `${ENDPOINTS.openRouter}/chat/completions`;
const API_KEY = Deno.env.get("OPENROUTER_API_KEY");

export type Tier = "bulk" | "nuanced";

const MODEL: Record<Tier, string> = {
  bulk: "google/gemini-2.5-flash-lite",
  nuanced: "google/gemini-2.5-flash",
};

export interface ChatOptions {
  tier: Tier;
  system?: string;
  /** Ask the model to return strict JSON. */
  json?: boolean;
  temperature?: number;
}

export async function chat(prompt: string, opts: ChatOptions): Promise<string> {
  if (!API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: prompt },
  ];
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL[opts.tier],
      messages,
      temperature: opts.temperature ?? 0.2,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${opts.tier} error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Convenience: chat that parses a JSON object response. */
export async function chatJSON<T>(prompt: string, opts: ChatOptions): Promise<T> {
  const raw = await chat(prompt, { ...opts, json: true });
  return JSON.parse(raw) as T;
}
