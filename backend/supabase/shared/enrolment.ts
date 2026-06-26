// shared/enrolment.ts — tenant enrolment codes for first-run node registration.
//
// An Admin issues a node operator a short-lived enrolment code that encodes the tenant_id + an expiry,
// HMAC-signed with NODE_ENROLMENT_SECRET. node-register verifies the code to derive the tenant the new
// node belongs to — the node never asserts its own tenant_id (Principle I). The code is self-contained
// (no DB row), so a leaked/expired code simply fails the signature/expiry check.
//
// Format: `<base64url(payload)>.<hex(hmac(payload))>` where payload = `<tenant_id>.<exp_epoch_seconds>`.

let enrolmentKey: CryptoKey | null = null;
async function key(): Promise<CryptoKey> {
  const secret = Deno.env.get("NODE_ENROLMENT_SECRET");
  if (!secret) throw new Error("NODE_ENROLMENT_SECRET is not set");
  if (enrolmentKey) return enrolmentKey;
  enrolmentKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return enrolmentKey;
}

async function signHex(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return atob(t);
}

// Constant-time string compare to avoid leaking the signature byte-by-byte via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mint an enrolment code for a tenant (used by Admin tooling / tests). Default TTL 7 days.
 */
export async function mintEnrolmentCode(
  tenantId: string,
  ttlSeconds = 7 * 24 * 3600,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${tenantId}.${exp}`;
  const sig = await signHex(payload);
  return `${b64urlEncode(payload)}.${sig}`;
}

/**
 * Verify an enrolment code → tenant_id, or null if malformed, badly-signed, or expired.
 */
export async function verifyEnrolmentCode(code: string | undefined | null): Promise<string | null> {
  if (!code || typeof code !== "string") return null;
  const dot = code.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = code.slice(0, dot);
  const sig = code.slice(dot + 1);

  let payload: string;
  try {
    payload = b64urlDecode(payloadB64);
  } catch {
    return null;
  }

  const expected = await signHex(payload);
  if (!timingSafeEqual(sig.toLowerCase(), expected)) return null;

  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return null;
  const tenantId = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!UUID_RE.test(tenantId) || !Number.isFinite(exp)) return null;
  if (exp < Math.floor(Date.now() / 1000)) return null;
  return tenantId;
}
