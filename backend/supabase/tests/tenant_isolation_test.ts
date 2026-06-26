// tests/tenant_isolation_test.ts — THE property test (Principle I / FR-002 / SC-001).
//
// Two tenants A and B each get a real row in every tenant-scoped table. Acting AS tenant A's admin
// through RLS (role=authenticated + auth.uid()=A's user → current_tenant()=A), we assert that across
// tracked_account, post, comment, narrative, alert, work_assignment, submission, node,
// coordination_signal and detection_settings:
//   • SELECT never returns a single B row (cannot read / enumerate),
//   • UPDATE / DELETE of a B row affects 0 rows (cannot mutate),
//   • INSERT of a row carrying tenant_id = B is rejected (cannot forge cross-tenant data),
//   • the SAME query against A's own rows DOES return them (positive control — RLS is not just "deny
//     everything", which would pass a broken test).
// If isolation regresses, this fails loudly.
//
// Run:  deno test --allow-net --allow-env tenant_isolation_test.ts
// Needs: local Supabase up (db on 54322) with migrations 0001..0007 applied.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connect, createTenant, createUser, q, uuid, withUser } from "./helpers.ts";

interface Seeded {
  tracked_account: string;
  node: string;
  post: string;
  comment: string;
  narrative: string;
  work_assignment: string;
  submission: string;
  coordination_signal: string;
  alert: string;
}

// deno-lint-ignore no-explicit-any
async function seedTenant(client: any, tenantId: string): Promise<Seeded> {
  const ids = {
    tracked_account: uuid(),
    node: uuid(),
    post: uuid(),
    comment: uuid(),
    narrative: uuid(),
    work_assignment: uuid(),
    submission: uuid(),
    coordination_signal: uuid(),
    alert: uuid(),
  };
  await q(client, {
    text: `insert into node (id, tenant_id, label, token_hash) values ($1,$2,'node',$3)`,
    args: [ids.node, tenantId, "tok-" + uuid()],
  });
  await q(client, {
    text:
      `insert into tracked_account (id, tenant_id, platform, handle) values ($1,$2,'instagram',$3)`,
    args: [ids.tracked_account, tenantId, "acct-" + uuid().slice(0, 8)],
  });
  await q(client, {
    text:
      `insert into post (id, tenant_id, tracked_account_id, shortcode) values ($1,$2,$3,$4)`,
    args: [ids.post, tenantId, ids.tracked_account, "sc-" + uuid().slice(0, 8)],
  });
  await q(client, {
    text:
      `insert into comment (id, tenant_id, post_id, author_hash, body) values ($1,$2,$3,$4,'secret')`,
    args: [ids.comment, tenantId, ids.post, "hash-" + uuid().slice(0, 8)],
  });
  await q(client, {
    text: `insert into narrative (id, tenant_id) values ($1,$2)`,
    args: [ids.narrative, tenantId],
  });
  await q(client, {
    text:
      `insert into work_assignment (id, tenant_id, target_kind, tracked_account_id) values ($1,$2,'account',$3)`,
    args: [ids.work_assignment, tenantId, ids.tracked_account],
  });
  await q(client, {
    text:
      `insert into submission (id, tenant_id, node_id, work_assignment_id) values ($1,$2,$3,$4)`,
    args: [ids.submission, tenantId, ids.node, ids.work_assignment],
  });
  await q(client, {
    text:
      `insert into coordination_signal (id, tenant_id, signal_type, score) values ($1,$2,'temporal',0.7)`,
    args: [ids.coordination_signal, tenantId],
  });
  await q(client, {
    text: `insert into alert (id, tenant_id, kind, narrative_id) values ($1,$2,'emerging_narrative',$3)`,
    args: [ids.alert, tenantId, ids.narrative],
  });
  return ids;
}

// Each table: how to attempt a forged INSERT that carries tenant_id = B (must be rejected by RLS).
function insertAttempts(tenantB: string, b: Seeded): { name: string; text: string; args: unknown[] }[] {
  return [
    {
      name: "tracked_account",
      text: `insert into tracked_account (tenant_id, handle) values ($1,$2)`,
      args: [tenantB, "x-" + uuid().slice(0, 8)],
    },
    {
      name: "node",
      text: `insert into node (tenant_id, label, token_hash) values ($1,'n',$2)`,
      args: [tenantB, "tok-" + uuid()],
    },
    {
      name: "post",
      text: `insert into post (tenant_id, tracked_account_id, shortcode) values ($1,$2,$3)`,
      args: [tenantB, b.tracked_account, "sc-" + uuid().slice(0, 8)],
    },
    {
      name: "comment",
      text: `insert into comment (tenant_id, post_id, author_hash) values ($1,$2,'h')`,
      args: [tenantB, b.post],
    },
    { name: "narrative", text: `insert into narrative (tenant_id) values ($1)`, args: [tenantB] },
    {
      name: "work_assignment",
      text: `insert into work_assignment (tenant_id, target_kind) values ($1,'account')`,
      args: [tenantB],
    },
    {
      name: "submission",
      text: `insert into submission (tenant_id, node_id, work_assignment_id) values ($1,$2,$3)`,
      args: [tenantB, b.node, b.work_assignment],
    },
    {
      name: "coordination_signal",
      text: `insert into coordination_signal (tenant_id, signal_type, score) values ($1,'temporal',0.5)`,
      args: [tenantB],
    },
    {
      name: "alert",
      text: `insert into alert (tenant_id, kind) values ($1,'emerging_narrative')`,
      args: [tenantB],
    },
    {
      name: "detection_settings",
      text: `insert into detection_settings (tenant_id) values ($1)`,
      args: [tenantB],
    },
  ];
}

const READ_TABLES = [
  "tracked_account",
  "node",
  "post",
  "comment",
  "narrative",
  "work_assignment",
  "submission",
  "coordination_signal",
  "alert",
  "detection_settings",
];

Deno.test("tenant isolation property — A cannot read/write/enumerate B (SC-001)", async (t) => {
  const client = await connect();
  try {
    const tenantA = await createTenant(client);
    const tenantB = await createTenant(client);
    const adminA = await createUser(client, tenantA, "admin");
    await seedTenant(client, tenantA);
    const b = await seedTenant(client, tenantB);

    // ---- READ isolation + positive control, per table ----
    for (const tbl of READ_TABLES) {
      await t.step(`read isolation: ${tbl}`, async () => {
        await withUser(client, adminA, async (tx) => {
          const bSeen = await q(tx, {
            text: `select count(*)::int as n from ${tbl} where tenant_id = $1`,
            args: [tenantB],
          }) as { rows: { n: number }[] };
          assertEquals(bSeen.rows[0].n, 0, `${tbl}: A saw ${bSeen.rows[0].n} of B's rows`);

          const aSeen = await q(tx, {
            text: `select count(*)::int as n from ${tbl} where tenant_id = $1`,
            args: [tenantA],
          }) as { rows: { n: number }[] };
          assert(aSeen.rows[0].n >= 1, `${tbl}: positive control failed — A cannot see its OWN rows`);
        });
      });
    }

    // ---- UPDATE / DELETE of B rows must be no-ops (0 rows) ----
    for (const tbl of READ_TABLES) {
      await t.step(`mutate isolation: ${tbl}`, async () => {
        await withUser(client, adminA, async (tx) => {
          // deno-lint-ignore no-explicit-any
          const upd: any = await q(tx, {
            text: `update ${tbl} set tenant_id = tenant_id where tenant_id = $1`,
            args: [tenantB],
          });
          assertEquals(upd.rowCount ?? 0, 0, `${tbl}: A updated ${upd.rowCount} of B's rows`);
          // deno-lint-ignore no-explicit-any
          const del: any = await q(tx, {
            text: `delete from ${tbl} where tenant_id = $1`,
            args: [tenantB],
          });
          assertEquals(del.rowCount ?? 0, 0, `${tbl}: A deleted ${del.rowCount} of B's rows`);
        });
      });
    }

    // ---- Forged cross-tenant INSERT must be rejected (own transaction each, since it aborts) ----
    for (const attempt of insertAttempts(tenantB, b)) {
      await t.step(`insert isolation: ${attempt.name}`, async () => {
        let rejected = false;
        try {
          await withUser(client, adminA, async (tx) => {
            await q(tx, { text: attempt.text, args: attempt.args });
          });
        } catch (_e) {
          rejected = true; // RLS WITH CHECK / missing-policy → error: the desired outcome
        }
        assert(rejected, `${attempt.name}: forged INSERT with tenant_id=B was NOT rejected`);
        // And confirm B's row count did not grow (belt and suspenders).
        const after = await q(client, {
          text: `select count(*)::int as n from ${attempt.name} where tenant_id = $1`,
          args: [tenantB],
        }) as { rows: { n: number }[] };
        // detection_settings/B already has exactly 1; the others exactly 1 from the seed.
        assert(after.rows[0].n <= 1, `${attempt.name}: a forged B row leaked in`);
      });
    }
  } finally {
    await client.end();
  }
});
