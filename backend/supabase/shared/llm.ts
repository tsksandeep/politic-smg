// shared/llm.ts (T014) — OpenAI-compatible chat client with two-tier routing (R5).
//   Tier "bulk"    → gemini-2.5-flash-lite  (per-comment sentiment/language/troll features)
//   Tier "nuanced" → gemini-2.5-flash       (theme synthesis, coordination judgment, summaries)
// Escalate ambiguous bulk cases to nuanced. All callers must keep outputs labeled with
// confidence (Principle V) — see shared/labels.ts.
//
// Provider is OpenAI-compatible and selected purely by env (prod cloud now / later, local now):
//   • OPENROUTER_BASE → hosted OpenRouter (default) or a local server (e.g. LM Studio at
//     http://host.docker.internal:1234/v1). A key is required only for hosted OpenRouter.
//   • LLM_RESPONSE_FORMAT → "json_object" (OpenRouter/Gemini default) or "none" for local servers
//     that reject json_object (LM Studio) — JSON is then steered by prompt + robust extraction.

import { ENDPOINTS } from "./endpoints.ts";

const OPENROUTER_URL = `${ENDPOINTS.openRouter}/chat/completions`;
const API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const JSON_MODE = Deno.env.get("LLM_RESPONSE_FORMAT") ?? "json_object";
// Hard timeout so a slow/stuck model never hangs a queue worker indefinitely (the message just
// fails and retries, then DLQs). Tune via LLM_TIMEOUT_MS; default 60s.
const TIMEOUT_MS = Number(Deno.env.get("LLM_TIMEOUT_MS") ?? "60000");

export type Tier = "bulk" | "nuanced";

// Models are env-overridable (defaults preserve the two-tier production routing). A single
// OPENROUTER_MODEL overrides both tiers; per-tier vars take precedence if set.
const MODEL: Record<Tier, string> = {
  bulk: Deno.env.get("OPENROUTER_MODEL_BULK") ?? Deno.env.get("OPENROUTER_MODEL") ??
    "google/gemini-2.5-flash-lite",
  nuanced: Deno.env.get("OPENROUTER_MODEL_NUANCED") ?? Deno.env.get("OPENROUTER_MODEL") ??
    "google/gemini-2.5-flash",
};

export interface ChatOptions {
  tier: Tier;
  system?: string;
  /** Ask the model to return strict JSON. */
  json?: boolean;
  temperature?: number;
}

export async function chat(prompt: string, opts: ChatOptions): Promise<string> {
  // A key is required only for hosted OpenRouter; local OpenAI-compatible servers need none.
  if (!API_KEY && OPENROUTER_URL.includes("openrouter.ai")) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  const nativeJson = !!opts.json && JSON_MODE === "json_object";
  // When the provider can't enforce JSON natively, steer it by instruction and extract robustly.
  const system = [
    opts.system ?? "",
    opts.json && !nativeJson
      ? "Respond with ONLY a single JSON object — no prose, no markdown."
      : "",
  ].filter(Boolean).join("\n\n");
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: prompt },
  ];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { "Authorization": `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL[opts.tier],
        messages,
        temperature: opts.temperature ?? 0.2,
        ...(nativeJson ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`LLM ${opts.tier} timed out after ${TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`LLM ${opts.tier} error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Convenience: chat that parses a JSON object response. */
export async function chatJSON<T>(prompt: string, opts: ChatOptions): Promise<T> {
  const raw = await chat(prompt, { ...opts, json: true });
  return parseJsonObject(raw) as T;
}

// Pull a JSON object out of a model reply: strips ```json fences and any reasoning-model preamble
// by slicing to the outermost braces. Tolerates providers that don't honor a strict JSON mode.
function parseJsonObject(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}
