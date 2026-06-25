# Contract: Ingestion & Detection (internal)

Internal interfaces — not exposed to dashboard users. Implements FR-001/002/003/005/008/009/015.

## Instagram comment webhook  →  POST /ig-webhook
- **Caller**: Instagram Graph API webhook (comments/mentions on connected accounts).
- **Verify**: signature + subscription challenge per platform spec.
- **Behavior**: resolve `connected_account` (must be `connected`); upsert `post`; for each new
  comment, **hash the commenter handle before insert** (FR-008), store `body` (30-day TTL),
  enqueue `analyze_jobs` (pgmq).
- **2xx** fast ack; processing is async (R4).
- Ignores payloads for accounts not in `connected` state (FR-011).

## YouTube polling job  (pg_cron → ingest-youtube)
- **Trigger**: `pg_cron` micro-batch (cadence tuned to stay within 10k units/day, R2).
- **Behavior**: for a batch of connected channels, read recent uploads + their comments via the
  uploads playlist (avoid `search`); hash commenter ids; upsert posts/comments; enqueue
  `analyze_jobs`. Records `last_ingested_at` for freshness (FR-015).
- **Quota guard**: stop the batch when the daily unit budget is exhausted; resume next cycle
  (graceful degradation — delayed, not lost; edge case "platform throttling").

## analyze-comments  (pgmq consumer → OpenRouter/Gemini)
- **Input**: `analyze_jobs` messages (comment ids).
- **Behavior**: Tier-1 classify (Flash-Lite): sentiment + language + troll features; compute
  embedding (Gemini embedding model) → pgvector. Escalate ambiguous to Tier-2 (Flash). All
  scores stored with confidence (FR-004).

## detect-narratives  (pg_cron)
- **Behavior**: cluster recent hostile comments by embedding similarity; compute
  volume/growth/coordination; compare to `detection_settings`; create or update `narrative`
  rows; raise/refresh `alert` when thresholds crossed (FR-002/003/005). Excludes positive/neutral
  surges (FR-005, edge case "healthy spike"). On revoked-account data drop, recompute affected
  narratives (edge case "consent revoked mid-incident").

## token refresh — delegated to Nango (no app job)
- There is no `token-refresh` Edge Function or cron. Ingestion reads a fresh access token from
  **Nango** per run via the account's `nango_connection_id`; Nango handles the ~60-day IG
  lifecycle and refresh on read (R9).

## retention-purge  (pg_cron)
- Daily: null/delete `comment.body` and `raw-payloads` objects older than 30 days; purge data for
  revoked accounts (FR-009, FR-010, R7).

### Release precondition (Principle VII)
The **YouTube Data API quota-increase audit MUST be approved** before the YouTube polling job is
enabled in any party deployment. If pending, ship Instagram-first (webhooks need no audit).
