// functions/ingest-youtube (T023) — poll connected YouTube channels for new comments.
// Quota-efficient: reads each channel's uploads playlist (1 unit) then commentThreads
// (1 unit each) — AVOIDS search.list (100 units). Stops when the daily unit budget is hit
// (graceful degradation: delayed, not lost). GATED by the quota audit (T006/T047).
//
// NOTE: do not enable in production until docs/quota-audit.md shows the audit approved.

import { serviceClient } from "../../shared/db.ts";
import { ENDPOINTS } from "../../shared/endpoints.ts";
import { hashCommenter } from "../../shared/hash.ts";
import { jsonResponse, logger } from "../../shared/log.ts";

const log = logger("ingest-youtube");
const API = ENDPOINTS.youtubeApi;
const DAILY_UNIT_BUDGET = Number(Deno.env.get("YT_DAILY_UNIT_BUDGET") ?? "9000");
const CHANNELS_PER_RUN = Number(Deno.env.get("YT_CHANNELS_PER_RUN") ?? "50");

async function ytGet(path: string, params: Record<string, string>, accessToken: string) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`YT ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

Deno.serve(async () => {
  // Principle VII gate (T006/T047): YouTube ingestion stays OFF until the Data API quota
  // audit is approved. Production MUST NOT set YT_INGEST_ENABLED=true before then.
  if (Deno.env.get("YT_INGEST_ENABLED") !== "true") {
    log.warn("YouTube ingestion disabled — quota-audit gate; see docs/quota-audit.md");
    return jsonResponse({ disabled: true, reason: "youtube_quota_audit_gate" });
  }

  const db = serviceClient();
  let units = 0;
  let comments = 0;

  // Round-robin a batch of connected channels (oldest last_ingested first).
  const { data: accounts } = await db
    .from("connected_account")
    .select("id, external_id, token_ref")
    .eq("platform", "youtube")
    .eq("consent_status", "connected")
    .limit(CHANNELS_PER_RUN);

  for (const acct of accounts ?? []) {
    if (units >= DAILY_UNIT_BUDGET) {
      log.warn("daily unit budget reached; deferring remainder", { units });
      break;
    }
    // token_ref resolves to an access token in Vault; resolution omitted here for brevity.
    const accessToken = Deno.env.get("YT_ACCESS_TOKEN_OVERRIDE") ?? acct.token_ref;

    try {
      const ch = await ytGet("channels", {
        part: "contentDetails",
        id: acct.external_id,
      }, accessToken);
      units += 1;
      const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) continue;

      const playlist = await ytGet("playlistItems", {
        part: "contentDetails",
        playlistId: uploads,
        maxResults: "10",
      }, accessToken);
      units += 1;

      for (const item of playlist.items ?? []) {
        if (units >= DAILY_UNIT_BUDGET) break;
        const videoId = item.contentDetails?.videoId;
        const { data: post } = await db
          .from("post")
          .upsert(
            { connected_account_id: acct.id, platform_post_id: videoId },
            { onConflict: "connected_account_id,platform_post_id" },
          )
          .select("id")
          .single();
        if (!post) continue;

        const threads = await ytGet("commentThreads", {
          part: "snippet",
          videoId,
          maxResults: "100",
        }, accessToken);
        units += 1;

        for (const t of threads.items ?? []) {
          const sn = t.snippet?.topLevelComment?.snippet;
          if (!sn) continue;
          await db.from("comment").insert({
            post_id: post.id,
            commenter_hash: await hashCommenter(sn.authorChannelId?.value ?? sn.authorDisplayName),
            body: sn.textOriginal ?? "",
            created_at: sn.publishedAt ?? null,
          });
          comments++;
        }
      }
      await db.from("post").update({ last_ingested_at: new Date().toISOString() })
        .eq("connected_account_id", acct.id);
    } catch (e) {
      log.error("channel ingest failed", { account: acct.id, error: String(e) });
    }
  }

  log.info("youtube ingest done", { units, comments, channels: accounts?.length ?? 0 });
  return jsonResponse({ units, comments });
});
