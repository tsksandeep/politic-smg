// triage_test.ts (T041) — acknowledge/close lifecycle + response latency (FR-013/FR-014, SC-006).
// DB-level test guarded by DATABASE_URL.

import { assert } from "std/assert/mod.ts";

Deno.test({
  name: "alert acknowledge → close records response latency",
  ignore: !Deno.env.get("DATABASE_URL"),
  fn: async () => {
    const postgres = (await import("npm:postgres@3")).default;
    const sql = postgres(Deno.env.get("DATABASE_URL")!);
    try {
      await sql`truncate cadre, connected_account, post, comment, narrative, alert restart identity cascade`;
      const [n] = await sql`insert into narrative (volume) values (50) returning id`;
      const [a] = await sql`
        insert into alert (narrative_id, detected_at) values (${n.id}, now() - interval '5 minutes')
        returning id`;

      await sql`update alert set status='acknowledged', acknowledged_at=now() where id=${a.id}`;
      await sql`update alert set status='closed', closed_at=now() where id=${a.id}`;

      const [row] = await sql`
        select status, response_latency, extract(epoch from response_latency) as secs
        from alert where id=${a.id}`;
      assert(row.status === "closed", "alert is closed");
      assert(Number(row.secs) >= 290, "response_latency reflects detection→close (~5 min)");
    } finally {
      await sql.end();
    }
  },
});
