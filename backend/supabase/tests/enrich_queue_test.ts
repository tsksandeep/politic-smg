// tests/enrich_queue_test.ts — pgmq enrichment queue semantics (0004_queues.sql).
// Exercises the real queue RPCs: enqueue_enrich → claim_jobs → complete_job (happy path),
// fail_job + claim_jobs poison handling (message archived to the DLQ once read_ct passes max_reads),
// and reconcile_enrich_queue (gap-filler enqueues un-embedded comments).
//
// pgmq queues are global singletons created in the migration, so each section purges the queue first
// to stay deterministic. Tenant rows in the message bodies keep workers tenant-scoped.
//
// Run:  deno test --allow-net --allow-env enrich_queue_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connect, createTenant, createTrackedAccount, q, uuid } from "./helpers.ts";

const QUEUE = "enrich_jobs";

// deno-lint-ignore no-explicit-any
async function qlen(client: any): Promise<number> {
  const r = await q(client, { text: `select count(*)::int as n from pgmq.q_${QUEUE}` }) as {
    rows: { n: number }[];
  };
  return r.rows[0].n;
}
// deno-lint-ignore no-explicit-any
async function archiveCount(client: any): Promise<number> {
  const r = await q(client, { text: `select count(*)::int as n from pgmq.a_${QUEUE}` }) as {
    rows: { n: number }[];
  };
  return r.rows[0].n;
}

Deno.test("enrich queue — enqueue/claim/complete, poison→DLQ, reconcile gap-fill", async (t) => {
  const client = await connect();
  try {
    const tenant = await createTenant(client);

    await t.step("enqueue → claim → complete (happy path)", async () => {
      await q(client, { text: `select pgmq.purge_queue($1)`, args: [QUEUE] });
      const commentId = uuid();
      await q(client, {
        text: `select enqueue_enrich($1,'comment',$2)`,
        args: [tenant, commentId],
      });
      assertEquals(await qlen(client), 1, "enqueue_enrich did not place a message");

      const claimed = await q(client, {
        text: `select msg_id, message from claim_jobs($1, 10, 30, 5)`,
        args: [QUEUE],
      }) as { rows: { msg_id: bigint; message: { tenant_id: string; kind: string; id: string } }[] };
      assertEquals(claimed.rows.length, 1, "claim_jobs returned no message");
      const msg = claimed.rows[0];
      assertEquals(msg.message.tenant_id, tenant, "message lost its tenant scope");
      assertEquals(msg.message.kind, "comment");
      assertEquals(msg.message.id, commentId);

      await q(client, { text: `select complete_job($1, $2)`, args: [QUEUE, msg.msg_id] });
      assertEquals(await qlen(client), 0, "complete_job did not remove the message");
    });

    await t.step("poison message moves to the DLQ (archive) after max_reads", async () => {
      await q(client, { text: `select pgmq.purge_queue($1)`, args: [QUEUE] });
      const beforeArchive = await archiveCount(client);
      await q(client, {
        text: `select enqueue_enrich($1,'comment',$2)`,
        args: [tenant, uuid()],
      });

      // max_reads = 2, visibility timeout 0 so it stays poisonable. Each claim_jobs call reads twice
      // (archive-scan + main read), so the read_ct climbs past 2 within two claim cycles.
      const c1 = await q(client, {
        text: `select msg_id from claim_jobs($1, 10, 0, 2)`,
        args: [QUEUE],
      }) as { rows: { msg_id: bigint }[] };
      assertEquals(c1.rows.length, 1, "first claim should still see the message");
      await q(client, { text: `select fail_job($1, $2)`, args: [QUEUE, c1.rows[0].msg_id] });

      // Second claim: archive-scan sees read_ct > 2 → message archived before the main read.
      const c2 = await q(client, {
        text: `select msg_id from claim_jobs($1, 10, 0, 2)`,
        args: [QUEUE],
      }) as { rows: { msg_id: bigint }[] };
      assertEquals(c2.rows.length, 0, "poison message should no longer be claimable");

      assertEquals(await qlen(client), 0, "poison message still sitting in the live queue");
      assertEquals(
        await archiveCount(client),
        beforeArchive + 1,
        "poison message was not moved to the DLQ archive",
      );
    });

    await t.step("reconcile_enrich_queue re-enqueues un-embedded comments", async () => {
      await q(client, { text: `select pgmq.purge_queue($1)`, args: [QUEUE] });
      // a comment with body but no embedding is exactly what the gap-filler should pick up.
      const acc = await createTrackedAccount(client, tenant, "racc");
      const postId = uuid();
      await q(client, {
        text: `insert into post (id, tenant_id, tracked_account_id, shortcode) values ($1,$2,$3,$4)`,
        args: [postId, tenant, acc, "sc-" + uuid().slice(0, 8)],
      });
      await q(client, {
        text:
          `insert into comment (tenant_id, post_id, author_hash, body) values ($1,$2,'h','needs embedding')`,
        args: [tenant, postId],
      });

      const r = await q(client, {
        text: `select reconcile_enrich_queue(1000) as n`,
      }) as { rows: { n: number }[] };
      const n = r.rows[0].n;
      assert(n >= 1, "reconcile_enrich_queue found no un-embedded comments to enqueue");
      assertEquals(await qlen(client), n, "reconcile enqueue count did not match queue length");
    });
  } finally {
    await client.end();
  }
});
