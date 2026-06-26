// tests/detection_test.ts — narrative clustering, lifecycle, and emerging early-warning
// (FR-009/010/012, SC-003). Seeds a clustered HOSTILE set for tenant A (deterministic 768-dim
// embeddings) that should trip the emerging-narrative velocity threshold, and a small BENIGN/positive
// set for tenant B that should NOT raise any anti-opposition alert. Calls run_detection() (the cron
// brain, run here as the service-role/superuser context) and asserts on the results.
//
// Run:  deno test --allow-net --allow-env detection_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { connect, createTenant, createTrackedAccount, q, uuid, vec } from "./helpers.ts";

Deno.test("detection — hostile cluster trips emerging alert; benign set does not", async (t) => {
  const client = await connect();
  try {
    // thresholds: growth >= 2.0 AND recent-volume >= 3 AND emerging/resurgent → alert.
    const tenantA = await createTenant(client, {
      emerging_velocity_threshold: 2.0,
      coordination_window: "30 minutes",
      min_cluster_volume: 3,
    });
    const tenantB = await createTenant(client, {
      emerging_velocity_threshold: 2.0,
      coordination_window: "30 minutes",
      min_cluster_volume: 3,
    });

    // ---- Tenant A: one tight hostile cluster, all freshly seen (v_recent high, v_prior 0) ----
    const accA = await createTrackedAccount(client, tenantA, "opp_cadre_a");
    const CLUSTER = 1;
    for (let i = 0; i < 5; i++) {
      await q(client, {
        text: `insert into post
          (tenant_id, tracked_account_id, shortcode, caption, caption_embedding, taken_at, first_seen_at)
          values ($1,$2,$3,$4,$5::vector, now(), now())`,
        args: [tenantA, accA, "A-sc-" + uuid().slice(0, 8), "they are corrupt traitors", vec(CLUSTER, i)],
      });
    }
    // a few hostile comments in the same semantic space → attach, add volume + confidence.
    for (let i = 0; i < 3; i++) {
      const pid = (await q(client, {
        text: `select id from post where tenant_id=$1 order by first_seen_at limit 1`,
        args: [tenantA],
      }) as { rows: { id: string }[] }).rows[0].id;
      await q(client, {
        text: `insert into comment
          (tenant_id, post_id, author_hash, body, embedding, sentiment, sentiment_confidence, ingested_at)
          values ($1,$2,$3,'burn it down',$4::vector,'hostile',0.9, now())`,
        args: [tenantA, pid, "h-" + uuid().slice(0, 8), vec(CLUSTER, 10 + i)],
      });
    }
    // engagement samples so the velocity proxy is non-zero.
    const aPosts = (await q(client, {
      text: `select id from post where tenant_id=$1`,
      args: [tenantA],
    }) as { rows: { id: string }[] }).rows;
    for (const p of aPosts) {
      await q(client, {
        text:
          `insert into post_metric_sample (tenant_id, post_id, like_count, comment_count, at)
           values ($1,$2,500,50, now())`,
        args: [tenantA, p.id],
      });
    }

    // ---- Tenant B: a single benign/positive post → forms a narrative but never trips ----
    const accB = await createTrackedAccount(client, tenantB, "ally_b");
    await q(client, {
      text: `insert into post
        (tenant_id, tracked_account_id, shortcode, caption, caption_embedding, taken_at, first_seen_at)
        values ($1,$2,$3,'great work by the team today',$4::vector, now(), now())`,
      args: [tenantB, accB, "B-sc-" + uuid().slice(0, 8), vec(50, 0)],
    });
    await q(client, {
      text: `insert into comment
        (tenant_id, post_id, author_hash, body, embedding, sentiment, sentiment_confidence, ingested_at)
        select $1, id, 'p-1', 'love this', $2::vector, 'positive', 0.8, now()
          from post where tenant_id=$1 limit 1`,
      args: [tenantB, vec(50, 1)],
    });

    // ---- Run the detection brain ----
    await q(client, { text: `select run_detection()` });

    await t.step("hostile posts clustered into a narrative", async () => {
      const n = await q(client, {
        text: `select count(*)::int as n from narrative where tenant_id=$1`,
        args: [tenantA],
      }) as { rows: { n: number }[] };
      assertEquals(n.rows[0].n, 1, "expected exactly one hostile narrative for tenant A");
      const unassigned = await q(client, {
        text: `select count(*)::int as n from post where tenant_id=$1 and narrative_id is null`,
        args: [tenantA],
      }) as { rows: { n: number }[] };
      assertEquals(unassigned.rows[0].n, 0, "some hostile posts were left unclustered");
    });

    await t.step("narrative metrics + lifecycle + observation computed", async () => {
      const nr = await q(client, {
        text:
          `select volume, growth_rate, lifecycle_state, confidence from narrative where tenant_id=$1`,
        args: [tenantA],
      }) as { rows: { volume: number; growth_rate: number; lifecycle_state: string; confidence: number }[] };
      const row = nr.rows[0];
      assert(row.volume >= 5, `narrative volume too low: ${row.volume}`);
      assert(row.growth_rate >= 2.0, `growth_rate did not reflect the burst: ${row.growth_rate}`);
      assert(
        ["emerging", "resurgent", "peaking"].includes(row.lifecycle_state),
        `unexpected lifecycle_state: ${row.lifecycle_state}`,
      );
      assert(row.confidence !== null, "confidence (avg comment sentiment_confidence) was not set");

      const obs = await q(client, {
        text: `select count(*)::int as n from narrative_observation where tenant_id=$1`,
        args: [tenantA],
      }) as { rows: { n: number }[] };
      assert(obs.rows[0].n >= 1, "no narrative_observation time-series point was written");
    });

    await t.step("emerging-narrative alert raised for the hostile burst (SC-003)", async () => {
      const a = await q(client, {
        text:
          `select count(*)::int as n from alert where tenant_id=$1 and kind='emerging_narrative'`,
        args: [tenantA],
      }) as { rows: { n: number }[] };
      assert(a.rows[0].n >= 1, "no emerging_narrative alert was raised for the hostile burst");
    });

    await t.step("benign/positive set raises NO anti-opposition alert", async () => {
      const a = await q(client, {
        text: `select count(*)::int as n from alert where tenant_id=$1`,
        args: [tenantB],
      }) as { rows: { n: number }[] };
      assertEquals(a.rows[0].n, 0, "a benign tenant wrongly received an alert");
    });
  } finally {
    await client.end();
  }
});
