// functions/work-lease/index.ts — POST /work-lease (Coordinator API, FR-004/006).
//
// Lease a small, rate-capped batch of pending work for THIS node's tenant. Defence-in-depth: the
// service role bypasses RLS, so every query filters explicitly on the token-derived tenant_id
// (Principle I) — the node-supplied body never carries a tenant. Redundancy (Principle VI/VII): a
// node must never hold two redundancy copies of the same logical target, so we skip any candidate
// whose (target_kind, account, post) this node already holds. Stale leases (lease_expires_at < now)
// are first returned to the pool so a burned/offline node's work gets reassigned (Principle IX).

import { serviceClient } from "../../shared/db.ts";
import { errorResponse, jsonResponse, logger, preflight } from "../../shared/log.ts";
import {
  guardNodeActive,
  INSTAGRAM_APP_ID,
  LEASE_RATE,
  verifyNodeToken,
} from "../../shared/node-auth.ts";

const log = logger("work-lease");

const LEASE_TTL_MS = Number(Deno.env.get("WORK_LEASE_TTL_MS") ?? 5 * 60 * 1000); // 5 min default
const MAX_BATCH = 25; // hard cap regardless of requested max_items (Principle IV)

// Key identifying a logical capture target for redundancy de-duplication.
function targetKey(
  a: { target_kind: string; tracked_account_id: string | null; post_id: string | null },
): string {
  return `${a.target_kind}:${a.tracked_account_id ?? ""}:${a.post_id ?? ""}`;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST.");

  const node = await verifyNodeToken(req);
  if (!node) return errorResponse(401, "invalid_node", "Missing or invalid node token.");
  const blocked = guardNodeActive(node, errorResponse);
  if (blocked) return blocked;

  let body: { max_items?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const maxItems = Math.max(1, Math.min(MAX_BATCH, Number(body.max_items ?? 10) || 10));

  const db = serviceClient();
  const tid = node.tenant_id;
  const nowIso = new Date().toISOString();

  // 1. Expire stale leases back to pending (covers a burned-IP / offline node) — tenant-scoped.
  const { error: expireErr } = await db
    .from("work_assignment")
    .update({ state: "pending", node_id: null, lease_expires_at: null })
    .eq("tenant_id", tid)
    .eq("state", "leased")
    .lt("lease_expires_at", nowIso);
  if (expireErr) log.warn("stale-lease expiry failed", { code: expireErr.code });

  // 2. Targets this node already holds (leased or already submitted) — to honour redundancy.
  const { data: held } = await db
    .from("work_assignment")
    .select("target_kind, tracked_account_id, post_id")
    .eq("tenant_id", tid)
    .eq("node_id", node.node_id)
    .in("state", ["leased", "submitted"]);
  const heldKeys = new Set<string>((held ?? []).map(targetKey));

  // 3. Candidate pending work due now (fetch extra to allow redundancy filtering), oldest first.
  const { data: candidates, error: candErr } = await db
    .from("work_assignment")
    .select("id, target_kind, redundancy_index, tracked_account_id, post_id")
    .eq("tenant_id", tid)
    .eq("state", "pending")
    .lte("not_before", nowIso)
    .order("not_before", { ascending: true })
    .limit(maxItems * 5 + 20);
  if (candErr) {
    log.error("candidate fetch failed", { code: candErr.code });
    return errorResponse(500, "lease_failed", "Could not read work queue.");
  }

  // 4. Pick up to maxItems, skipping any target this node already holds or has chosen this batch.
  const chosen: string[] = [];
  const chosenKeys = new Set<string>(heldKeys);
  for (const c of candidates ?? []) {
    if (chosen.length >= maxItems) break;
    const k = targetKey(c);
    if (chosenKeys.has(k)) continue;
    chosenKeys.add(k);
    chosen.push(c.id);
  }

  const leaseExpIso = new Date(Date.now() + LEASE_TTL_MS).toISOString();
  let items: unknown[] = [];

  if (chosen.length > 0) {
    // 5. Atomically claim: guard on state='pending' so concurrent leasers can't double-claim a row
    //    (Postgres re-checks the predicate under the row lock at READ COMMITTED). Only rows we truly
    //    won come back via .select().
    const { data: leased, error: leaseErr } = await db
      .from("work_assignment")
      .update({ state: "leased", node_id: node.node_id, lease_expires_at: leaseExpIso })
      .in("id", chosen)
      .eq("tenant_id", tid)
      .eq("state", "pending")
      .select(
        "id, target_kind, redundancy_index, " +
          "tracked_account:tracked_account_id(handle, external_id), post:post_id(shortcode)",
      );
    if (leaseErr) {
      log.error("claim failed", { code: leaseErr.code });
      return errorResponse(500, "lease_failed", "Could not claim work.");
    }

    type LeasedRow = {
      id: string;
      target_kind: string;
      redundancy_index: number;
      tracked_account: { handle?: string; external_id?: string } | null;
      post: { shortcode?: string } | null;
    };
    items = ((leased ?? []) as unknown as LeasedRow[]).map((a) => {
      const acct = a.tracked_account;
      const post = a.post;
      const item: Record<string, unknown> = {
        assignment_id: a.id,
        target_kind: a.target_kind,
        hint: { app_id: INSTAGRAM_APP_ID },
      };
      if (acct?.handle) item.handle = acct.handle;
      if (acct?.external_id) item.external_id = acct.external_id;
      if (post?.shortcode) item.shortcode = post.shortcode;
      return item;
    });
  }

  log.info("leased", { tenant_id: tid, node_id: node.node_id, count: items.length });
  return jsonResponse({
    lease_expires_at: leaseExpIso,
    items,
    rate: LEASE_RATE,
  });
});
