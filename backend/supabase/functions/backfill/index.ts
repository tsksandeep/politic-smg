// functions/backfill (T036) — POST { account_id }. Ingests the LAST 30 DAYS of posts +
// comments for a freshly connected account (FR-010a), bounding the one-time ingestion cost.
// Commenters are hashed before insert (FR-008); analysis is picked up by analyze-comments.

import { serviceClient } from "../../shared/db.ts";
import { ENDPOINTS } from "../../shared/endpoints.ts";
import { hashCommenter } from "../../shared/hash.ts";
import { errorResponse, jsonResponse, logger } from "../../shared/log.ts";
import { youtubeAccessToken } from "../../shared/youtube.ts";

const log = logger("backfill");
const SINCE_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "POST only");
  const { account_id } = await req.json();
  const db = serviceClient();

  const { data: acct } = await db
    .from("connected_account")
    .select("id, platform, external_id, consent_status")
    .eq("id", account_id)
    .maybeSingle();
  if (!acct || acct.consent_status !== "connected") {
    return errorResponse(404, "not_connected", "account not found or not connected");
  }

  const { data: storedToken } = await db.rpc("read_account_token", { p_account: account_id });
  if (!storedToken) return errorResponse(400, "no_token", "could not resolve account token");

  // IG stores a usable access token directly; YT stores a refresh token → exchange for a fresh one.
  let token = storedToken as string;
  if (acct.platform === "youtube") {
    try {
      token = await youtubeAccessToken(storedToken as string);
    } catch (e) {
      log.error("youtube access-token exchange failed", { account: account_id, error: String(e) });
      return errorResponse(
        502,
        "yt_token_exchange_failed",
        "could not refresh YouTube access token",
      );
    }
  }

  const sinceMs = Date.now() - SINCE_DAYS * 86400_000;
  const sinceIso = new Date(sinceMs).toISOString();
  let posts = 0;
  let comments = 0;

  async function ingestComment(
    postId: string,
    externalCommenter: string,
    body: string,
    when: string | null,
  ) {
    const { data: inserted } = await db.from("comment").insert({
      post_id: postId,
      commenter_hash: await hashCommenter(externalCommenter),
      body,
      created_at: when,
    }).select("id").single();
    if (inserted) await db.rpc("enqueue_analyze_comment", { p_comment: inserted.id });
    comments++;
  }

  try {
    if (acct.platform === "instagram") {
      // Last-30-day media with their comments in one expansion.
      const url = `${ENDPOINTS.graphApi}/${acct.external_id}/media?` +
        `fields=id,permalink,timestamp,comments{text,from,timestamp}&since=${
          Math.floor(sinceMs / 1000)
        }` +
        `&access_token=${token}`;
      const media = await (await fetch(url)).json();
      for (const m of media.data ?? []) {
        const { data: post } = await db.from("post").upsert(
          {
            connected_account_id: acct.id,
            platform_post_id: m.id,
            permalink: m.permalink,
            published_at: m.timestamp,
          },
          { onConflict: "connected_account_id,platform_post_id" },
        ).select("id").single();
        if (!post) continue;
        posts++;
        for (const c of m.comments?.data ?? []) {
          await ingestComment(
            post.id,
            String(c.from?.id ?? c.from?.username ?? "unknown"),
            c.text ?? "",
            c.timestamp ?? null,
          );
        }
      }
    } else {
      // YouTube: uploads playlist → recent videos → comment threads, bounded to 30 days.
      const ch = await (await fetch(
        `${ENDPOINTS.youtubeApi}/channels?part=contentDetails&id=${acct.external_id}&access_token=${token}`,
      )).json();
      const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (uploads) {
        const pl = await (await fetch(
          `${ENDPOINTS.youtubeApi}/playlistItems?part=contentDetails&playlistId=${uploads}&maxResults=25&access_token=${token}`,
        )).json();
        for (const item of pl.items ?? []) {
          const publishedAt = item.contentDetails?.videoPublishedAt;
          if (publishedAt && new Date(publishedAt).getTime() < sinceMs) continue;
          const videoId = item.contentDetails?.videoId;
          const { data: post } = await db.from("post").upsert(
            { connected_account_id: acct.id, platform_post_id: videoId, published_at: publishedAt },
            { onConflict: "connected_account_id,platform_post_id" },
          ).select("id").single();
          if (!post) continue;
          posts++;
          const threads = await (await fetch(
            `${ENDPOINTS.youtubeApi}/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&access_token=${token}`,
          )).json();
          for (const t of threads.items ?? []) {
            const sn = t.snippet?.topLevelComment?.snippet;
            if (!sn) continue;
            await ingestComment(
              post.id,
              sn.authorChannelId?.value ?? sn.authorDisplayName,
              sn.textOriginal ?? "",
              sn.publishedAt ?? null,
            );
          }
        }
      }
    }
  } catch (e) {
    log.error("backfill error", { account: account_id, error: String(e) });
  }

  await db.from("connected_account").update({ backfill_done: true }).eq("id", account_id);
  log.info("backfill done", { account: account_id, posts, comments, since: sinceIso });
  return jsonResponse({ account_id, posts, comments, since: sinceIso });
});
