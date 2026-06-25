# Implementation Plan: Rapid-Response Narrative Alerting

**Branch**: `001-rapid-response` | **Date**: 2026-06-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-rapid-response/spec.md`

## Summary

Detect rising anti-party narratives and coordinated trolling in the comment sections of
*consented* cadre posts, and surface them on a live war-room board within 15 minutes so the
party can mobilize a counter-response. Technical approach: a single-tenant Supabase project
(Postgres + pgvector, Auth + RLS, Realtime, Storage, pgmq + pg_cron, Edge Functions) ingests
posts/comments via consented OAuth (Instagram Graph API webhooks + YouTube Data API polling),
classifies comments through OpenRouter → Gemini 2.5 Flash (Flash-Lite bulk, Flash nuanced),
clusters them into narratives in Postgres, and streams alerts to a React dashboard via
Supabase Realtime. Commenter identities are hashed; raw text is purged after 30 days.

## Technical Context

**Language/Version**: TypeScript on Deno (Supabase Edge Functions); SQL (PostgreSQL 15+);
TypeScript + React for the dashboard.

**Primary Dependencies**: Supabase (Postgres, Auth, Realtime, Storage, Edge Functions),
`pgvector`, `pgmq`, `pg_cron`; OpenRouter API (Gemini 2.5 Flash / Flash-Lite); a Gemini
embedding model (direct Google AI/Vertex call); Instagram Graph API; YouTube Data API v3.

**Storage**: Supabase Postgres (relational + pgvector); Supabase Storage (raw API payload
archive). No separate vector store.

**Testing**: pgTAP for schema/RLS/SQL logic; Deno test for Edge Functions; Vitest for frontend
units; Playwright for dashboard end-to-end.

**Target Platform**: Supabase managed cloud pinned to an **India region**; dashboard runs in
modern evergreen browsers.

**Project Type**: web (frontend dashboard + Supabase backend/edge functions).

**Performance Goals**: alert surfaces ≤15 min after a burst begins (SC-001); board reflects new
comments within the platform freshness window (SC-007); alert detail comprehensible ≤30s (SC-002).

**Constraints**: YouTube Data API default 10k quota units/day (audit-only increase, no paid
path); Instagram long-lived token ~60-day refresh lifecycle; raw comment text retention = 30
days; 30-day backfill on connect; Edge Function execution-time limits; India data residency.

**Scale/Scope**: ~1k–10k connected accounts, single party / single tenant; Tamil, English, and
Tamil–English code-mixed comments.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Gate | Initial | Post-Design |
|---|-----------|------|---------|-------------|
| I | Consent-Only Data | Ingestion only via OAuth grant; revocation purges; no scraping | ✅ PASS | ✅ PASS |
| II | Own-Content Boundary | Comments only on connected cadres' own posts | ✅ PASS | ✅ PASS |
| III | Privacy by Minimization | Hashed commenter IDs; 30-day raw purge; aggregate analysis; India region; no dossiers | ✅ PASS | ✅ PASS |
| IV | Observability, Not Control | Detect & flag only; no block/gate features | ✅ PASS | ✅ PASS |
| V | Honest Signals | All probabilistic outputs carry confidence/estimate labels | ✅ PASS | ✅ PASS |
| VI | Single-Tenant Isolation | One Supabase project; isolated data/auth/secrets | ✅ PASS | ✅ PASS |
| VII | Platform-Dependency Discipline | **YouTube quota-increase audit validated before dependent build**; rate limits/token lifecycle/contingency documented | ⚠️ GATE | ✅ PASS (documented; audit tracked as release precondition) |

**Result**: No violations. Principle VII is satisfied by *documenting* the dependency and rate
limits in `research.md`; the actual Google audit approval is a **release precondition** carried
into `tasks.md`, not a design violation. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-rapid-response/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API + webhook + realtime contracts)
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
backend/
└── supabase/
    ├── migrations/             # schema, pgvector, RLS policies, pgmq queues, pg_cron jobs
    ├── functions/              # Edge Functions (Deno/TypeScript)
    │   ├── oauth-start/         # begin cadre consent (IG/YT)
    │   ├── oauth-callback/      # exchange code, store token in Vault, register account
    │   ├── ingest-youtube/      # pg_cron-driven polling of connected YT channels
    │   ├── ig-webhook/          # Instagram comment/mention webhook receiver
    │   ├── analyze-comments/    # pgmq consumer → OpenRouter (Gemini) classification
    │   ├── detect-narratives/   # cluster + threshold → raise/update alerts
    │   ├── token-refresh/       # pg_cron IG long-lived token refresh
    │   └── retention-purge/     # pg_cron 30-day raw-text deletion
    ├── tests/                  # pgTAP (schema/RLS), Deno tests (functions)
    └── shared/                 # shared TS types, hashing + label utilities

frontend/
├── src/
│   ├── pages/                  # war-room board, alert-detail, admin, cadre-onboarding
│   ├── components/             # alert card, narrative summary, confidence badge, freshness banner
│   └── services/               # Supabase client, Realtime subscriptions, auth/role guards
└── tests/                      # Vitest units, Playwright e2e
```

**Structure Decision**: Web application split — a Supabase backend (all server logic as SQL +
Deno Edge Functions, no separate API server) and a React frontend dashboard. This matches the
constitutionally pinned stack (§Technology Constraints) and keeps the single-tenant deployment
to one Supabase project plus a static frontend. The Render background-worker escape hatch is
intentionally *not* in the structure; it is added only if Edge Function limits prove
insufficient (tracked in research.md).

## Complexity Tracking

> No constitutional violations to justify. Section intentionally empty.
