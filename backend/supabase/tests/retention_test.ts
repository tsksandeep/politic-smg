// tests/retention_test.ts — raw-text retention purge (Principle III, FR-018, SC-005).
//
// NOTE: the `retention-purge` Edge Function / SQL routine is not yet in the migrations (the cron job
// in 0005_cron.sql references it). This test pins the REQUIRED behaviour so the eventual purge must
// satisfy it: raw text (post.caption, comment.body) and transient media_url older than the retention
// window (default 30 days, IN-DPDP) are cleared, while everything derived/anonymised — author_hash,
// embeddings, hashtags, metric samples, transcripts — survives. When the real routine lands, swap the
// `RETENTION_PURGE_SQL` block below for `select retention_purge($tenant)` and the asserts stand.
//
// Run:  deno test --allow-net --allow-env retention_test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connect, createTenant, createTrackedAccount, q, uuid, vec } from "./helpers.ts";

// Canonical retention routine lives in migration 0007 (retention_purge); the test calls it directly,
// scoped to this test's tenant. The retention-purge Edge Function calls the same function.

Deno.test("retention — old raw text + media_url purged; derived data persists (SC-005)", async (t) => {
  const client = await connect();
  try {
    const tenant = await createTenant(client);
    const acc = await createTrackedAccount(client, tenant, "target_acc");

    // ---- OLD post (40 days): caption + media_url should be cleared; derived rows persist ----
    const oldPost = uuid();
    await q(client, {
      text: `insert into post
        (id, tenant_id, tracked_account_id, shortcode, caption, media_url, caption_embedding, first_seen_at)
        values ($1,$2,$3,$4,'secret operational plan','https://cdn.example/x.jpg',$5::vector,
                now() - interval '40 days')`,
      args: [oldPost, tenant, acc, "old-" + uuid().slice(0, 8), vec(3, 0)],
    });
    await q(client, {
      text: `insert into post_entity (tenant_id, post_id, kind, value) values ($1,$2,'hashtag','#keepme')`,
      args: [tenant, oldPost],
    });
    await q(client, {
      text:
        `insert into post_metric_sample (tenant_id, post_id, like_count, comment_count) values ($1,$2,10,2)`,
      args: [tenant, oldPost],
    });
    await q(client, {
      text:
        `insert into media_transcript (tenant_id, post_id, kind, text) values ($1,$2,'asr','derived transcript')`,
      args: [tenant, oldPost],
    });

    // ---- RECENT post: must be untouched ----
    const newPost = uuid();
    await q(client, {
      text: `insert into post
        (id, tenant_id, tracked_account_id, shortcode, caption, media_url, first_seen_at)
        values ($1,$2,$3,$4,'fresh caption','https://cdn.example/y.jpg', now())`,
      args: [newPost, tenant, acc, "new-" + uuid().slice(0, 8)],
    });

    // ---- OLD comment (40 days): body cleared; author_hash + embedding persist ----
    const oldComment = uuid();
    await q(client, {
      text: `insert into comment
        (id, tenant_id, post_id, author_hash, body, embedding, ingested_at)
        values ($1,$2,$3,'hash_keep_abc','very hostile body',$4::vector, now() - interval '40 days')`,
      args: [oldComment, tenant, oldPost, vec(3, 1)],
    });
    // ---- RECENT comment: body untouched ----
    const newComment = uuid();
    await q(client, {
      text: `insert into comment
        (id, tenant_id, post_id, author_hash, body, ingested_at)
        values ($1,$2,$3,'hash_new','fresh comment body', now())`,
      args: [newComment, tenant, oldPost],
    });

    // ---- Run the retention purge effect ----
    await q(client, { text: "select retention_purge($1, 30)", args: [tenant] });

    await t.step("old post caption + media_url cleared; embedding/hashtag/samples/transcript persist", async () => {
      const p = await q(client, {
        text: `select caption, media_url, caption_embedding is not null as has_emb from post where id=$1`,
        args: [oldPost],
      }) as { rows: { caption: string | null; media_url: string | null; has_emb: boolean }[] };
      assertEquals(p.rows[0].caption, null, "old caption was not purged");
      assertEquals(p.rows[0].media_url, null, "old media_url was not cleared");
      assertEquals(p.rows[0].has_emb, true, "caption_embedding (derived) was wrongly dropped");

      const ent = await q(client, {
        text: `select count(*)::int as n from post_entity where post_id=$1`,
        args: [oldPost],
      }) as { rows: { n: number }[] };
      assertEquals(ent.rows[0].n, 1, "derived hashtag entity was dropped");
      const ms = await q(client, {
        text: `select count(*)::int as n from post_metric_sample where post_id=$1`,
        args: [oldPost],
      }) as { rows: { n: number }[] };
      assertEquals(ms.rows[0].n, 1, "derived metric sample was dropped");
      const tr = await q(client, {
        text: `select count(*)::int as n from media_transcript where post_id=$1`,
        args: [oldPost],
      }) as { rows: { n: number }[] };
      assertEquals(tr.rows[0].n, 1, "derived transcript was dropped");
    });

    await t.step("recent post untouched", async () => {
      const p = await q(client, {
        text: `select caption, media_url from post where id=$1`,
        args: [newPost],
      }) as { rows: { caption: string | null; media_url: string | null }[] };
      assertEquals(p.rows[0].caption, "fresh caption", "recent caption wrongly purged");
      assertEquals(p.rows[0].media_url, "https://cdn.example/y.jpg", "recent media_url wrongly cleared");
    });

    await t.step("old comment body cleared; author_hash + embedding persist", async () => {
      const c = await q(client, {
        text:
          `select body, author_hash, embedding is not null as has_emb from comment where id=$1`,
        args: [oldComment],
      }) as { rows: { body: string | null; author_hash: string; has_emb: boolean }[] };
      assertEquals(c.rows[0].body, null, "old comment body was not purged");
      assertEquals(c.rows[0].author_hash, "hash_keep_abc", "author_hash (anonymised id) was lost");
      assertEquals(c.rows[0].has_emb, true, "comment embedding (derived) was wrongly dropped");
    });

    await t.step("recent comment untouched", async () => {
      const c = await q(client, {
        text: `select body from comment where id=$1`,
        args: [newComment],
      }) as { rows: { body: string | null }[] };
      assertEquals(c.rows[0].body, "fresh comment body", "recent comment body wrongly purged");
    });
  } finally {
    await client.end();
  }
});
