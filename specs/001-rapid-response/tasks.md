---
description: "Task list for Rapid-Response Narrative Alerting"
---

# Tasks: Rapid-Response Narrative Alerting

**Input**: Design documents from `specs/001-rapid-response/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included (proportionate) — plan.md defines a test stack (pgTAP / Deno test / Playwright)
and quickstart.md defines validation scenarios V1–V5.

**Organization**: Grouped by user story (wedge-first: US1 P1 → US2 P2 → US3 P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 (story-phase tasks only)
- Web-app paths: `backend/supabase/...`, `frontend/src/...`

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create repo structure (`backend/supabase/`, `frontend/`) per plan.md
- [x] T002 [P] Initialize Supabase project config pinned to an India region; enable `pgvector`, `pgmq`, `pg_cron` in `backend/supabase/config.toml`
- [x] T003 [P] Scaffold React + TypeScript + Vite app with Supabase client in `frontend/`
- [x] T004 [P] Configure linting/formatting (Deno fmt/lint for functions; ESLint/Prettier for frontend) in repo root config files
- [x] T005 [P] Configure secrets (no secrets in code): OpenRouter, Vertex embeddings SA, `NANGO_HOST`/`NANGO_SECRET_KEY`, Instagram webhook secret; platform OAuth *client* creds live inside Nango; service-role key in Supabase Vault for cron — document in `docs/secrets.md`
- [ ] T006 [GATE] Submit and track the YouTube Data API quota-increase audit (release precondition, Principle VII) in `docs/quota-audit.md` — BLOCKED on external Google audit; code gate enforced (YT_INGEST_ENABLED)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T007 Create base schema migration for all entities (cadre, connected_account, post, comment, narrative, alert, app_user, detection_settings) in `backend/supabase/migrations/0001_schema.sql`
- [x] T008 Add pgvector columns + similarity indexes (comment.embedding, narrative.centroid) in `backend/supabase/migrations/0002_vector.sql`
- [x] T009 [P] Implement RLS policies for admin/analyst on all tables in `backend/supabase/migrations/0003_rls.sql`
- [x] T010 [P] Configure Supabase Auth and app_user role mapping (admin/analyst) in `backend/supabase/migrations/0004_auth_roles.sql`
- [x] T011 [P] Create pgmq queues (`ingest_jobs`, `analyze_jobs`, + DLQs) in `backend/supabase/migrations/0005_queues.sql`
- [x] T012 [P] Scaffold pg_cron job registrations in `backend/supabase/migrations/0006_cron.sql`
- [x] T013 [P] Implement keyed commenter-hash utility (hash before insert) in `backend/supabase/shared/hash.ts`
- [x] T014 [P] Implement OpenRouter→Gemini client (Flash / Flash-Lite routing) in `backend/supabase/shared/llm.ts`
- [x] T015 [P] Implement Gemini embedding client in `backend/supabase/shared/embeddings.ts`
- [x] T016 [P] Implement honest-signal label helpers (confidence/estimate formatting, Principle V) in `backend/supabase/shared/labels.ts`
- [x] T017 Configure structured logging + error-handling baseline for Edge Functions in `backend/supabase/shared/log.ts`

**Checkpoint**: Foundation ready — user stories can begin.

---

## Phase 3: User Story 1 - War room sees a rising anti-party narrative early (Priority: P1) 🎯 MVP

**Goal**: Hostile/coordinated bursts on connected posts surface as live, anonymized,
confidence-labeled alerts on the war-room board within ~15 minutes.

**Independent Test**: With pre-connected test accounts, inject a hostile burst → alert appears
on the board within the window; inject a positive surge → no alert.

### Tests for User Story 1

- [x] T018 [P] [US1] pgTAP test: RLS denies analyst write to detection_settings in `backend/supabase/tests/rls_settings_test.sql`
- [x] T019 [P] [US1] Integration test: hostile burst → alert within window in `backend/supabase/tests/detect_alert_test.ts`
- [x] T020 [P] [US1] Integration test: positive surge → no alert (healthy-spike exclusion) in `backend/supabase/tests/healthy_spike_test.ts`
- [x] T021 [P] [US1] Contract test: GET /alerts and /alerts/{id} include confidence and never expose commenter identity in `backend/supabase/tests/warroom_api_test.ts`
- [x] T021a [P] [US1] Store-side test: ingestion persists only `commenter_hash`, never the raw commenter handle (FR-008, Principle III) in `backend/supabase/tests/anonymization_test.ts`

### Implementation for User Story 1

- [x] T022 [US1] Implement Instagram comment webhook receiver (verify signature, hash before insert, enqueue analyze) in `backend/supabase/functions/ig-webhook/index.ts`
- [x] T023 [US1] Implement YouTube polling job (uploads playlist, quota guard, graceful degradation) in `backend/supabase/functions/ingest-youtube/index.ts` (gated by T006)
- [x] T024 [US1] Implement analyze-comments consumer (Tier-1 sentiment/language + embedding, Tier-2 escalation, store confidence) in `backend/supabase/functions/analyze-comments/index.ts` (depends T013, T014, T015)
- [x] T025 [US1] Implement detect-narratives (cluster by embedding, volume/growth + coordination scoring, exclude positive surges, write confidence) in `backend/supabase/functions/detect-narratives/index.ts` (depends T024)
- [x] T026 [US1] Implement detection_settings read + admin-only tune (PUT) in `backend/supabase/functions/detection-settings/index.ts`
- [x] T027 [US1] Create war-room alerts board view (PostgREST view honoring RLS, with data_fresh_as_of) in `backend/supabase/migrations/0007_alerts_view.sql`
- [x] T028 [US1] Implement GET /alerts/{id} detail (anonymized example comments + signal-not-verdict labels) in `backend/supabase/functions/alert-detail/index.ts`
- [x] T029 [P] [US1] Build war-room board page with Supabase Realtime subscription in `frontend/src/pages/Board.tsx`
- [x] T030 [P] [US1] Build alert-detail view + ConfidenceBadge + freshness banner in `frontend/src/pages/AlertDetail.tsx` and `frontend/src/components/`
- [x] T031 [US1] Wire freshness (data_fresh_as_of) indicators across the board (FR-015) in `frontend/src/components/FreshnessBanner.tsx`

**Checkpoint**: US1 fully functional and demoable on pre-connected accounts (the wedge MVP).

---

## Phase 4: User Story 2 - A cadre connects their account by consent (Priority: P2)

**Goal**: Cadres self-onboard via OAuth; posts + comments flow in (30-day backfill); revocation
stops ingestion and purges data.

**Independent Test**: Complete consent for one account → data appears; revoke → ingestion stops;
try a personal account → guided, no data collected.

### Tests for User Story 2

- [x] T032 [P] [US2] Integration test: connect → ingest; revoke → stop + purge in `backend/supabase/tests/onboarding_test.ts`
- [x] T033 [P] [US2] Integration test: unsupported (personal) account → guidance, no data collected in `backend/supabase/tests/unsupported_account_test.ts`

### Implementation for User Story 2

- [x] T034 [US2] Implement POST /oauth-start in `backend/supabase/functions/oauth-start/index.ts`
- [x] T035 [US2] Implement POST /oauth-callback (record Nango connection, resolve supported account, create connected_account, kick backfill, reject unsupported type) in `backend/supabase/functions/oauth-callback/index.ts` (depends T005)
- [x] T036 [US2] Implement 30-day backfill job (FR-010a) in `backend/supabase/functions/backfill/index.ts`
- [x] T037 [US2] Implement POST /accounts/{id}/revoke + purge scheduling (FR-010) in `backend/supabase/functions/account-revoke/index.ts`
- [x] T037a [US2] On revoke, recompute affected narratives/alerts so a revoked account's data drops out mid-incident (edge case "consent revoked mid-incident"; depends T025, T037) in `backend/supabase/functions/detect-narratives/index.ts`
- [x] ~~T038 [US2] Implement token-refresh pg_cron function (~60-day IG lifecycle)~~ — **superseded** by the Nango migration (`0016_nango.sql`): Nango owns token storage + auto-refresh, so there is no `token-refresh` function or cron in the app (R9).
- [x] T039 [US2] Implement GET /accounts in `backend/supabase/functions/accounts/index.ts`
- [x] T040 [P] [US2] Build cadre onboarding UI (connect/disconnect, unsupported-type guidance) in `frontend/src/pages/Onboarding.tsx`

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 - Analyst triages an alert and records the response (Priority: P3)

**Goal**: Analysts acknowledge/assign/close alerts with live updates; detection→response latency
is recorded.

**Independent Test**: Acknowledge + assign an alert → live status change; close with a note →
latency recorded.

### Tests for User Story 3

- [x] T041 [P] [US3] Integration test: acknowledge/assign broadcasts live; close → latency recorded in `backend/supabase/tests/triage_test.ts`

### Implementation for User Story 3

- [x] T042 [US3] Implement PATCH /alerts/{id} triage (status/assignee/response_note, set acknowledged_at/closed_at) in `backend/supabase/functions/alert-triage/index.ts`
- [x] T043 [US3] Add response_latency derivation + supporting index (FR-014, SC-006) in `backend/supabase/migrations/0009_triage.sql`
- [x] T044 [P] [US3] Build triage controls + live status in `frontend/src/pages/AlertDetail.tsx` (extend)

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T045 Implement retention-purge pg_cron (30-day raw-text deletion + revoked-account purge, FR-009 / Principle III) in `backend/supabase/functions/retention-purge/index.ts` — **LAUNCH-BLOCKING**
- [x] T046 [P] Verify India data residency and document DPDP retention + lawful-basis in `docs/compliance.md`
- [ ] T047 Confirm the YouTube quota audit is approved before enabling ingest-youtube in production (closes T006 gate) — update `docs/quota-audit.md` — BLOCKED on external Google audit; code gate enforced (YT_INGEST_ENABLED)
- [x] T048 [P] Performance pass: confirm alerts surface ≤15 min under representative load (SC-001) — record in `docs/perf.md`
- [x] T049 [P] Documentation updates and cross-links in `docs/` and `README.md`
- [x] T050 Run quickstart.md validation scenarios V1–V5 and record results in `docs/acceptance.md`

---

## Phase 7: Delivered Extensions (beyond the core 001 spec)

Shipped alongside the wedge and reflected in `spec.md` (§Delivered beyond the core wedge),
`data-model.md`, and `research.md` R9. Listed here so the ledger matches the codebase.

- [x] T051 Migrate per-cadre OAuth + token storage from Supabase Vault to a self-hosted **Nango** instance: `nango_connection_id`/`provider_config_key` on `connected_account`, drop Vault token functions, remove the `token-refresh` cron, add `app_config` in `backend/supabase/migrations/0016_nango.sql` + `backend/supabase/shared/nango.ts` (R9). Frontend uses the Nango connect SDK in `frontend/src/pages/Onboarding.tsx`.
- [x] T052 Add **favourable (pro-party) narratives**: `narrative.stance` enum + dual-stance clustering (anti-party alerts only; pro-party tracked, never alerted) in `backend/supabase/migrations/0012_favourable_and_coverage.sql`; `narrative_board` view with `performance_score`.
- [x] T053 Add **cadre coverage + drill-downs**: `cadre_coverage` view (0012) and anonymized `cadre_narrative` / `cadre_comment` views in `backend/supabase/migrations/0013_detail_views.sql`; `frontend/src/pages/{Board,CadreDetail,NarrativeDetail}.tsx` (Recharts coverage/donut).
- [x] T054 Queue-based analysis pipeline hardening: `enqueue/reconcile/claim/complete/fail` pgmq wrappers with poison-message DLQ cap in `backend/supabase/migrations/0014_analyze_queue.sql`.

> Scope note (CPO): these are an early, low-cost slice of the Phase-2 performance-analytics
> roadmap (README §11). They reuse the same consented dataset and add no new write paths or
> citizen-identifying data, so they stay inside the constitution. Full Phase-2 (unique engaged
> audience, cadre-overlap maps) remains a separate future feature.

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: no dependencies. T006 (quota audit) starts immediately and runs in the background.
- **Foundational (Phase 2)**: depends on Setup; **blocks all user stories**.
- **User Stories (Phase 3–5)**: depend on Foundational. Then independently testable; preferred order P1 → P2 → P3.
- **Polish (Phase 6)**: depends on the targeted stories. T045 is launch-blocking; T047 gates YouTube in production.

### User Story Dependencies
- **US1 (P1)**: after Foundational. Demoable on pre-connected accounts (no dependency on US2's self-service onboarding).
- **US2 (P2)**: after Foundational. Adds self-service consent on top of the shared schema; independently testable.
- **US3 (P3)**: after Foundational. Extends alert lifecycle; independently testable.

### Within Each Story
- Tests written and failing before implementation.
- Migrations/models → Edge Functions → frontend.
- US1 ingestion (T022/T023) → analyze (T024) → detect (T025) → board (T027–T031).

### Notable cross-cutting
- T006/T047 (YouTube quota audit): if pending, ship **Instagram-first** — T022 + analyze/detect/board path needs no audit.
- T045 (retention-purge): must be live before any real cadre data is ingested in production.

---

## Parallel Opportunities

- Setup: T002, T003, T004, T005 in parallel (T006 runs alongside as a background gate).
- Foundational: T009–T016 in parallel after T007/T008.
- US1 tests T018–T021 in parallel; frontend T029/T030 in parallel with backend wiring.
- Once Foundational completes, US1/US2/US3 can be staffed in parallel by different developers.

### Parallel Example: User Story 1

```bash
# Tests together:
Task: "pgTAP RLS test in backend/supabase/tests/rls_settings_test.sql"
Task: "Integration hostile-burst test in backend/supabase/tests/detect_alert_test.ts"
Task: "Integration healthy-spike test in backend/supabase/tests/healthy_spike_test.ts"
Task: "Contract test in backend/supabase/tests/warroom_api_test.ts"

# Frontend in parallel:
Task: "Board page in frontend/src/pages/Board.tsx"
Task: "Alert detail + ConfidenceBadge in frontend/src/pages/AlertDetail.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)
1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → 4. **STOP & VALIDATE** (quickstart V1) → 5. Demo the wedge.
   - If the quota audit (T006) is still pending, demo Instagram-first.

### Incremental Delivery
- Setup + Foundational → US1 (MVP, demo) → US2 (self-service onboarding) → US3 (triage + latency metric).
- Each story is independently testable and adds value without breaking prior stories.

### Launch gates (must close before production with real data)
- T045 retention-purge live (Principle III).
- T046 India residency + DPDP docs verified.
- T047 YouTube quota audit approved (or YouTube disabled, Instagram-only).

---

## Notes
- [P] = different files, no incomplete-task dependencies.
- Every probabilistic value shipped MUST carry a confidence/estimate label (Principle V) — enforced via `shared/labels.ts` (T016).
- Commenter identities are hashed before insert (T013); never returned by any contract.
- Commit after each task or logical group.
