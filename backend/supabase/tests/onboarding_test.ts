// onboarding_test.ts (T032) — connect → data drives alerts; revoke → data drops out (FR-010/T037a).
// DB-level test (no live OAuth needed); guarded by DATABASE_URL.

import { assert, assertEquals } from "std/assert/mod.ts";

Deno.test({
  name: "revoking an account drops its data out of active alerts",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    try {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;
      const [cadre] =
        await sql`insert into cadre (display_name) values ('revoke-test') returning id`;
      const [acct] = await sql`
        insert into connected_account (cadre_id, platform, external_id, token_ref)
        values (${cadre.id}, 'instagram', ${"acc-" + crypto.randomUUID()}, 'ref') returning id`;
      const [post] = await sql`
        insert into post (connected_account_id, platform_post_id)
        values (${acct.id}, ${"p-" + crypto.randomUUID()}) returning id`;
      const vec = "[" + Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",") + "]";
      for (let i = 0; i < 40; i++) {
        await sql`
          insert into comment (post_id, commenter_hash, body, sentiment, sentiment_confidence, language, embedding)
          values (${post.id}, ${"r" + i}, 'corruption', 'hostile', 0.9, 'en', ${vec}::vector)`;
      }
      await sql`select run_detection()`;
      const [{ count: openCount }] = await sql`
        select count(*)::int as count from alert where status in ('open','acknowledged')`;
      assert(openCount >= 1, "alert raised while connected");

      // Revoke → recompute → the alert should auto-close (source data excluded).
      await sql`update connected_account set consent_status='revoked', revoked_at=now() where id=${acct.id}`;
      await sql`select recompute_after_revoke()`;
      const [{ count: stillOpen }] = await sql`
        select count(*)::int as count from alert where status in ('open','acknowledged')`;
      assertEquals(stillOpen, 0, "alert auto-closed after revoke");
    } finally {
      await sql.end();
    }
  },
});
