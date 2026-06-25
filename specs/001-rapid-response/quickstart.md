# Quickstart: Rapid-Response Narrative Alerting

A validation/run guide proving the wedge works end-to-end. Implementation details live in
`tasks.md` (created by `/speckit-tasks`), not here.

## Prerequisites

- A Supabase project pinned to an **India region** (single tenant), with extensions enabled:
  `pgvector`, `pgmq`, `pg_cron`.
- Secrets configured: OpenRouter API key; Gemini embedding API key; Instagram (Facebook Login)
  app credentials; YouTube Data API credentials. Stored in Supabase Vault — never in code.
- For YouTube: an **approved quota-increase audit** (or run Instagram-first; see research.md R2).
- Frontend env pointed at the Supabase project URL + anon key.

## Setup (high level)

1. Apply migrations (schema + pgvector + RLS + pgmq queues + pg_cron jobs) — see `data-model.md`.
2. Deploy Edge Functions (`oauth-start`, `oauth-callback`, `ig-webhook`, `ingest-youtube`,
   `analyze-comments`, `detect-narratives`, `token-refresh`, `retention-purge`).
3. Register the Instagram webhook subscription for the app.
4. Create one Admin user (Supabase Auth) and assign `role = admin`.
5. Serve the frontend dashboard.

## Validation scenarios

### V1 — War-room alert (User Story 1, the wedge) — SC-001, SC-002, SC-004
1. Pre-connect a small set of test cadre accounts (manually, before US2 onboarding exists).
2. Inject a coordinated burst of hostile comments on their posts (many hashed identities,
   similar text, short window).
3. **Expect**: within ~15 min an alert appears on the live board (no refresh) summarizing theme,
   affected scope, volume, growth.
4. Open the alert → see anonymized example comments, a **confidence score**, and a coordination
   indicator, all labeled "signal, not verdict".
5. Inject a *positive* viral surge → **expect no alert** (healthy-spike exclusion).

### V2 — Consent onboarding (User Story 2) — SC-005
1. As a cadre, run `/oauth-start` → authorize a Creator/Business account → `/oauth-callback`.
2. **Expect**: account connected; last-30-days posts + their comments begin appearing.
3. Try connecting a personal IG account → **expect** unsupported-type guidance, no data collected.
4. Revoke the account → **expect** ingestion stops and data purges on schedule.

### V3 — Triage (User Story 3) — SC-006
1. Acknowledge and assign an open alert → **expect** live status change for all analysts.
2. Log a response and close → **expect** detection→response latency recorded.

### V4 — Privacy & retention (Principle III) — FR-008/009
1. Inspect stored comments → **expect** only `commenter_hash`, never raw handles.
2. Advance/clock the retention job past 30 days → **expect** raw `body` purged, anonymized
   derivatives retained.

### V5 — Access control (FR-016)
1. As an Analyst, attempt `PUT /detection-settings` → **expect 403** (RLS denies).
2. As an Admin → **expect** success.

## Done (feature acceptance)
All five validation groups pass and map to Success Criteria SC-001…SC-007 in `spec.md`.
