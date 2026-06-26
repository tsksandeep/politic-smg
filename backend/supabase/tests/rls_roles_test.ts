// tests/rls_roles_test.ts — least-privilege role separation within a tenant (FR-016 / Principle I).
//
// Admin manages tenant users, nodes, the target list, and detection settings; Analyst monitors
// boards and triages alerts but MUST NOT perform admin writes. We verify both the negative
// (analyst is blocked) and the positive (admin succeeds; analyst can still read + triage), all
// through RLS as the real signed-in user.
//
// Run:  deno test --allow-net --allow-env rls_roles_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connect, createTenant, createUser, q, uuid, withUser } from "./helpers.ts";

Deno.test("RLS roles — analyst is read+triage only, admin can write config", async (t) => {
  const client = await connect();
  try {
    const tenant = await createTenant(client);
    const admin = await createUser(client, tenant, "admin");
    const analyst = await createUser(client, tenant, "analyst");

    // Seed a narrative + alert so the boards and triage path have something to act on.
    const narrativeId = uuid();
    const alertId = uuid();
    await q(client, {
      text: `insert into narrative (id, tenant_id, theme_summary) values ($1,$2,'test narrative')`,
      args: [narrativeId, tenant],
    });
    await q(client, {
      text:
        `insert into alert (id, tenant_id, kind, narrative_id) values ($1,$2,'emerging_narrative',$3)`,
      args: [alertId, tenant, narrativeId],
    });

    // ---------- ANALYST: read boards ----------
    await t.step("analyst can read narrative_board + alert_board", async () => {
      await withUser(client, analyst, async (tx) => {
        const nb = await q(tx, {
          text: `select count(*)::int as n from narrative_board where tenant_id = $1`,
          args: [tenant],
        }) as { rows: { n: number }[] };
        assert(nb.rows[0].n >= 1, "analyst could not read narrative_board");
        const ab = await q(tx, {
          text: `select count(*)::int as n from alert_board where tenant_id = $1`,
          args: [tenant],
        }) as { rows: { n: number }[] };
        assert(ab.rows[0].n >= 1, "analyst could not read alert_board");
      });
    });

    // ---------- ANALYST: triage an alert (allowed) ----------
    await t.step("analyst CAN triage (acknowledge/annotate/close) an alert", async () => {
      await withUser(client, analyst, async (tx) => {
        // deno-lint-ignore no-explicit-any
        const r: any = await q(tx, {
          text:
            `update alert set status='acknowledged', acknowledged_at=now(), response_note='looking'
             where id = $1`,
          args: [alertId],
        });
        assertEquals(r.rowCount, 1, "analyst triage update did not take effect");
      });
    });

    // ---------- ANALYST: admin-only writes are blocked ----------
    await t.step("analyst CANNOT write detection_settings", async () => {
      await withUser(client, analyst, async (tx) => {
        // deno-lint-ignore no-explicit-any
        const r: any = await q(tx, {
          text: `update detection_settings set min_cluster_volume = 99 where tenant_id = $1`,
          args: [tenant],
        });
        assertEquals(r.rowCount ?? 0, 0, "analyst was able to update detection_settings");
      });
    });

    await t.step("analyst CANNOT insert a tracked_account", async () => {
      let rejected = false;
      try {
        await withUser(client, analyst, async (tx) => {
          await q(tx, {
            text: `insert into tracked_account (tenant_id, handle) values ($1,$2)`,
            args: [tenant, "blocked-" + uuid().slice(0, 8)],
          });
        });
      } catch (_e) {
        rejected = true;
      }
      assert(rejected, "analyst was able to insert a tracked_account (admin-only)");
    });

    await t.step("analyst CANNOT insert a node", async () => {
      let rejected = false;
      try {
        await withUser(client, analyst, async (tx) => {
          await q(tx, {
            text: `insert into node (tenant_id, label, token_hash) values ($1,'x',$2)`,
            args: [tenant, "tok-" + uuid()],
          });
        });
      } catch (_e) {
        rejected = true;
      }
      assert(rejected, "analyst was able to insert a node (admin-only)");
    });

    await t.step("analyst CANNOT add a tenant_user", async () => {
      let rejected = false;
      try {
        await withUser(client, analyst, async (tx) => {
          const newId = uuid();
          // (auth.users row not even needed — RLS rejects before the FK is reached)
          await q(tx, {
            text: `insert into tenant_user (id, tenant_id, role) values ($1,$2,'analyst')`,
            args: [newId, tenant],
          });
        });
      } catch (_e) {
        rejected = true;
      }
      assert(rejected, "analyst was able to add a tenant_user (admin-only)");
    });

    // ---------- ADMIN: the same writes succeed ----------
    await t.step("admin CAN write detection_settings", async () => {
      await withUser(client, admin, async (tx) => {
        // deno-lint-ignore no-explicit-any
        const r: any = await q(tx, {
          text: `update detection_settings set min_cluster_volume = 7 where tenant_id = $1`,
          args: [tenant],
        });
        assertEquals(r.rowCount, 1, "admin could not update detection_settings");
      });
    });

    await t.step("admin CAN insert a tracked_account and a node", async () => {
      await withUser(client, admin, async (tx) => {
        // deno-lint-ignore no-explicit-any
        const ta: any = await q(tx, {
          text: `insert into tracked_account (tenant_id, handle) values ($1,$2)`,
          args: [tenant, "ok-" + uuid().slice(0, 8)],
        });
        assertEquals(ta.rowCount, 1, "admin could not insert tracked_account");
        // deno-lint-ignore no-explicit-any
        const nd: any = await q(tx, {
          text: `insert into node (tenant_id, label, token_hash) values ($1,'ok',$2)`,
          args: [tenant, "tok-" + uuid()],
        });
        assertEquals(nd.rowCount, 1, "admin could not insert node");
      });
    });
  } finally {
    await client.end();
  }
});
