// functions/ig-webhook (T022) — Instagram Graph API comment webhook receiver.
// Verifies the subscription (GET) and signature (POST), then for each new comment on a
// CONNECTED account's post: upserts the post, hashes the commenter BEFORE insert (FR-008),
// and inserts the comment. Analysis is pulled later by analyze-comments (unembedded rows).
// Only accounts with consent_status='connected' are accepted (FR-001/011).

import { serviceClient } from "../../shared/db.ts";
import { hashCommenter } from "../../shared/hash.ts";
import { errorResponse, jsonResponse, logger } from "../../shared/log.ts";

const log = logger("ig-webhook");
const VERIFY_TOKEN = Deno.env.get("IG_WEBHOOK_VERIFY_TOKEN");
const APP_SECRET = Deno.env.get("IG_APP_SECRET");

// Constant-time string comparison so signature verification doesn't leak via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(req: Request, raw: string): Promise<boolean> {
  if (!APP_SECRET) return false;
  const header = req.headers.get("x-hub-signature-256");
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = "sha256=" +
    Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(header, expected);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Subscription verification handshake.
  if (req.method === "GET") {
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return errorResponse(403, "verification_failed", "bad verify token");
  }

  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "POST only");

  const raw = await req.text();
  if (!(await verifySignature(req, raw))) {
    return errorResponse(401, "bad_signature", "signature verification failed");
  }

  const db = serviceClient();
  const payload = JSON.parse(raw);
  let accepted = 0;

  for (const entry of payload.entry ?? []) {
    const igAccountId = String(entry.id);
    const { data: account } = await db
      .from("connected_account")
      .select("id, consent_status")
      .eq("platform", "instagram")
      .eq("external_id", igAccountId)
      .maybeSingle();

    if (!account || account.consent_status !== "connected") continue; // FR-011

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const v = change.value;
      const { data: post } = await db
        .from("post")
        .upsert(
          { connected_account_id: account.id, platform_post_id: String(v.media?.id ?? v.post_id) },
          { onConflict: "connected_account_id,platform_post_id" },
        )
        .select("id")
        .single();
      if (!post) continue;

      const { data: inserted } = await db.from("comment").insert({
        post_id: post.id,
        commenter_hash: await hashCommenter(String(v.from?.id ?? v.from?.username ?? "unknown")),
        body: v.text ?? "",
        created_at: v.created_time ? new Date(v.created_time * 1000).toISOString() : null,
      }).select("id").single();
      if (inserted) await db.rpc("enqueue_analyze_comment", { p_comment: inserted.id });
      accepted++;
    }
  }

  log.info("processed webhook", { accepted });
  return jsonResponse({ accepted }); // fast ack; analysis is async
});
