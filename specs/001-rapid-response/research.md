# Phase 0 Research: Rapid-Response Narrative Alerting

All decisions trace to the spec, the constitution, and the platform/market research conducted
during product definition. No unresolved `NEEDS CLARIFICATION` remain.

## R1. Instagram ingestion path

- **Decision**: Ingest only **Business/Creator** accounts via the **Instagram Graph API** using
  per-cadre OAuth (Facebook Login). Receive new comments via **Graph API webhooks** (comments,
  mentions) rather than polling. Store long-lived tokens encrypted in Supabase Vault; refresh
  on the ~60-day lifecycle via a `pg_cron` job.
- **Rationale**: The Instagram Basic Display API reached end-of-life (Dec 2024); personal
  accounts are no longer accessible to third-party apps. Webhooks give near-real-time comment
  delivery, which directly serves SC-001 (≤15 min) without burning rate limits on polling.
- **Alternatives rejected**: Basic Display API (dead); scraping (violates ToS + constitution
  Principles I/II + DPDP); polling-only (slower, more rate-limit pressure than webhooks).

## R2. YouTube ingestion path + quota (Principle VII gate)

- **Decision**: Poll connected channels' recent videos and their comments via **YouTube Data
  API v3** on a `pg_cron` micro-batch schedule. Comment reads cost 1 unit each; avoid the
  100-unit `search` endpoint by working from each channel's own uploads playlist. Treat the
  **quota-increase audit as a release precondition** carried into tasks.md.
- **Rationale**: Default quota is 10k units/day with no paid-quota path — only the audit form,
  which can reject data-heavy use cases. At 1k–10k channels this default is insufficient, so the
  audit must be approved before the YouTube path ships. The YouTube **Analytics** API is not
  used (it needs per-owner OAuth and gives owner-only metrics we don't require for alerting).
- **Alternatives rejected**: `search.list` polling (100×-costlier units); third-party scraping
  APIs (ToS/DPDP risk); buying quota (does not exist).
- **Contingency**: if audit is delayed, ship the wedge **Instagram-first** (webhooks need no
  quota audit) and add YouTube once approved.

## R3. Hosting platform

- **Decision**: **Supabase**, single project per party (Postgres + pgvector, Auth + RLS,
  Realtime, Storage, pgmq, pg_cron, Edge Functions), pinned to an India region.
- **Rationale**: The workload is data/analytics + vector RAG + auth + modest realtime — all
  collapse onto one Postgres. The core dedup/overlap/narrative-clustering analytics are native
  SQL; pgvector keeps embeddings in the same DB. Constitutionally pinned (§Technology).
- **Alternatives rejected**: Cloudflare (D1 ~10GB ceiling strains comment volume; edge
  distribution irrelevant for single-region India; on-platform AI advantage moot once inference
  is external); Render-only (no batteries — auth/realtime/vector all hand-built).

## R4. Ingestion compute model + escape hatch

- **Decision**: Run ingestion as **Edge Functions triggered by `pg_cron` micro-batches**
  consuming a **pgmq** queue (fetch → normalize → enqueue → analyze → persist), with retries and
  a dead-letter queue. Do **not** provision the Render worker yet.
- **Rationale**: YouTube's 10k-unit/day quota itself throttles polling, so frequent *small*
  batches stay inside Edge Function execution-time limits. This keeps the deployment to a single
  platform.
- **Alternatives rejected**: always-on Render worker from day one (premature complexity + second
  platform); single long-running Edge Function (hits execution limits).
- **Escape hatch (documented, deferred)**: if micro-batches cannot keep the board within the
  freshness window, add **one Render background worker** as the always-on pgmq drainer. This is
  the only sanctioned off-Supabase component (constitution §Technology).

## R5. LLM + embeddings

- **Decision**: All inference via **OpenRouter**. Tier 1 (bulk: per-comment sentiment, language
  detection, coarse troll-pattern features) → **Gemini 2.5 Flash-Lite**. Tier 2 (nuanced:
  anti-party theme synthesis, narrative summaries, coordination judgment) → **Gemini 2.5 Flash**,
  escalated only for ambiguous Tier-1 cases. Embeddings from a **Gemini embedding model called
  directly** (Google AI/Vertex) written into pgvector.
- **Rationale**: OpenRouter gives one key, one billing surface, provider fallback, and a unified
  request log (supports the audit trail in constitution §Security). Two-tier routing controls
  cost at thousands of accounts × many comments. OpenRouter is completion-focused, so embeddings
  use the provider endpoint directly.
- **Alternatives rejected**: on-platform inference (no longer relevant once host is Supabase);
  single-tier (cost); using OpenRouter for embeddings (limited/unsupported).

## R6. Narrative detection & coordination signal

- **Decision**: Embed comments → cluster semantically (pgvector similarity) into candidate
  narratives; score each by **volume + rate-of-growth** against Admin-tunable thresholds
  (Detection Settings). Coordination = many distinct hashed commenter IDs posting
  high-similarity text within a short time window. Hostile-vs-healthy gate uses Tier-1 sentiment
  so positive viral surges do not alert. All outputs carry a **confidence score** (Principle V).
- **Rationale**: Directly satisfies FR-002/003/004/005 and the spike-vs-healthy and
  single-critic-vs-coordination edge cases. Thresholds are global+Admin-tunable per clarify
  decision.
- **Alternatives rejected**: keyword-only detection (misses code-mixed/sarcasm, high false
  positives); per-analyst thresholds (out of scope per clarify).

## R7. Privacy, retention, residency (Principle III / DPDP)

- **Decision**: Hash commenter identifiers (keyed hash) **before** storage; never store raw
  commenter handles. Raw comment text retained **30 days**, purged by a `pg_cron` job;
  anonymized/aggregated derivatives (narratives, trends, hashed IDs) retained longer. All data
  resides in an India region.
- **Rationale**: Implements clarify decisions and constitution Principle III; detection works on
  hashed-ID patterns + timing + text similarity, so identities are unnecessary. DPDP minimize &
  anonymize posture, enforceable from 2027.
- **Alternatives rejected**: storing plaintext handles (dossier risk, constitution violation);
  indefinite retention (DPDP exposure).

## R8. Realtime board + access control

- **Decision**: Push alert inserts/updates to the dashboard via **Supabase Realtime**
  (Postgres changes). Two roles — **Admin** and **Analyst** — enforced with **row-level security**
  at the database layer; Analysts cannot reach user-management/config rows.
- **Rationale**: Realtime satisfies FR-006 (live board, no refresh) without a custom WebSocket
  server; RLS enforces FR-016 least-privilege at the data layer (defense in depth).
- **Alternatives rejected**: polling the board (latency, load); app-layer-only authz (weaker
  than DB-enforced RLS).

## Resolved unknowns summary

| Topic | Resolution |
|-------|------------|
| IG access | Graph API, Creator/Business, webhooks, OAuth |
| YT access + quota | Data API v3, uploads-playlist reads, **audit = release precondition** |
| Host | Supabase single project, India region |
| Ingestion compute | pg_cron micro-batch + pgmq; Render worker deferred |
| LLM / embeddings | OpenRouter → Gemini 2.5 Flash/Flash-Lite; direct Gemini embeddings |
| Detection | pgvector clustering + volume/growth thresholds + coordination + confidence |
| Privacy | hashed IDs, 30-day raw purge, India residency |
| Realtime + authz | Supabase Realtime + RLS (Admin/Analyst) |
