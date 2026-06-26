// tests/coordination_test.ts — inferred coordination detection (FR-011, SC-006).
// Seeds a synchronised burst for tenant A: >= coordination_min_accounts distinct tracked accounts
// each dropping a post in-window that SHARES one reel audio_id AND an identical hashtag. Calls
// detect_coordination() and asserts a coordination_signal of the right type names the contributing
// account_ids and that a coordinated_attack alert is raised. A single isolated post (tenant B) must
// NOT trip anything.
//
// Run:  deno test --allow-net --allow-env coordination_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connect, createTenant, createTrackedAccount, q, uuid } from "./helpers.ts";

Deno.test("coordination — shared-audio + identical-hashtag burst trips; isolated post does not", async (t) => {
  const client = await connect();
  try {
    const MIN = 4;
    const tenantA = await createTenant(client, {
      coordination_window: "30 minutes",
      coordination_min_accounts: MIN,
    });
    const tenantB = await createTenant(client, {
      coordination_window: "30 minutes",
      coordination_min_accounts: MIN,
    });

    // ---- Tenant A: 5 distinct accounts, same audio_id + same hashtag, all just now ----
    const SHARED_AUDIO = "audio_burst_xyz";
    const HASHTAG = "#voteforchange";
    const accountIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const acc = await createTrackedAccount(client, tenantA, `cadre_a_${i}`);
      accountIds.push(acc);
      const postId = uuid();
      await q(client, {
        text: `insert into post
          (id, tenant_id, tracked_account_id, shortcode, audio_id, taken_at, first_seen_at)
          values ($1,$2,$3,$4,$5, now(), now())`,
        args: [postId, tenantA, acc, "burst-" + uuid().slice(0, 8), SHARED_AUDIO],
      });
      await q(client, {
        text: `insert into post_entity (tenant_id, post_id, kind, value) values ($1,$2,'hashtag',$3)`,
        args: [tenantA, postId, HASHTAG],
      });
    }

    // ---- Tenant B: a single isolated post (its own audio + hashtag) ----
    const accB = await createTrackedAccount(client, tenantB, "lonely_b");
    const soloPost = uuid();
    await q(client, {
      text: `insert into post
        (id, tenant_id, tracked_account_id, shortcode, audio_id, taken_at, first_seen_at)
        values ($1,$2,$3,$4,'audio_solo', now(), now())`,
      args: [soloPost, tenantB, accB, "solo-" + uuid().slice(0, 8)],
    });
    await q(client, {
      text: `insert into post_entity (tenant_id, post_id, kind, value) values ($1,$2,'hashtag','#solo')`,
      args: [tenantB, soloPost],
    });

    // ---- Run coordination detection ----
    await q(client, { text: `select detect_coordination()` });

    await t.step("shared_audio signal names the contributing accounts", async () => {
      const r = await q(client, {
        text: `select account_ids, score from coordination_signal
                where tenant_id=$1 and signal_type='shared_audio'`,
        args: [tenantA],
      }) as { rows: { account_ids: string[]; score: number }[] };
      assert(r.rows.length >= 1, "no shared_audio coordination_signal was produced");
      const sig = r.rows[0];
      assert(sig.account_ids.length >= MIN, `too few contributing accounts: ${sig.account_ids.length}`);
      for (const id of accountIds) {
        assert(sig.account_ids.includes(id), `account ${id} missing from coordination signal`);
      }
      assert(sig.score >= 0.5, `coordination score below alert threshold: ${sig.score}`);
    });

    await t.step("identical-hashtag content signal also raised", async () => {
      const n = await q(client, {
        text: `select count(*)::int as n from coordination_signal
                where tenant_id=$1 and signal_type='content'`,
        args: [tenantA],
      }) as { rows: { n: number }[] };
      assert(n.rows[0].n >= 1, "no content (identical-hashtag) coordination signal was produced");
    });

    await t.step("coordinated_attack alert raised", async () => {
      const a = await q(client, {
        text: `select count(*)::int as n from alert where tenant_id=$1 and kind='coordinated_attack'`,
        args: [tenantA],
      }) as { rows: { n: number }[] };
      assert(a.rows[0].n >= 1, "no coordinated_attack alert was raised for the burst");
    });

    await t.step("isolated single post does NOT trip coordination (SC-006)", async () => {
      const sig = await q(client, {
        text: `select count(*)::int as n from coordination_signal where tenant_id=$1`,
        args: [tenantB],
      }) as { rows: { n: number }[] };
      assertEquals(sig.rows[0].n, 0, "an isolated post wrongly produced a coordination signal");
      const alert = await q(client, {
        text: `select count(*)::int as n from alert where tenant_id=$1 and kind='coordinated_attack'`,
        args: [tenantB],
      }) as { rows: { n: number }[] };
      assertEquals(alert.rows[0].n, 0, "an isolated post wrongly raised a coordinated_attack alert");
    });
  } finally {
    await client.end();
  }
});
