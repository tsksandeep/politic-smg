// tests/reconcile_trust_test.ts — redundancy, reconciliation & anti-poisoning (Principle VII, FR-014).
// Seeds three redundant submissions for the same post_metrics target from three nodes: two agree,
// one is a wild outlier. Calls reconcile_submissions() and asserts:
//   • agreeing submissions are reconciled (not diverged) and their nodes gain trust,
//   • the outlier submission is flagged diverged and its node's trust decays,
//   • a node pushed below the 0.2 trust floor is quarantined (cannot keep poisoning metrics).
//
// Run:  deno test --allow-net --allow-env reconcile_trust_test.ts

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connect, createTenant, createTrackedAccount, q, uuid } from "./helpers.ts";

async function makeNode(
  // deno-lint-ignore no-explicit-any
  client: any,
  tenantId: string,
  trust: number,
): Promise<string> {
  const id = uuid();
  await q(client, {
    text:
      `insert into node (id, tenant_id, label, token_hash, trust_score) values ($1,$2,'n',$3,$4)`,
    args: [id, tenantId, "tok-" + uuid(), trust],
  });
  return id;
}

async function submit(
  // deno-lint-ignore no-explicit-any
  client: any,
  tenantId: string,
  nodeId: string,
  postId: string,
  trackedAccountId: string,
  likes: number,
): Promise<string> {
  const waId = uuid();
  await q(client, {
    text: `insert into work_assignment
      (id, tenant_id, node_id, target_kind, tracked_account_id, post_id, state)
      values ($1,$2,$3,'post_metrics',$4,$5,'submitted')`,
    args: [waId, tenantId, nodeId, trackedAccountId, postId],
  });
  const subId = uuid();
  await q(client, {
    text: `insert into submission (id, tenant_id, node_id, work_assignment_id, payload)
           values ($1,$2,$3,$4,$5::jsonb)`,
    args: [subId, tenantId, nodeId, waId, JSON.stringify({ metrics: { like_count: likes } })],
  });
  return subId;
}

Deno.test("reconcile — agreement raises trust, divergence decays + quarantines", async (t) => {
  const client = await connect();
  try {
    const tenant = await createTenant(client);
    const acc = await createTrackedAccount(client, tenant, "target_acc");
    const postId = uuid();
    await q(client, {
      text:
        `insert into post (id, tenant_id, tracked_account_id, shortcode) values ($1,$2,$3,$4)`,
      args: [postId, tenant, acc, "sc-" + uuid().slice(0, 8)],
    });

    const good1 = await makeNode(client, tenant, 0.5);
    const good2 = await makeNode(client, tenant, 0.5);
    const bad = await makeNode(client, tenant, 0.22); // one divergence (−0.05) drops it below 0.2

    // Two agree (~101 likes), one is a wild outlier (500) → median = 102.
    const sGood1 = await submit(client, tenant, good1, postId, acc, 100);
    const sGood2 = await submit(client, tenant, good2, postId, acc, 102);
    const sBad = await submit(client, tenant, bad, postId, acc, 500);

    await q(client, { text: `select reconcile_submissions()` });

    await t.step("agreeing submissions reconciled, not diverged", async () => {
      for (const id of [sGood1, sGood2]) {
        const r = await q(client, {
          text: `select reconciled, diverged from submission where id=$1`,
          args: [id],
        }) as { rows: { reconciled: boolean; diverged: boolean }[] };
        assertEquals(r.rows[0].reconciled, true, "agreeing submission not reconciled");
        assertEquals(r.rows[0].diverged, false, "agreeing submission wrongly flagged diverged");
      }
    });

    await t.step("outlier submission flagged diverged", async () => {
      const r = await q(client, {
        text: `select reconciled, diverged from submission where id=$1`,
        args: [sBad],
      }) as { rows: { reconciled: boolean; diverged: boolean }[] };
      assertEquals(r.rows[0].reconciled, true, "outlier submission not reconciled");
      assertEquals(r.rows[0].diverged, true, "outlier submission was NOT flagged diverged");
    });

    await t.step("agreeing nodes gain trust", async () => {
      for (const id of [good1, good2]) {
        const r = await q(client, {
          text: `select trust_score, status from node where id=$1`,
          args: [id],
        }) as { rows: { trust_score: number; status: string }[] };
        assertAlmostEquals(r.rows[0].trust_score, 0.51, 1e-4, "agreeing node trust did not rise");
        assertEquals(r.rows[0].status, "active", "agreeing node was wrongly quarantined");
      }
    });

    await t.step("diverged node decays below floor and is quarantined", async () => {
      const r = await q(client, {
        text: `select trust_score, status from node where id=$1`,
        args: [bad],
      }) as { rows: { trust_score: number; status: string }[] };
      assertAlmostEquals(r.rows[0].trust_score, 0.17, 1e-4, "diverged node trust did not decay");
      assertEquals(r.rows[0].status, "quarantined", "low-trust node was NOT quarantined");
      assert(r.rows[0].trust_score < 0.2, "trust above the quarantine floor");
    });
  } finally {
    await client.end();
  }
});
