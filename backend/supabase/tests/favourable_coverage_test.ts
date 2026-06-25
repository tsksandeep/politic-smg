// favourable_coverage_test.ts (delivered scope DR-1/DR-2/DR-3) — pro-party narratives are tracked
// on the favourable board (never alerted), cadre coverage aggregates sentiment per cadre, and the
// drill-down views expose example comments with NO commenter identity.
// Integration test against a local supabase db (guarded by DATABASE_URL).

import { assert, assertEquals } from "std/assert/mod.ts";

Deno.test({
  name: "favourable + coverage + drill-downs (DR-1/DR-2/DR-3)",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async (t) => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    try {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;
      const [cadre] =
        await sql`insert into cadre (display_name) values ('Coverage Cadre') returning id`;
      const [acct] = await sql`
        insert into connected_account (cadre_id, platform, external_id, token_ref)
        values (${cadre.id}, 'instagram', ${"acc-" + crypto.randomUUID()}, 'ref') returning id`;
      const [post] = await sql`
        insert into post (connected_account_id, platform_post_id)
        values (${acct.id}, ${"p-" + crypto.randomUUID()}) returning id`;

      const axis = (i: number) =>
        "[" + Array(768).fill(0).map((_, k) => (k === i ? 1 : 0)).join(",") + "]";
      const seed = async (n: number, sentiment: string, conf: number, ax: number, hpfx: string) => {
        for (let i = 0; i < n; i++) {
          await sql`
            insert into comment (post_id, commenter_hash, body, sentiment, sentiment_confidence, language, embedding)
            values (${post.id}, ${hpfx + i}, ${
            sentiment + " comment"
          }, ${sentiment}, ${conf}, 'en', ${axis(ax)}::vector)`;
        }
      };
      await seed(30, "positive", 0.92, 1, "pos");
      await seed(12, "hostile", 0.9, 0, "neg");
      await seed(6, "neutral", 0.7, 2, "neu");
      await sql`select run_detection()`;

      await t.step("DR-1: pro-party narrative on the favourable board, never alerted", async () => {
        const [fav] = await sql`
          select volume, performance_score::float as perf
          from narrative_board where stance = 'pro_party' order by volume desc limit 1`;
        assert(fav, "a pro_party narrative is on the favourable board");
        assert(
          (fav.volume as number) >= 1 && (fav.perf as number) > 0,
          "performance_score is positive",
        );
        const [{ alerted }] = await sql`
          select count(*)::int as alerted
          from alert a join narrative n on n.id = a.narrative_id where n.stance = 'pro_party'`;
        assertEquals(alerted, 0, "favourable narratives never raise alerts (FR-005)");
      });

      await t.step("DR-2: cadre coverage aggregates positive vs negative", async () => {
        const [cov] = await sql`
          select positive_count, negative_count, neutral_count, total_count
          from cadre_coverage where cadre_id = ${cadre.id}`;
        assert(cov, "cadre appears in coverage");
        assertEquals(Number(cov.positive_count), 30, "positive count");
        assertEquals(Number(cov.negative_count), 12, "negative count");
        assert(Number(cov.total_count) >= 48, "total reflects all comments");
      });

      await t.step(
        "DR-3: drill-down views expose examples with NO commenter identity",
        async () => {
          const cols = await sql`
          select column_name from information_schema.columns where table_name = 'cadre_comment'`;
          const names = cols.map((c) => String(c.column_name));
          assert(
            !names.some((n) => /commenter_hash|handle|username|author/i.test(n)),
            "cadre_comment exposes no commenter-identity column",
          );
          const examples =
            await sql`select body, sentiment from cadre_comment where cadre_id = ${cadre.id} limit 5`;
          assert(examples.length > 0, "drill-down returns example comments");
          const narr = await sql`select stance from cadre_narrative where cadre_id = ${cadre.id}`;
          assert(narr.length > 0, "cadre_narrative lists this cadre's narratives");
        },
      );
    } finally {
      await sql.end();
    }
  },
});
