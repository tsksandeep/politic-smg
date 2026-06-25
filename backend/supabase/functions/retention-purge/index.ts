// functions/retention-purge (T045) — LAUNCH-BLOCKING (Principle III, FR-009/FR-010).
// Daily pg_cron job that:
//   1) deletes raw comment text older than 30 days (anonymized derivatives are kept),
//   2) purges all data for revoked accounts,
//   3) recomputes narratives/alerts so removed data drops out,
//   4) purges raw-payload Storage objects older than 30 days (same retention as comment.body).
// DB steps (1-3) are a single SQL function (purge_expired_data) for atomicity; the Storage sweep
// (4) runs here because deleting blobs needs the Storage API, not SQL.

import { serviceClient } from "../../shared/db.ts";
import { jsonResponse, logger } from "../../shared/log.ts";

const log = logger("retention-purge");
const RAW_BUCKET = "raw-payloads";
const RETAIN_MS = 30 * 86400_000;

// Remove raw-payload objects older than 30 days. Walks the bucket root plus one level of
// (typically date-prefixed) folders — the layout an archiver is expected to use. Returns the count
// removed. Best-effort: a Storage error is logged, not fatal, so DB retention is never blocked.
async function purgeStoragePayloads(
  db: ReturnType<typeof serviceClient>,
  cutoffMs: number,
): Promise<number> {
  let removed = 0;
  const stale = (createdAt?: string) =>
    createdAt != null && new Date(createdAt).getTime() < cutoffMs;

  async function sweep(prefix: string): Promise<void> {
    const { data: entries, error } = await db.storage.from(RAW_BUCKET).list(prefix, {
      limit: 1000,
    });
    if (error) {
      log.warn("storage list failed", { prefix, error: error.message });
      return;
    }
    const files: string[] = [];
    for (const e of entries ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      // A null id marks a folder placeholder; recurse one level into it.
      if ((e as { id?: string | null }).id == null) {
        if (!prefix) await sweep(path);
        continue;
      }
      if (stale(e.created_at)) files.push(path);
    }
    if (files.length > 0) {
      const { error: rmErr } = await db.storage.from(RAW_BUCKET).remove(files);
      if (rmErr) log.warn("storage remove failed", { prefix, error: rmErr.message });
      else removed += files.length;
    }
  }

  await sweep("");
  return removed;
}

Deno.serve(async () => {
  const db = serviceClient();
  const { data, error } = await db.rpc("purge_expired_data");
  if (error) {
    log.error("purge failed", { error: error.message });
    return jsonResponse({ error: error.message }, 500);
  }

  // Best-effort: a Storage outage (or no Storage service in local dev) must never block DB retention.
  let storagePurged = 0;
  try {
    storagePurged = await purgeStoragePayloads(db, Date.now() - RETAIN_MS);
  } catch (e) {
    log.warn("storage payload purge skipped", { error: String(e) });
  }

  const result = { ...(data as Record<string, unknown>), raw_payloads_purged: storagePurged };
  log.info("purge complete", { result });
  return jsonResponse({ purged: result });
});
