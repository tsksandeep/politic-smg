// quiet_period_test.ts (edge case "quiet periods") — long stretches with only neutral chatter (or
// nothing at all) must not manufacture alerts. Pairs with healthy_spike_test (positive surge).
// Integration test against a local supabase db (guarded by DATABASE_URL).

import { assertEquals } from "std/assert/mod.ts";

Deno.test({
  name: "quiet period: neutral-only activity (and no activity) raises no alert",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    try {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;

      // No comments at all → detection must be a no-op.
      await sql`select run_detection()`;
      const [{ empty }] = await sql`select count(*)::int as empty from alert`;
      assertEquals(empty, 0, "no activity raises no alert");

      const [cadre] = await sql`insert into cadre (display_name) values ('quiet') returning id`;
      const [acct] = await sql`
        insert into connected_account (cadre_id, platform, external_id, token_ref)
        values (${cadre.id}, 'instagram', ${"acc-" + crypto.randomUUID()}, 'ref') returning id`;
      const [post] = await sql`
        insert into post (connected_account_id, platform_post_id)
        values (${acct.id}, ${"p-" + crypto.randomUUID()}) returning id`;

      // 30 NEUTRAL comments (questions/logistics) — volume, but no hostility.
      const vec = "[" + Array(768).fill(0).map((_, i) => (i === 2 ? 1 : 0)).join(",") + "]";
      for (let i = 0; i < 30; i++) {
        await sql`
          insert into comment (post_id, commenter_hash, body, sentiment, sentiment_confidence, language, embedding)
          values (${post.id}, ${
          "n" + i
        }, 'when is the next event?', 'neutral', 0.7, 'en', ${vec}::vector)`;
      }
      await sql`select run_detection()`;
      const [{ count }] = await sql`select count(*)::int as count from alert`;
      assertEquals(count, 0, "neutral-only activity raises no alert");
    } finally {
      await sql.end();
    }
  },
});
