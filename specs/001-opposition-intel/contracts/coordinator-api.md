# Contract: Coordinator API (node ⇄ coordinator)

The coordinator is a set of Supabase Edge Functions. **Nodes** authenticate with a tenant-scoped
node token (`Authorization: Bearer <node_token>`), never a user session (Principle II/IV). The token
maps to exactly one `node` and therefore one `tenant`; all reads/writes are RLS-scoped to that
tenant. `verify_jwt = false` for these functions (nodes have no Supabase JWT); each function verifies
the node token itself by HMAC-matching `node.token_hash`.

All requests/responses are JSON. Errors: `{ "error": "<code>", "message": "<text>" }` with an
appropriate HTTP status. A revoked or quarantined node receives `403 node_revoked` /
`403 node_quarantined`.

---

## POST /node-register
First-run registration. Called once with a **tenant enrolment code** (issued by a tenant Admin),
not a node token. Returns the node token **once** (stored only as a hash thereafter).

Request:
```json
{ "enrolment_code": "string", "label": "operator-chosen name" }
```
Response `201`:
```json
{ "node_id": "uuid", "node_token": "shown once — store securely", "tenant_id": "uuid",
  "rate": { "max_requests_per_day": 100, "min_interval_ms": 600, "jitter_ms": 400 } }
```
Rules: enrolment code resolves to a tenant; the node is created `active` with `trust_score = 0.5`.
The raw token is never persisted (only `token_hash`). Invalid/expired code → `403 invalid_enrolment`.

---

## POST /work-lease
Lease a small, rate-capped batch of work for this node's tenant (FR-004). The coordinator picks
`pending` assignments honouring redundancy (a node never gets two redundancy copies of the same
item) and velocity cadence (`not_before <= now`), prioritising fresh + accelerating posts (FR-006).

Request:
```json
{ "max_items": 10 }
```
Response `200`:
```json
{ "lease_expires_at": "ISO-8601",
  "items": [
    { "assignment_id": "uuid", "target_kind": "account|post_metrics|comments",
      "handle": "publichandle", "external_id": "optional", "shortcode": "optional",
      "hint": { "app_id": "936619743392459" } }
  ],
  "rate": { "min_interval_ms": 600, "jitter_ms": 400 } }
```
Rules: items are scoped to the node's tenant only (FR-002); each item is marked `leased` with a
`lease_expires_at`; expired leases return to `pending` for re-assignment (covers a burned-IP node).
Empty list when no work is due — node should back off and heartbeat.

---

## POST /submit
Submit captured public data for a leased assignment (FR-005). Payload is already normalised and
**contains no raw media bytes and no raw commenter handles** — the node hashes comment authors
locally is NOT required (the coordinator hashes at ingest via the tenant hash key); the node sends
public handles only for posts/mentions, and comment author handles which the coordinator immediately
HMACs and discards (Principle III).

Request (account capture):
```json
{ "assignment_id": "uuid", "captured_at": "ISO-8601",
  "account": { "external_id": "123", "followers": 12345, "following": 67, "posts_count": 440,
               "is_private": false },
  "posts": [
    { "shortcode": "abc", "is_video": true, "caption": "text",
      "audio_id": "9988", "taken_at": "ISO-8601", "permalink": "https://…",
      "like_count": 1200, "comment_count": 88, "view_count": 50000, "media_url": "https://cdn…" }
  ] }
```
Request (comments capture):
```json
{ "assignment_id": "uuid", "captured_at": "ISO-8601", "post_shortcode": "abc",
  "comments": [ { "author_handle": "raw — hashed+discarded server-side", "text": "…",
                  "created_at": "ISO-8601" } ] }
```
Response `200`: `{ "accepted": true, "submission_id": "uuid", "deduped": 3 }`
Rules: the coordinator writes a `submission` row, normalises into `post` / `post_metric_sample` /
`comment` (author HMAC-hashed at ingest, raw discarded unless `raw_identity_enabled`), enqueues
`enrich_jobs` and (for posts with `media_url`) `media_jobs`, then marks the assignment `submitted`.
`media_url` is stored transiently and cleared once the media worker emits a transcript. If a private
account is reported, the `tracked_account` is flagged `is_private` and dropped from capture
(Principle II). A node submitting for an assignment it does not hold → `403 not_your_lease`.

---

## POST /heartbeat
Liveness + health (FR-015). Sent on an interval whether or not work is leased.

Request:
```json
{ "ok_count": 12, "error_count": 1, "ip_status": "healthy|throttled|blocked" }
```
Response `200`: `{ "node_status": "active|quarantined", "backoff_ms": 0 }`
Rules: updates `node.last_seen_at`, writes a `node_heartbeat`. A `blocked` ip_status feeds the
coverage-gap view and returns a `backoff_ms`. A node whose trust has decayed below threshold is told
`quarantined` and stops being leased work.

---

## Reconciliation & trust (internal, not node-facing)

`reconcile-submissions` (pg_cron) compares redundant `submission` rows for the same logical target:
agreement → accept the value, bump contributing nodes' `trust_score`; divergence → mark `diverged`,
flag the outlier, decay its trust; sustained low trust → `node.status = quarantined` (FR-014,
Principle VII). The accepted, reconciled value is what lands in `post` / `post_metric_sample`.
