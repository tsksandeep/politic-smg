// coordination_test.ts (FR-003 + edge case "single loud critic vs coordination") — a burst from
// MANY distinct commenters reads as highly coordinated; the same volume from ONE prolific critic
// does not. The coordination signal must distinguish them.
// Integration test against a local supabase db (guarded by DATABASE_URL).

import { assert } from "std/assert/mod.ts";

const VEC = "[" + Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",") + "]";

Deno.test({
  name: "coordination: many distinct commenters score high; one prolific critic scores low",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);

    // Seed a hostile burst whose comments share an embedding (one narrative), with the given
    // commenter hashes, then return the resulting anti-party coordination score.
    const burstScore = async (hashes: string[]): Promise<number> => {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;
      const [cadre] = await sql`insert into cadre (display_name) values ('coord') returning id`;
      const [acct] = await sql`
        insert into connected_account (cadre_id, platform, external_id, token_ref)
        values (${cadre.id}, 'instagram', ${"acc-" + crypto.randomUUID()}, 'ref') returning id`;
      const [post] = await sql`
        insert into post (connected_account_id, platform_post_id)
        values (${acct.id}, ${"p-" + crypto.randomUUID()}) returning id`;
      for (const h of hashes) {
        await sql`
          insert into comment (post_id, commenter_hash, body, sentiment, sentiment_confidence, language, embedding)
          values (${post.id}, ${h}, 'corruption corruption', 'hostile', 0.9, 'en', ${VEC}::vector)`;
      }
      await sql`select run_detection()`;
      const [row] = await sql`
        select coalesce(max(coordination_score), 0)::float as score
        from narrative where stance = 'anti_party'`;
      return row.score as number;
    };

    try {
      // 40 comments from 40 distinct commenters → coordinated.
      const many = await burstScore(Array.from({ length: 40 }, (_, i) => "c" + i));
      assert(many >= 0.9, `many-commenter burst is coordinated (score=${many})`);

      // 40 comments from a SINGLE commenter → not coordination, just one loud critic.
      const one = await burstScore(Array.from({ length: 40 }, () => "lone_critic"));
      assert(one <= 0.5, `single-critic burst is not coordinated (score=${one})`);

      assert(many > one, "coordination signal separates a swarm from a lone critic");
    } finally {
      await sql.end();
    }
  },
});
