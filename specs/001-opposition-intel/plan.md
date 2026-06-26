# Implementation Plan: Opposition Narrative Intelligence

**Branch**: `001-opposition-intel` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-opposition-intel/spec.md`

## Summary

A multi-tenant intelligence platform where each tenant (a political organisation) measures the
**public** Instagram narrative output of its opposition's cadre. Ingestion is public-data scraping
distributed across the tenant's own volunteer node network — Manifest-V3 browser extensions on
residential IPs that lease work, capture public data via a warm logged-out guest session, and submit
to a coordinator. The coordinator (Supabase Edge Functions + Postgres) redundantly assigns work,
reconciles submissions, scores node trust, and normalises captures into a shared-schema multi-tenant
Postgres (RLS-isolated by `tenant_id`). Captions/transcripts are embedded (pgvector) and clustered
into labelled narratives; metrics are multi-sampled for lifecycle/decay; coordination is inferred by
fusing temporal/content/shared-audio/author-hash signals; amplifiers are ranked; emerging narratives
raise early-warning alerts on a live React war-room. Comment authors are HMAC-hashed at ingest and
raw media is transcribed-then-discarded.

## Technical Context

**Language/Version**: TypeScript on Deno (Supabase Edge Functions + coordinator); SQL (PostgreSQL
15+); TypeScript + React for the war-room; TypeScript for the MV3 extension; Python (or Node) for the
media worker.

**Primary Dependencies**: Supabase (Postgres, Auth, Realtime, Storage, Edge Functions), `pgvector`,
`pgmq`, `pg_cron`; OpenRouter API (Gemini 2.5 Flash / Flash-Lite); a Gemini embedding model (768-dim,
region per tenant); Gemini multimodal or self-hosted Whisper for OCR/ASR; an MV3 browser extension
runtime.

**Storage**: Supabase Postgres (relational + pgvector). Raw media is **never** warehoused; only
derived transcript text is stored.

**Testing**: pgTAP / Deno tests for schema, RLS tenant-isolation property, coordinator reconciliation
& trust, detection & coordination; Vitest + Playwright for the war-room.

**Target Platform**: Supabase managed cloud; region pinned per tenant jurisdiction profile (India
region for the launch IN-DPDP profile). War-room runs in evergreen browsers; node extension on
Chromium/Firefox (self-hosted enterprise install).

**Project Type**: multi-surface — Supabase backend (coordinator + enrichment + analytics), MV3 node
extension, media-worker container, React war-room.

**Performance Goals**: emerging narrative surfaces before peak (SC-003); throughput ≈ `nodes ×
safe-requests/node/day`, graceful degradation (SC-002); board never silently stale (SC-007).

**Constraints**: public-data-only logged-out capture (no login, ever); IP reputation is the physical
ceiling (mitigated by node count + warm-cookie/cheap-poll two-tier); per-node rate caps + jitter;
raw-text retention default 30 days; no raw-media warehousing; tenant isolation enforced in the DB.

**Scale/Scope**: per-tenant throughput is a function of node count (≈100 safe requests/node/day);
multiple isolated tenants on one shared-schema deployment; Tamil/English/code-mixed content.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Gate | Initial | Post-Design |
|---|-----------|------|---------|-------------|
| I | Multi-Tenant Isolation | `tenant_id` + RLS on every row; cross-tenant denied; tested as a property | ✅ PASS | ✅ PASS |
| II | Public-Data-Only | Logged-out guest session; never log in; private gates out of bounds | ✅ PASS | ✅ PASS |
| III | Data Minimisation & No-Warehousing | Author HMAC at ingest; raw media transcribed-then-discarded; raw-text TTL | ✅ PASS | ✅ PASS |
| IV | Volunteer-Node Safety | Isolated guest cookie jar; capped/jittered; one-way egress | ✅ PASS | ✅ PASS |
| V | Honest Signals | All probabilistic outputs labelled signal/estimate; coordination inferred | ✅ PASS | ✅ PASS |
| VI | Adversarial Robustness | Redundant nodes; randomised sampling; never trust one sensor | ✅ PASS | ✅ PASS |
| VII | Data-Integrity / Anti-Poisoning | 2–3 node redundancy + reconciliation + trust scoring | ✅ PASS | ✅ PASS |
| VIII | Jurisdiction-Aware Compliance | Per-tenant profile; India/DPDP at launch; risk documented | ✅ PASS | ✅ PASS |
| IX | Platform & Anti-Bot Resilience | Graceful degradation; visible coverage gaps; never silent under-report | ✅ PASS | ✅ PASS |

**Result**: No violations. The legal bet rests entirely on Principles II + III; both are architectural
and on by default. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-opposition-intel/
├── plan.md              # This file
├── spec.md              # Requirements & user stories
├── research.md          # Phase 0 — capture path, IP strategy, isolation, coordination
├── data-model.md        # Phase 1 — multi-tenant schema
├── quickstart.md        # Phase 1 — local stack + demo seed
├── contracts/           # coordinator-api.md, realtime.md
└── tasks.md             # Phase 2 — ordered tasks
```

### Source Code (repository root)

```text
backend/
├── supabase/
│   ├── migrations/            # multi-tenant schema, pgvector, RLS, pgmq, pg_cron, views, detection
│   ├── functions/             # Edge Functions (Deno/TypeScript)
│   │   ├── node-register/      # tenant-scoped node enrolment → node token (hashed)
│   │   ├── work-lease/         # rate-capped, redundancy- & velocity-aware assignment
│   │   ├── submit/             # normalise capture → posts/metrics/comments; hash authors; enqueue
│   │   ├── heartbeat/          # node liveness/health; coverage-gap + backoff
│   │   ├── enrich/             # pgmq enrich_jobs → embed + classify + author-hash
│   │   ├── detect-narratives/  # cluster + label + lifecycle + emerging-narrative early warning
│   │   ├── coordination-detect/# temporal/content/shared-audio/author-network signals (inferred)
│   │   ├── assign-work/        # velocity-aware redundant assignment generator (pg_cron)
│   │   ├── reconcile/          # redundant submission reconciliation + node-trust scoring
│   │   ├── alert-triage/       # acknowledge/assign/annotate/close (user JWT, RLS)
│   │   ├── detection-settings/ # per-tenant tunable thresholds (Admin)
│   │   └── retention-purge/    # raw-text + media-url purge per tenant schedule
│   ├── tests/                 # RLS isolation property, reconciliation/trust, detection, enrich
│   └── shared/                # db, llm, embeddings, hash, labels, log, node-auth, tenant
└── media-worker/             # always-on container: fetch CDN media → OCR/ASR → transcript → discard

extension/                    # MV3 node client (TypeScript): guest session, lease/submit/heartbeat

frontend/
└── src/
    ├── pages/                # narrative board, narrative detail, coordination board, amplifiers,
    │                          #   node coverage, alert detail, admin (targets/nodes/settings)
    ├── components/           # narrative card, decay chart, coordination card, confidence badge,
    │                          #   coverage gauge, freshness banner
    └── services/             # Supabase client, Realtime subscriptions, tenant/role guards
```

**Structure Decision**: Four coordinated surfaces around one shared-schema Supabase backend: the
coordinator/enrichment/analytics Edge Functions + SQL, the MV3 node extension (the only component
that touches the target platform, and only logged-out), the media-worker container (the one job Edge
Functions cannot do — headless media fetch + OCR/ASR), and the React war-room. Tenant isolation is a
database property (RLS), not an application convention.

## Complexity Tracking

> No constitutional violations to justify. Section intentionally empty.
