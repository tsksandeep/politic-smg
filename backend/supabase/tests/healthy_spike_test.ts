// healthy_spike_test.ts (T020) — a positive engagement surge raises NO alert (FR-005).
// Integration test against a local supabase db (guarded by DATABASE_URL).

import { assertEquals } from "std/assert/mod.ts";

Deno.test({
  name: "positive surge does not raise an alert",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    try {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;
      const [cadre] = await sql`insert into cadre (display_name) values ('t2') returning id`;
      const [acct] = await sql`
        insert into connected_account (cadre_id, platform, external_id, token_ref)
        values (${cadre.id}, 'instagram', ${"acc-" + crypto.randomUUID()}, 'ref') returning id`;
      const [post] = await sql`
        insert into post (connected_account_id, platform_post_id)
        values (${acct.id}, ${"p-" + crypto.randomUUID()}) returning id`;

      const vec = "[" + Array(768).fill(0).map((_, i) => (i === 1 ? 1 : 0)).join(",") + "]";
      // 60 POSITIVE comments — large volume, but not hostile.
      for (let i = 0; i < 60; i++) {
        await sql`
          insert into comment (post_id, commenter_hash, body, sentiment, sentiment_confidence, language, embedding)
          values (${post.id}, ${"p" + i}, 'great work!', 'positive', 0.95, 'en', ${vec}::vector)`;
      }

      await sql`select run_detection()`;

      const [{ count }] = await sql`select count(*)::int as count from alert`;
      assertEquals(count, 0, "no alert raised for a positive surge");
    } finally {
      await sql.end();
    }
  },
});
