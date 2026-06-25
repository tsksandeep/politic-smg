# Phase 1 Data Model: Rapid-Response Narrative Alerting

Single-tenant Supabase Postgres (one project per party). All personal data resides in an India
region. Entities below map to tables; embeddings use `pgvector`. RLS is enforced on every table.

## Conventions

- Surrogate keys are UUIDs unless noted.
- `commenter_hash` is a keyed hash of the source commenter handle, computed **before** insert;
  the raw handle is never stored.
- Timestamps are `timestamptz`.
- "raw text" columns are subject to the 30-day retention purge (R7).

## Entities

### cadre
The consenting party worker.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| display_name | text | internal label |
| status | enum(active, inactive) | |
| created_at | timestamptz | |
- Relationships: 1—N `connected_account`.

### connected_account
A consented IG (Creator/Business) or YouTube account — the **only** ingestion source.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| cadre_id | uuid (fk → cadre) | |
| platform | enum(instagram, youtube) | |
| external_id | text | platform account/channel id |
| consent_status | enum(connected, revoked) | revocation triggers purge |
| connected_at | timestamptz | |
| revoked_at | timestamptz null | |
| nango_connection_id | text | handle for the cadre's connection in Nango (tokens live in Nango, not here) |
| provider_config_key | text | Nango integration key (`instagram` / `youtube`) |
| token_ref | text null | legacy Vault reference; nullable + unused since the Nango migration (0016) |
| token_expires_at | timestamptz null | informational only; Nango auto-refreshes on read (no app-side job) |
| backfill_done | bool | 30-day backfill completed flag |
- Rules: FR-001/010/010a/011. Only `consent_status = connected` accounts are ingested.
  On revoke → stop ingestion immediately, delete the Nango connection, schedule purge.
- Tokens: never stored on this row. Nango owns storage + auto-refresh; the app reads a fresh
  access token from Nango per call via the `nango_connection_id` (Principle III minimization, R9).

### post
Content published by a connected account; the unit comments attach to.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| connected_account_id | uuid (fk) | |
| platform_post_id | text | |
| published_at | timestamptz | |
| permalink | text | |
| last_ingested_at | timestamptz | freshness tracking (FR-015) |
- Rules: only posts from connected accounts (FR-001/011); backfill bounded to last 30 days (FR-010a).

### comment
A reaction on a connected account's post. Identity stored only as a hash.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| post_id | uuid (fk) | |
| commenter_hash | text | keyed hash; raw handle never stored (FR-008) |
| body | text | **raw text — purged after 30 days** (FR-009) |
| created_at | timestamptz | source comment time |
| ingested_at | timestamptz | |
| embedding | vector | pgvector; for clustering (R6) |
| sentiment | enum(hostile, neutral, positive) | Tier-1 (R5) |
| sentiment_confidence | real | 0–1 (FR-004) |
| language | text | ta / en / mixed |
| narrative_id | uuid null (fk → narrative) | cluster assignment |
- Rules: aggregate analysis only (FR-008/009). After purge, `body` is nulled but anonymized
  fields (hash, embedding-derived cluster, sentiment) may persist.

### narrative
A clustered hostile/anti-party theme detected across comments.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| theme_summary | text | Tier-2 generated (R5) |
| centroid | vector | cluster centroid (pgvector) |
| volume | int | comment count in window |
| growth_rate | real | rate of change |
| confidence | real | 0–1 (FR-004) |
| coordination_score | real | 0–1 coordination signal (FR-003) |
| stance | enum(anti_party, pro_party) | default `anti_party`; pro_party clusters power the favourable view (delivered scope, see below) |
| first_seen_at | timestamptz | |
| last_updated_at | timestamptz | |
- Rules: FR-002/003/004. Only `anti_party` narratives raise alerts (positive surges excluded from
  alerting, FR-005); `pro_party` narratives are tracked for the favourable view but never alert.

### alert
A surfaced narrative event for the war room.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| narrative_id | uuid (fk → narrative) | |
| status | enum(open, acknowledged, closed) | |
| assignee_user_id | uuid null (fk → app_user) | |
| detected_at | timestamptz | |
| acknowledged_at | timestamptz null | |
| closed_at | timestamptz null | |
| response_note | text null | logged counter-response (FR-013) |
| affected_scope | jsonb | affected cadres/posts summary |
| response_latency | interval (generated) | stored generated column `closed_at − detected_at` (FR-014, SC-006) |
- Derived: `response_latency` is a generated column, not computed in the app.
- State transitions: `open → acknowledged → closed` (FR-013); live via Realtime (FR-006).

### app_user
Internal authorized user (war-room).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | maps to Supabase Auth user |
| role | enum(admin, analyst) | FR-016 |
| created_at | timestamptz | |
- Rules: Analyst cannot access user-management/config rows (RLS, R8).

### detection_settings
Global, Admin-tunable thresholds (singleton-ish, one active row).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| min_volume | int | spike volume threshold |
| min_growth_rate | real | spike growth threshold |
| coordination_window | interval | similarity time window |
| coordination_min_accounts | int | distinct hashed IDs for coordination |
| updated_by | uuid (fk → app_user) | Admin only |
| updated_at | timestamptz | |
- Rules: FR-005; editable by Admin only (clarify decision).

### Supporting (operational, not domain)
- **pgmq queues**: `ingest_jobs`, `analyze_jobs` (+ DLQs) — R4.
- **pg_cron jobs**: `analyze-comments`, `detect-narratives`, `ingest-youtube`, `retention-purge`.
  (No `token-refresh` job — Nango auto-refreshes tokens; R9.)
- **Storage bucket**: `raw-payloads` — archived API responses (also under retention).
- **app_config**: service-role-only key/value (e.g. local Nango secret); not domain data.

## Delivered views beyond the core wedge (Phase-2 analytics slice)

These ship alongside the rapid-response wedge and are derived (read-only, RLS via
`security_invoker`) — no new write paths. They are an early slice of Phase-2 performance
analytics, documented here so the schema and code stay in step.

- **`alert_board`**: open/acknowledged anti-party alerts ⋈ narrative, with `data_fresh_as_of`
  (FR-015). The primary war-room surface (US1).
- **`narrative_board`**: all narratives (both stances) with `performance_score = volume ×
  max(growth_rate, 0)` — powers the favourable (pro-party) ranking.
- **`cadre_coverage`**: per-cadre positive / negative / neutral / total comment counts.
- **`cadre_narrative`**, **`cadre_comment`**: anonymized drill-downs for the cadre and narrative
  detail pages (no `commenter_hash` exposed — Principle III).

## Entity relationships

```text
cadre 1—N connected_account 1—N post 1—N comment N—1 narrative 1—N alert
app_user 1—N alert (assignee)        app_user 1—1 detection_settings (updated_by)
```

## Retention & lifecycle rules (cross-cutting)

- `comment.body` and `raw-payloads` objects: deleted 30 days after ingestion (FR-009, R7).
- On `connected_account.consent_status = revoked`: stop ingestion immediately; purge that
  account's posts/comments/raw payloads on the documented schedule (FR-010).
- All tables: RLS on; Analyst role read-restricted to alert/narrative/board data, no
  user/settings write (FR-016, R8).
