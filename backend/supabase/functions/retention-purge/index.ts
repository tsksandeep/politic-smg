// functions/retention-purge (T045) — LAUNCH-BLOCKING (Principle III, FR-009/FR-010).
// Daily pg_cron job that:
//   1) deletes raw comment text older than 30 days (anonymized derivatives are kept),
//   2) purges all data for revoked accounts,
//   3) recomputes narratives/alerts so removed data drops out.
// Heavy lifting is a single SQL function (purge_expired_data) for atomicity.

import { serviceClient } from "../../shared/db.ts";
import { jsonResponse, logger } from "../../shared/log.ts";

const log = logger("retention-purge");

Deno.serve(async () => {
  const db = serviceClient();
  const { data, error } = await db.rpc("purge_expired_data");
  if (error) {
    log.error("purge failed", { error: error.message });
    return jsonResponse({ error: error.message }, 500);
  }
  log.info("purge complete", { result: data });
  return jsonResponse({ purged: data });
});
