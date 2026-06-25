// detect_alert_test.ts (T019) — a coordinated hostile burst raises an alert.
// Integration test against a local supabase db (guarded by DATABASE_URL).

import { assert } from "std/assert/mod.ts";

Deno.test({
  name: "hostile burst across many commenters raises an alert",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    try {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;
      // Seed: a cadre + connected account + post.
      const [cadre] = await sql`insert into cadre (display_name) values ('t') returning id`;
      const [acct] = await sql`
        insert into connected_account (cadre_id, platform, external_id, token_ref)
        values (${cadre.id}, 'instagram', ${"acc-" + crypto.randomUUID()}, 'ref') returning id`;
      const [post] = await sql`
        insert into post (connected_account_id, platform_post_id)
        values (${acct.id}, ${"p-" + crypto.randomUUID()}) returning id`;

      // 40 hostile comments from distinct commenters with near-identical embeddings.
      const vec = "[" + Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",") + "]";
      for (let i = 0; i < 40; i++) {
        await sql`
          insert into comment (post_id, commenter_hash, body, sentiment, sentiment_confidence, language, embedding)
          values (${post.id}, ${
          "h" + i
        }, 'corruption corruption', 'hostile', 0.9, 'en', ${vec}::vector)`;
      }

      await sql`select run_detection()`;

      const [{ count }] = await sql`select count(*)::int as count from alert`;
      assert(count >= 1, "an alert was raised for the hostile burst");
    } finally {
      await sql.end();
    }
  },
});
