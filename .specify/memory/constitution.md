<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0   [MINOR — guidance materially expanded]
Bump rationale: Per-cadre OAuth token storage moved from Supabase Vault to a self-hosted
Nango instance (implemented in migration 0016). Principle III's mechanism guidance is
unchanged in intent ("encrypted at rest, never logged, revocation honored") but the named
mechanism for cadre tokens changes, and Nango is added as a sanctioned external component
alongside the Render escape hatch. No principle is removed or redefined → MINOR, not MAJOR.

Modified sections:
  - Principle VII rationale (unchanged) — token-lifecycle now delegated to Nango auto-refresh.
  - Technology & Compliance Constraints → Stack: added self-hosted Nango (managed OAuth) as a
    sanctioned external component (per-tenant, India region).
  - Technology & Compliance Constraints → Secrets: per-cadre OAuth tokens live in Nango
    (encrypted at rest, auto-refreshed); Supabase Vault retains internal secrets (service-role
    key for cron). OAuth *client* secrets are configured inside Nango, not the app.
Added sections: none. Removed sections: none.

Templates status:
  ✅ .specify/templates/plan-template.md  — "Constitution Check" derives gates dynamically.
  ✅ .specify/templates/spec-template.md  — aligned. ✅ tasks-template.md — aligned.
  ✅ README.md / specs/001-rapid-response/* — Vault→Nango propagated; status lines aligned.

Deferred / TODO: none.
-->

# Politic — SMG (Social Media Graph) Constitution

Politic-SMG is a consented, single-party social media **observability cockpit**. These
principles are non-negotiable and supersede convenience, velocity, and feature ambition.
Every spec, plan, and task is checked against them.

## Core Principles

### I. Consent-Only Data Collection (NON-NEGOTIABLE)
Data MUST enter the system only through an explicit OAuth grant from the account owner
(a cadre connecting their own Instagram Creator/Business or YouTube account). The system
MUST NOT scrape, crawl, or ingest data from accounts that have not authenticated, and MUST
NOT touch opposition-owned or arbitrary open-platform data. OAuth revocation MUST be honored
immediately and completely (stop ingestion, purge derived data on the documented schedule).
**Rationale:** consent is the product's only lawful basis and its only durable trust anchor;
the platform APIs (post-2024) and DPDP both make non-consented access a legal and existential
liability.

### II. Own-Content Boundary (NON-NEGOTIABLE)
Comment and reaction analysis MUST be limited to content appearing on *our own cadres'*
posts — data the cadre's OAuth grant legitimately exposes. The system MUST NOT reach into
opposition accounts, third-party feeds, or the open platform to harvest comments.
**Rationale:** keeps the entire pipeline inside the consented perimeter and out of API-blocked,
ToS-violating, DPDP-exposed territory.

### III. Privacy by Minimization (NON-NEGOTIABLE)
Commenter (citizen) data MUST be processed to the minimum necessary: analyzed in aggregate,
commenter identifiers hashed before storage, troll/coordination detection performed on
*patterns* (hashed IDs, timing, text similarity) rather than identities. Raw comment text
MUST have short retention with automated deletion. Personal data MUST reside in an India
region. The system MUST NOT build or expose per-citizen dossiers.
**Rationale:** "we do not profile citizens" is both the compliance posture (DPDP minimize &
anonymize, enforcement from 2027) and the public-trust line if the system is ever scrutinized.

### IV. Observability, Not Control
The system detects and FLAGS post-publication; it MUST NOT claim or imply the ability to
block, gate, or prevent a cadre's post. Any control-style feature (pre-publish review,
distribution) is out of scope unless and until the constitution is amended.
**Rationale:** we do not control cadre accounts; promising prevention is dishonest and would
make us accountable for posts we can only ever observe.

### V. Honest Signals
Probabilistic outputs MUST be labeled as confidence scores or estimates, never as fact. This
specifically governs: public-vs-opposition commenter classification (a confidence signal, not
a verdict) and audience figures (report **unique engaged audience** by deduplicated username;
any total-reach number MUST be marked an *estimate*, never a follower count).
**Rationale:** coordinated opposition is designed to look organic, and follower identities are
not available via API; overclaiming precision destroys trust the first time it is wrong.

### VI. Single-Tenant Isolation
Each party MUST run in a dedicated, isolated tenant — one Supabase project per party with its
own database, storage, auth pool, and secrets. There MUST be no shared multi-tenant data plane.
**Rationale:** political data is maximally sensitive; isolation is the only acceptable blast
radius, and the product is a bespoke single-party engagement, not a multi-tenant SaaS.

### VII. Platform-Dependency Discipline
Designs MUST treat Meta/Google API limits as hard constraints, not afterthoughts. The YouTube
Data API quota-increase audit is a release-blocking external dependency and MUST be validated
before committing to dependent features. Each platform integration MUST document its rate
limits, token lifecycle (e.g. IG ~60-day refresh, delegated to Nango auto-refresh), and a
contingency for deprecation.
**Rationale:** we build on rented land; an unexamined quota or endpoint change can silently
break core features.

## Technology & Compliance Constraints

- **Stack:** Supabase (Postgres + pgvector, Auth + RLS, Storage, Realtime, pgmq + pg_cron,
  Edge Functions) as the single-tenant platform. LLM inference is external via
  **OpenRouter → Gemini 2.5 Flash** (Flash-Lite for bulk, Flash for nuanced); embeddings from
  a Gemini embedding model (Vertex AI, India region) written into pgvector. Two external
  components are sanctioned: a **self-hosted Nango instance** (per-tenant, India region) that
  brokers cadre OAuth and owns token storage + auto-refresh; and a **Render background worker**
  escape hatch, added solely if Edge Function runtime limits block ingestion.
- **Secrets:** Per-cadre OAuth tokens MUST be encrypted at rest and never logged — they live in
  **Nango** (which also auto-refreshes them); the app stores only a connection handle, never a
  token (Principle III minimization). Platform OAuth *client* secrets are configured inside Nango.
  Internal secrets (the service-role key used for pg_cron → Edge Function invocation) live in
  **Supabase Vault**. No secret is ever committed to code or logged in plaintext.
- **Data residency & retention:** India region; documented retention windows with automated
  pg_cron purge jobs; lawful-basis and deletion records maintained from day one.
- **Auth:** internal party users only, behind Supabase Auth with row-level security enforcing
  least privilege at the database layer.

## Development Workflow (Spec-Driven Development)

This project follows GitHub Spec Kit. Work proceeds through the artifacts, not ad-hoc coding:
1. **Constitution** (this file) — governing principles.
2. **/speckit-specify** — requirements & user stories (what/why, no tech).
3. **/speckit-clarify** — de-risk ambiguity before planning.
4. **/speckit-plan** — technical plan; its **Constitution Check** gate MUST pass before
   research and MUST be re-checked after design.
5. **/speckit-tasks** — ordered, actionable tasks; build is wedge-first (rapid response →
   analytics → message discipline → accountability views).
6. **/speckit-implement** — execute tasks.

No implementation begins before the relevant spec, plan, and tasks exist and the Constitution
Check passes.

## Governance

This constitution supersedes all other practices. Amendments MUST be made by editing this file
via `/speckit-constitution`, with a Sync Impact Report and a semantic version bump:
- **MAJOR** — principle removed or redefined in a backward-incompatible way.
- **MINOR** — new principle or section added, or guidance materially expanded.
- **PATCH** — clarifications and wording fixes.

Every plan and task review MUST verify compliance with these principles; any deviation MUST be
recorded and justified in the plan's Complexity Tracking section, or the work MUST be revised.
Principles I, II, and III are NON-NEGOTIABLE and cannot be waived by a plan-level justification.

**Version**: 1.1.0 | **Ratified**: 2026-06-24 | **Last Amended**: 2026-06-25
