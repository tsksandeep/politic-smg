# Tasks: Opposition Narrative Intelligence

Foundation-first, mapped to the phased roadmap. `[P]` = parallelisable once the foundation
(constitution + schema + contracts) is frozen.

## Phase 0 — Foundations (tenant isolation + schema)

- [ ] T001 Constitution ratified (9 principles) — `.specify/memory/constitution.md`.
- [ ] T002 SDD artifacts — spec / plan / research / data-model / contracts / quickstart.
- [ ] T003 Schema migrations from `0001`: extensions, tenancy, capture, analytics tables.
- [ ] T004 `current_tenant()` + RLS policies on every tenant table (default deny).
- [ ] T005 pgvector columns + HNSW indexes (768-dim) — `0002_vector.sql`.
- [ ] T006 pgmq queues (`enrich_jobs`, `media_jobs`, `reconcile_jobs` + DLQs) + claim/complete RPCs.
- [ ] T007 pg_cron schedules (enrich, media-dispatch, detect, coordination, assign-work, reconcile,
      retention-purge) + service-role cron auth.
- [ ] T008 Tenant-scoped views (`narrative_board`, `alert_board`, `amplifier_targets`,
      `coordination_board`, `node_coverage`), `security_invoker = on`.
- [ ] T009 **RLS tenant-isolation property test** — cross-tenant read/write/enumerate denied (SC-001).

## Phase 1 — Node MVP (capture)

- [ ] T010 `shared/node-auth.ts` + `shared/tenant.ts` — node-token HMAC verify, tenant resolution.
- [ ] T011 `node-register` Edge Function — enrolment code → node + one-time token (hashed).
- [ ] T012 `assign-work` generator — redundant (2–3) + velocity-aware assignments (`not_before`).
- [ ] T013 `work-lease` Edge Function — rate-capped, tenant-scoped, redundancy-respecting lease.
- [ ] T014 `submit` Edge Function — normalise → post/metric/comment; author HMAC at ingest; enqueue.
- [ ] T015 `heartbeat` Edge Function — liveness/health, coverage-gap + backoff.
- [ ] T016 [P] `extension/` MV3 node client — guest session warm-up, capture, lease/submit/heartbeat.
- [ ] T017 [P] Demo seed (`demo_tenant.sql`) — two tenants, nodes, captured posts, coordination burst.

## Phase 2 — Enrichment + narrative

- [ ] T018 `shared/hash.ts`, `shared/labels.ts`, `shared/llm.ts`, `shared/embeddings.ts` (carried,
      retuned for opposition content).
- [ ] T019 `enrich` Edge Function — pgmq `enrich_jobs` → embed + classify + author-hash.
- [ ] T020 [P] `media-worker/` container — CDN fetch → OCR/ASR → `media_transcript` → discard bytes.
- [ ] T021 `detect-narratives` — cluster + LLM label (claim/framing/target) + lifecycle state.
- [ ] T022 [P] War-room narrative board + narrative detail (amplifier graph, audio/hashtag signals).

## Phase 3 — Lifecycle + coordination

- [ ] T023 `narrative_observation` writer + decay/half-life/resurgence computation.
- [ ] T024 `coordination-detect` — temporal/content/shared-audio/author-network → inferred signal.
- [ ] T025 `account_narrative_participation` amplifier ranking + origin/patient-zero.
- [ ] T026 Emerging-narrative early warning → `alert` (before peak) + `alert-triage`.
- [ ] T027 [P] War-room coordination board, amplifier targets, alert detail + triage (Realtime).

## Phase 4 — Scale + resilience

- [ ] T028 `reconcile` — redundant submission reconciliation + node-trust scoring + quarantine.
- [ ] T029 `node_coverage` scaling-law view + coverage-gap banner (graceful degradation).
- [ ] T030 [P] Reconciliation/trust + coordination + detection tests.

## Phase 5 — Multi-tenant hardening

- [ ] T031 `detection-settings` (per-tenant thresholds, Admin) + tenant admin (targets/nodes/users).
- [ ] T032 `retention-purge` — raw-text + media-url purge per tenant jurisdiction schedule.
- [ ] T033 Jurisdiction profiles (IN-DPDP shipped) + raw-identity gate (off by default).
- [ ] T034 [P] Docs: README, compliance (India profile + multi-jurisdiction), deploy, local-dev.
