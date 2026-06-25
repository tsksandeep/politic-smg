// shared/hash.ts (T013) — keyed commenter anonymization (Principle III, FR-008).
// The raw commenter handle is hashed BEFORE storage and is never persisted.
// Hashing is keyed (HMAC-SHA256) with COMMENTER_HASH_KEY so hashes are not reversible
// via a public rainbow table. Same handle → same hash (enables coordination detection
// on patterns), but identity cannot be recovered from the hash.

const KEY = Deno.env.get("COMMENTER_HASH_KEY");

let cryptoKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (!KEY) throw new Error("COMMENTER_HASH_KEY is not set");
  if (cryptoKey) return cryptoKey;
  cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return cryptoKey;
}

/** Returns a stable, non-reversible hex digest of a commenter handle. */
export async function hashCommenter(handle: string): Promise<string> {
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(handle.trim()));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
