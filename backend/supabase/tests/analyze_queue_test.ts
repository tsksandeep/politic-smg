// analyze_queue_test.ts — pgmq analyze pipeline: dedup, bounded retries → DLQ, reconcile catch-all,
// and DLQ exclusion (migration 0014_analyze_queue.sql). Integration test (guarded by DATABASE_URL).

import { assert, assertEquals } from "std/assert/mod.ts";

Deno.test({
  name: "analyze queue: dedup, retry cap → DLQ, reconcile catch-all + DLQ exclusion",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    const liveFor = async (id: string) =>
      (await sql`select count(*)::int as n from pgmq.q_analyze_jobs where (message->>'comment_id') = ${id}`)[
        0
      ].n;
    const dlqFor = async (id: string) =>
      (await sql`select count(*)::int as n from pgmq.q_analyze_jobs_dlq where (message->>'comment_id') = ${id}`)[
        0
      ].n;
    try {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;
      await sql`select pgmq.purge_queue('analyze_jobs')`;
      await sql`select pgmq.purge_queue('analyze_jobs_dlq')`;

      const [cadre] = await sql`insert into cadre (display_name) values ('q') returning id`;
      const [acct] = await sql`
        insert into connected_account (cadre_id, platform, external_id, consent_status, token_ref)
        values (${cadre.id}, 'instagram', ${
        "acc-" + crypto.randomUUID()
      }, 'connected', 'ref') returning id`;
      const [post] = await sql`
        insert into post (connected_account_id, platform_post_id)
        values (${acct.id}, ${"p-" + crypto.randomUUID()}) returning id`;
      const [c] = await sql`
        insert into comment (post_id, commenter_hash, body) values (${post.id}, 'h', 'poison') returning id`;

      // Producer dedup: enqueuing the same comment twice yields a single live message.
      await sql`select enqueue_analyze_comment(${c.id})`;
      await sql`select enqueue_analyze_comment(${c.id})`;
      assertEquals(await liveFor(c.id), 1, "double-enqueue stays a single message");

      // Fail it past the retry cap (max_reads=2): claim increments read_ct, fail resets visibility.
      for (let i = 0; i < 2; i++) {
        await sql`select claim_analyze_jobs(10, 0, 2)`;
        const [m] = await sql`select msg_id from pgmq.q_analyze_jobs limit 1`;
        if (m) await sql`select fail_analyze_job(${m.msg_id})`;
      }
      // Next claim sees read_ct > 2 → auto-moves the message to the DLQ.
      await sql`select claim_analyze_jobs(10, 0, 2)`;
      assertEquals(await liveFor(c.id), 0, "poison message left the live queue");
      assertEquals(await dlqFor(c.id), 1, "poison message landed in the DLQ");

      // Reconcile must NOT resurrect a DLQ'd comment (no infinite re-processing loop).
      await sql`select reconcile_analyze_queue(100)`;
      assertEquals(await liveFor(c.id), 0, "reconcile excludes DLQ'd comments");

      // Reconcile DOES pick up an un-embedded comment that was never enqueued (catch-all).
      const [c2] = await sql`
        insert into comment (post_id, commenter_hash, body) values (${post.id}, 'h2', 'fresh') returning id`;
      const [{ added }] = await sql`select reconcile_analyze_queue(100) as added`;
      assert(added >= 1, "reconcile enqueues a never-queued comment");
      assertEquals(await liveFor(c2.id), 1, "fresh comment is now queued exactly once");
    } finally {
      await sql`select pgmq.purge_queue('analyze_jobs')`.catch(() => {});
      await sql`select pgmq.purge_queue('analyze_jobs_dlq')`.catch(() => {});
      await sql.end();
    }
  },
});
