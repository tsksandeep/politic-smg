// retention_test.ts (FR-009 / Principle III) — raw comment text is purged 30 days after ingestion,
// while the anonymized derivatives (commenter_hash, sentiment, embedding) are retained.
// Integration test against a local supabase db (guarded by DATABASE_URL).

import { assert, assertEquals } from "std/assert/mod.ts";

Deno.test({
  name: "retention: raw comment.body older than 30 days is purged; anonymized fields kept",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    try {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;
      const [cadre] = await sql`insert into cadre (display_name) values ('ret') returning id`;
      const [acct] = await sql`
        insert into connected_account (cadre_id, platform, external_id, token_ref)
        values (${cadre.id}, 'instagram', ${"acc-" + crypto.randomUUID()}, 'ref') returning id`;
      const [post] = await sql`
        insert into post (connected_account_id, platform_post_id)
        values (${acct.id}, ${"p-" + crypto.randomUUID()}) returning id`;

      // One comment ingested 31 days ago (expired), one ingested now (fresh).
      const [old] = await sql`
        insert into comment (post_id, commenter_hash, body, sentiment, sentiment_confidence, language, ingested_at)
        values (${post.id}, 'hash_old', 'this raw text must be purged', 'hostile', 0.9, 'en',
                now() - interval '31 days') returning id`;
      const [fresh] = await sql`
        insert into comment (post_id, commenter_hash, body, sentiment, sentiment_confidence, language, ingested_at)
        values (${post.id}, 'hash_fresh', 'this raw text is recent', 'hostile', 0.9, 'en', now())
        returning id`;

      const [res] = await sql`select purge_expired_data() as r`;
      assert((res.r.raw_text_purged as number) >= 1, "purge reports raw text deleted");

      const [oldRow] = await sql`
        select body, commenter_hash, sentiment, sentiment_confidence
        from comment where id = ${old.id}`;
      assertEquals(oldRow.body, null, "expired comment body is nulled");
      assertEquals(oldRow.commenter_hash, "hash_old", "anonymized hash is retained");
      assertEquals(oldRow.sentiment, "hostile", "sentiment derivative is retained");

      const [freshRow] = await sql`select body from comment where id = ${fresh.id}`;
      assertEquals(freshRow.body, "this raw text is recent", "fresh comment body is untouched");
    } finally {
      await sql.end();
    }
  },
});
