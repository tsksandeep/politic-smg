// functions/submit/index.ts — POST /submit (Coordinator API, FR-005/007/008).
//
// Ingest a leased capture and normalise it into the relational model, strictly scoped to the
// token-derived tenant_id (Principle I — never the node-supplied body). Identity/minimisation
// (Principle III): comment author handles are HMAC-hashed at ingest and the raw handle is discarded
// unless the tenant has raw_identity_enabled. Public-only (Principle II): a private account is
// flagged and its posts dropped. Raw media bytes are never stored — media_url is kept transiently and
// a media job is enqueued so the worker transcribes-then-discards. A node may only submit for an
// assignment it currently holds (else 403 not_your_lease).

import { serviceClient } from "../../shared/db.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";
import { hashCommenter } from "../../shared/hash.ts";
import { guardNodeActive, verifyNodeToken } from "../../shared/node-auth.ts";

const log = logger("submit");

interface PostIn {
  shortcode: string;
  is_video?: boolean;
  caption?: string;
  audio_id?: string;
  taken_at?: string;
  permalink?: string;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
  media_url?: string;
}
interface CommentIn {
  author_handle?: string;
  text?: string;
  created_at?: string;
}
interface SubmitBody {
  assignment_id?: string;
  captured_at?: string;
  account?: {
    external_id?: string;
    followers?: number;
    following?: number;
    posts_count?: number;
    is_private?: boolean;
  };
  posts?: PostIn[];
  post_shortcode?: string;
  comments?: CommentIn[];
}

// Parse #hashtags and @mentions from a caption (mentions are public account refs, not commenters).
function parseEntities(
  caption: string | undefined,
): { kind: "hashtag" | "mention"; value: string }[] {
  if (!caption) return [];
  const out: { kind: "hashtag" | "mention"; value: string }[] = [];
  const seen = new Set<string>();
  for (const m of caption.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const v = `#${m[1]}`.toLowerCase();
    if (!seen.has(v)) (seen.add(v), out.push({ kind: "hashtag", value: v }));
  }
  for (const m of caption.matchAll(/@([A-Za-z0-9_.]+)/g)) {
    const v = `@${m[1]}`.toLowerCase();
    if (!seen.has(v)) (seen.add(v), out.push({ kind: "mention", value: v }));
  }
  return out;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST.");

  const node = await verifyNodeToken(req);
  if (!node) return errorResponse(401, "invalid_node", "Missing or invalid node token.");
  const blocked = guardNodeActive(node, errorResponse);
  if (blocked) return blocked;

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "bad_request", "Body must be JSON.");
  }
  if (!body.assignment_id) return errorResponse(400, "bad_request", "assignment_id is required.");

  const db = serviceClient();
  const tid = node.tenant_id;
  const capturedAt = body.captured_at ?? new Date().toISOString();

  // Assignment must belong to this node (tenant-scoped) — else not_your_lease (Principle I/VII).
  const { data: asg } = await db
    .from("work_assignment")
    .select("id, node_id, target_kind, tracked_account_id, post_id, state")
    .eq("id", body.assignment_id)
    .eq("tenant_id", tid)
    .maybeSingle();
  if (!asg || asg.node_id !== node.node_id) {
    return errorResponse(403, "not_your_lease", "This assignment is not leased to your node.");
  }

  // Does the tenant permit storing raw commenter handles? Off by default (Principle III).
  const { data: tenantRow } = await db
    .from("tenant")
    .select("raw_identity_enabled")
    .eq("id", tid)
    .maybeSingle();
  const rawIdentity = !!tenantRow?.raw_identity_enabled;

  let deduped = 0;
  // shortcode → post.id for everything we touched (used to attach metrics/comments).
  const postIdByShortcode = new Map<string, string>();

  // ---- account snapshot / privacy gate -----------------------------------------------------------
  if (body.account && asg.tracked_account_id) {
    if (body.account.is_private) {
      // Private → flag and drop from capture (Principle II). No posts ingested.
      await db.from("tracked_account").update({ is_private: true }).eq("id", asg.tracked_account_id)
        .eq("tenant_id", tid);
      body.posts = [];
    } else {
      await db.from("account_snapshot").insert({
        tenant_id: tid,
        tracked_account_id: asg.tracked_account_id,
        at: capturedAt,
        followers: body.account.followers ?? null,
        following: body.account.following ?? null,
        posts_count: body.account.posts_count ?? null,
      });
      if (body.account.external_id) {
        await db.from("tracked_account")
          .update({ external_id: body.account.external_id, is_private: false })
          .eq("id", asg.tracked_account_id).eq("tenant_id", tid);
      }
    }
  }

  // ---- posts (account capture posts list, or a post_metrics re-sample) ----------------------------
  const posts = (body.posts ?? []).filter((p) => p?.shortcode);
  if (posts.length > 0 && asg.tracked_account_id) {
    const shortcodes = posts.map((p) => p.shortcode);

    // Which already exist? (dedup count + only-new gets entities/enqueues.)
    const { data: existing } = await db.from("post").select("id, shortcode").eq("tenant_id", tid)
      .in("shortcode", shortcodes);
    const existingShortcodes = new Set<string>((existing ?? []).map((r) => r.shortcode));
    deduped += existingShortcodes.size;

    // Upsert posts by (tenant_id, shortcode). media_url stored transiently; cleared by media worker.
    const rows = posts.map((p) => ({
      tenant_id: tid,
      tracked_account_id: asg.tracked_account_id,
      shortcode: p.shortcode,
      permalink: p.permalink ?? null,
      is_video: !!p.is_video,
      caption: p.caption ?? null,
      audio_id: p.audio_id ?? null,
      taken_at: p.taken_at ?? null,
      media_url: p.media_url ?? null,
      last_sampled_at: capturedAt,
    }));
    const { data: upserted, error: upErr } = await db.from("post")
      .upsert(rows, { onConflict: "tenant_id,shortcode" }).select("id, shortcode");
    if (upErr) {
      log.error("post upsert failed", { code: upErr.code });
      return errorResponse(500, "submit_failed", "Could not store posts.");
    }
    for (const r of upserted ?? []) postIdByShortcode.set(r.shortcode, r.id);

    // Metric samples → velocity/decay time-series (Principle V: a proxy for reach).
    const metricRows = posts
      .filter((p) => p.like_count != null || p.comment_count != null || p.view_count != null)
      .map((p) => ({
        tenant_id: tid,
        post_id: postIdByShortcode.get(p.shortcode),
        at: capturedAt,
        like_count: p.like_count ?? null,
        comment_count: p.comment_count ?? null,
        view_count: p.view_count ?? null,
      }))
      .filter((r) => r.post_id);
    if (metricRows.length > 0) await db.from("post_metric_sample").insert(metricRows);

    // For NEW posts only: derive caption entities, enqueue caption enrichment + media transcription.
    for (const p of posts) {
      if (existingShortcodes.has(p.shortcode)) continue;
      const postId = postIdByShortcode.get(p.shortcode);
      if (!postId) continue;

      const entities = parseEntities(p.caption);
      if (entities.length > 0) {
        await db.from("post_entity").insert(
          entities.map((e) => ({ tenant_id: tid, post_id: postId, kind: e.kind, value: e.value })),
        );
      }
      // Caption clustering enrichment (embed) for the new post.
      await db.rpc("enqueue_enrich", { p_tenant: tid, p_kind: "post", p_id: postId });
      // Media transcription (OCR/ASR) — worker discards bytes after transcript (Principle III).
      if (p.media_url) await db.rpc("enqueue_media", { p_tenant: tid, p_post: postId });
    }
  }

  // ---- comments capture --------------------------------------------------------------------------
  const comments = (body.comments ?? []).filter((c) =>
    c && (c.text != null || c.author_handle != null)
  );
  if (comments.length > 0) {
    // Resolve the post these comments belong to: prefer the assignment's post, else the shortcode.
    let postId: string | null = asg.post_id ?? null;
    if (!postId && body.post_shortcode) {
      postId = postIdByShortcode.get(body.post_shortcode) ?? null;
      if (!postId) {
        const { data: existingPost } = await db.from("post").select("id").eq("tenant_id", tid)
          .eq("shortcode", body.post_shortcode).maybeSingle();
        postId = existingPost?.id ?? null;
        // Create a stub post so comments can attach (account capture may not have run yet).
        if (!postId && asg.tracked_account_id) {
          const { data: stub } = await db.from("post").insert({
            tenant_id: tid,
            tracked_account_id: asg.tracked_account_id,
            shortcode: body.post_shortcode,
            last_sampled_at: capturedAt,
          }).select("id").single();
          postId = stub?.id ?? null;
        }
      }
    }

    if (!postId) {
      return errorResponse(400, "unknown_post", "Cannot resolve the post for these comments.");
    }

    // Hash author handles at ingest (Principle III). Key includes tenant_id so the same handle hashes
    // differently per tenant (no cross-tenant correlation).
    const prepared = await Promise.all(comments.map(async (c) => {
      const handle = (c.author_handle ?? "").toString();
      const author_hash = await hashCommenter(`${tid}:${handle}`);
      return { author_hash, raw: handle, text: c.text ?? null, created_at: c.created_at ?? null };
    }));

    // Dedup against comments already on this post (same author_hash + source created_at).
    const hashes = prepared.map((p) => p.author_hash);
    const { data: existingC } = await db.from("comment")
      .select("author_hash, created_at").eq("tenant_id", tid).eq("post_id", postId).in(
        "author_hash",
        hashes,
      );
    const seen = new Set<string>(
      (existingC ?? []).map((c) => `${c.author_hash}|${c.created_at ?? ""}`),
    );

    const toInsert: Record<string, unknown>[] = [];
    for (const p of prepared) {
      const k = `${p.author_hash}|${p.created_at ?? ""}`;
      if (seen.has(k)) {
        deduped += 1;
        continue;
      }
      seen.add(k);
      toInsert.push({
        tenant_id: tid,
        post_id: postId,
        author_hash: p.author_hash,
        author_raw: rawIdentity ? p.raw : null, // OFF by default (Principle III)
        body: p.text,
        created_at: p.created_at,
      });
    }

    if (toInsert.length > 0) {
      const { data: inserted, error: cErr } = await db.from("comment").insert(toInsert).select(
        "id",
      );
      if (cErr) {
        log.error("comment insert failed", { code: cErr.code });
        return errorResponse(500, "submit_failed", "Could not store comments.");
      }
      // Enqueue per-comment enrichment (embed + sentiment + language).
      for (const c of inserted ?? []) {
        await db.rpc("enqueue_enrich", { p_tenant: tid, p_kind: "comment", p_id: c.id });
      }
    }
  }

  // ---- submission record (no raw handles, no raw media bytes) -------------------------------------
  const safePayload: SubmitBody = {
    ...body,
    comments: body.comments?.map((c) => ({ text: c.text, created_at: c.created_at })), // strip handle
  };
  const { data: subRow, error: subErr } = await db.from("submission").insert({
    tenant_id: tid,
    node_id: node.node_id,
    work_assignment_id: asg.id,
    payload: safePayload,
    captured_at: capturedAt,
  }).select("id").single();
  if (subErr || !subRow) {
    log.error("submission insert failed", { code: subErr?.code });
    return errorResponse(500, "submit_failed", "Could not record submission.");
  }

  // Mark the assignment submitted (reconciliation cron takes it from here — Principle VII).
  await db.from("work_assignment").update({ state: "submitted" }).eq("id", asg.id).eq(
    "tenant_id",
    tid,
  );

  log.info("submitted", { tenant_id: tid, node_id: node.node_id, deduped });
  return jsonResponse({ accepted: true, submission_id: subRow.id, deduped });
});
