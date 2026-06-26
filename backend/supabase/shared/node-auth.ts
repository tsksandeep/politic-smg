// shared/node-auth.ts — tenant-scoped node bearer-token auth for the coordinator Edge Functions.
//
// Nodes have NO Supabase JWT (Principle II/IV). They authenticate with a random bearer token issued
// once at registration. Only the token's HMAC (token_hash, keyed by NODE_TOKEN_KEY) is ever stored;
// the raw token is shown once and discarded server-side. verifyNodeToken() resolves an incoming
// `Authorization: Bearer <token>` to the owning node row via a token_hash match using the service
// client, and the caller derives the tenant from THAT row — never from anything the node sends.
//
// Principle III: the raw token is a secret like a password. It is never logged and never persisted.

import { serviceClient } from "./db.ts";

// Rate guidance handed to nodes (Principle IV: capped + jittered request cadence). Env-overridable.
export const NODE_RATE = {
  max_requests_per_day: Number(Deno.env.get("NODE_MAX_REQUESTS_PER_DAY") ?? 100),
  min_interval_ms: Number(Deno.env.get("NODE_MIN_INTERVAL_MS") ?? 600),
  jitter_ms: Number(Deno.env.get("NODE_JITTER_MS") ?? 400),
};

// Subset returned on every lease/heartbeat (the node already knows its daily cap from register).
export const LEASE_RATE = {
  min_interval_ms: NODE_RATE.min_interval_ms,
  jitter_ms: NODE_RATE.jitter_ms,
};

// Trust below this is treated as quarantined (the reconcile cron also flips node.status). Heartbeat
// surfaces it so a decaying node backs off even before the cron run.
export const QUARANTINE_TRUST_THRESHOLD = Number(Deno.env.get("NODE_QUARANTINE_TRUST") ?? 0.2);

// How long a node reporting a blocked IP should stand down before trying again (Principle IX).
export const BLOCKED_BACKOFF_MS = Number(Deno.env.get("NODE_BLOCKED_BACKOFF_MS") ?? 300_000);

// Public Instagram web app id used by the node's logged-out guest capture (capture hint, not a secret).
export const INSTAGRAM_APP_ID = Deno.env.get("INSTAGRAM_APP_ID") ?? "936619743392459";

export interface NodeAuth {
  node_id: string;
  tenant_id: string;
  status: "active" | "quarantined" | "revoked";
  trust_score: number;
  label: string;
}

// ---- token primitives ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let tokenKey: CryptoKey | null = null;
async function nodeTokenKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("NODE_TOKEN_KEY");
  if (!secret) throw new Error("NODE_TOKEN_KEY is not set");
  if (tokenKey) return tokenKey;
  tokenKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return tokenKey;
}

/** Generate a fresh, high-entropy node bearer token. Returned to the operator exactly once. */
export function generateNodeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `opn_${toBase64Url(bytes)}`;
}

/** Keyed HMAC of a raw token → the hex digest stored as node.token_hash. Never reversible. */
export async function hashNodeToken(rawToken: string): Promise<string> {
  const key = await nodeTokenKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawToken));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Resolve `Authorization: Bearer <token>` → the owning node row (via token_hash) using the service
 * client. Returns the node (incl. status/trust) on a match, or null when the header is missing or no
 * node matches. Status policy (revoked → reject, quarantined → reject for work) is applied by callers
 * via guardNodeActive(), so heartbeat can still respond to a quarantined node while work-lease/submit
 * reject it with the contract's distinct codes.
 */
export async function verifyNodeToken(req: Request): Promise<NodeAuth | null> {
  const raw = bearer(req);
  if (!raw) return null;
  const tokenHash = await hashNodeToken(raw);
  const db = serviceClient();
  const { data, error } = await db
    .from("node")
    .select("id, tenant_id, status, trust_score, label")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  return {
    node_id: data.id,
    tenant_id: data.tenant_id,
    status: data.status,
    trust_score: data.trust_score,
    label: data.label,
  };
}

/**
 * Reject revoked or quarantined nodes with the contract's status codes. Returns a Response to send
 * back, or null if the node is active and may proceed. Used by work-lease and submit.
 */
export function guardNodeActive(
  node: NodeAuth,
  errorResponse: (status: number, code: string, message: string) => Response,
): Response | null {
  if (node.status === "revoked") {
    return errorResponse(403, "node_revoked", "This node has been revoked.");
  }
  if (node.status === "quarantined" || node.trust_score < QUARANTINE_TRUST_THRESHOLD) {
    return errorResponse(
      403,
      "node_quarantined",
      "This node is quarantined and cannot lease work.",
    );
  }
  return null;
}
