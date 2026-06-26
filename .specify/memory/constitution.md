<!--
SYNC IMPACT REPORT
==================
Version change: — → 1.0.0   [INITIAL RATIFICATION]
Rationale: First ratification of the governing principles for OpenPolitics — the
Opposition Narrative Intelligence Platform. Establishes nine principles centred on
multi-tenant isolation, public-data-only ingestion, data minimisation, volunteer-node
safety, honest signals, adversarial robustness, anti-poisoning, jurisdiction-aware
compliance, and platform resilience.

Locked product decisions encoded here:
  - Isolation: shared-schema multi-tenancy with tenant_id + RLS (project-per-tenant offered
    only as a premium hard-isolation tier).
  - Comment identity: HMAC-hash authors at ingest; raw-identity mode is built but gated and
    OFF by default.
  - Launch jurisdiction: India / DPDP only; multi-jurisdiction config built, one profile shipped.
  - Node distribution: self-hosted enterprise install of the browser-extension node client.

Templates status:
  ✅ .specify/templates/plan-template.md  — "Constitution Check" derives gates dynamically.
  ✅ .specify/templates/spec-template.md  — aligned.  ✅ tasks-template.md — aligned.
  ✅ README.md / specs/001-opposition-intel/* — principles propagated; status lines aligned.

Deferred / TODO: none.
-->

# OpenPolitics — Opposition Narrative Intelligence Constitution

OpenPolitics is a multi-tenant intelligence platform. Each tenant — a political organisation —
measures the **public** narrative output of its **opposition's** cadre: what narratives they
push, how those narratives rise and decay, when pushes are coordinated, and who amplifies them.
Ingestion is public-data scraping distributed across each tenant's own volunteer node network
(its "IT wing"). These principles are non-negotiable and supersede convenience, velocity, and
feature ambition. Every spec, plan, and task is checked against them.

## Core Principles

### I. Multi-Tenant Isolation (NON-NEGOTIABLE)
Every row of tenant data MUST carry a `tenant_id` and MUST be isolated by row-level security. A
tenant — and any node, user, or token belonging to that tenant — MUST NEVER be able to read,
write, or even enumerate another tenant's data or work. Isolation is a **tested property**, not a
convention: the test suite MUST include cross-tenant negative tests that fail loudly if isolation
regresses. The default data plane is **shared-schema multi-tenancy** (one Postgres, `tenant_id` +
RLS); a dedicated project-per-tenant "hard-isolation" tier MAY be offered as a premium option, but
the shared-schema isolation property is mandatory regardless.
**Rationale:** the platform holds multiple competing political organisations at once; a single
cross-tenant leak is an extinction-level breach of the product's core promise.

### II. Public-Data-Only (NON-NEGOTIABLE)
The platform MUST ingest only data that is publicly accessible **without authenticating into any
account**. Nodes MUST use an isolated, logged-out guest session. The system MUST NEVER log in,
MUST NEVER use a member's or any account's credentials, and MUST NEVER defeat a private gate, paywall,
or follower-only restriction. Private accounts and private posts are out of bounds, full stop.
**Rationale:** the entire legal posture rests on "public, logged-out access." Logged-in scraping
forfeits the *Meta v. Bright Data* (N.D. Cal. 2024) protection and reframes the activity as
unauthorised access under the IT Act. This is the load-bearing legal bet and cannot be waived.

### III. Data Minimisation & No-Warehousing (NON-NEGOTIABLE)
The system MUST persist the minimum necessary. Comment authors MUST be HMAC-hashed **at ingest**;
the raw handle MUST NEVER be persisted. Raw media (images/video) MUST NEVER be warehoused — media is
fetched, transcribed/OCR'd, and the derived **text only** is kept; the raw bytes are discarded.
Raw text (captions, comment bodies) MUST have documented retention windows with automated purge.
A raw-identity comment mode MAY exist only as a per-tenant, jurisdiction-gated, **off-by-default**
flag, explicitly marked elevated-risk; it MUST NOT be the default and MUST NOT be enabled where the
tenant's jurisdiction profile forbids it.
**Rationale:** storing raw commenter handles is the single highest-risk element in the legal review,
and warehousing raw media creates copyright-reproduction exposure (*OLX v. Padawan*). Minimisation
is both the compliance posture and the public-trust line.

### IV. Volunteer-Node Safety
The node client (browser extension) MUST protect its operator above throughput. It MUST maintain an
**isolated guest cookie jar** for the target platform and MUST NEVER touch, read, or reuse the
operator's logged-in session or personal cookies. Request rates MUST be capped and jittered. Egress
MUST be one-way and minimal (node → coordinator only); the node MUST stay "dumb" about analytics and
hold no tenant data beyond its current lease.
**Rationale:** volunteers lend their residential IPs at personal risk; a node that endangers an
operator's personal account or leaks the operator's identity destroys the network we depend on.

### V. Honest Signals
Every probabilistic output MUST be labelled a signal, not a verdict. Inferred coordination MUST be
labelled **inferred**, never asserted as proven. Engagement counts MUST be labelled a **proxy for
reach** (impressions are unobservable). Narrative lifecycle, decay, amplifier ranking, and
patient-zero attribution are estimates and MUST carry confidence. A human-in-the-loop MUST sit
between any coordination claim and any action taken on it.
**Rationale:** targets are adaptive and designed to look organic; over-claiming precision produces
bad war-room calls and destroys trust the first time it is wrong.

### VI. Adversarial Robustness
The design MUST assume targets adapt once they suspect monitoring — feeding decoy narratives, faking
coordination, or poisoning sensors. The platform MUST cross-validate across **redundant nodes**,
randomise sampling cadence, and MUST NEVER trust a single submission as ground truth.
**Rationale:** this is offensive intelligence against a thinking adversary, not passive analytics; a
single trusted sensor is a single point of manipulation.

### VII. Data-Integrity & Anti-Poisoning
Each tracked account/post MUST be redundantly assigned to **2–3 nodes**. Submissions MUST be
reconciled against each other; divergence MUST be flagged. Nodes MUST carry a **trust score** that
decays on divergence, errors, or anomalous output, and low-trust nodes MUST be down-weighted or
quarantined. A compromised node MUST NOT be able to silently poison a tenant's metrics.
**Rationale:** redundancy and reconciliation are the only defence against both platform anti-bot
noise and a deliberately malicious node.

### VIII. Jurisdiction-Aware Compliance
Each tenant MUST declare its jurisdiction(s); the platform MUST apply the matching data-handling
rules (retention, identity handling, residency, in-bounds targets). The launch profile is **India /
DPDP** ("publicly available" posture, Significant-Data-Fiduciary electoral-risk awareness). Stricter
profiles (e.g. EU/GDPR, which treats political opinion as special-category and may render some
targets out-of-bounds) MUST be representable in the same config even if not enabled at launch.
ToS-breach and public-data legal risk are explicit and **founder/tenant-owned**, recorded in
`docs/compliance.md`.
**Rationale:** "public data" and acceptable handling differ materially by country; a global lock is
both wrong and a growth ceiling, and undocumented risk is unowned risk.

### IX. Platform & Anti-Bot Resilience
Platform anti-bot changes are expected, not exceptional. The system MUST degrade **gracefully** when
capture is throttled or blocked: surface coverage gaps explicitly, never silently under-report, and
make data freshness visible. Coverage MUST degrade in proportion to available node capacity, never
fail closed without saying so.
**Rationale:** we build on rented land against an actively hostile platform; silent under-reporting
reads as "all clear" and is worse than a visible gap.

## Technology & Compliance Constraints

- **Stack:** Supabase (Postgres + pgvector, Auth + RLS, Realtime, Storage, pgmq + pg_cron, Edge
  Functions, Deno/TypeScript) as the shared-schema multi-tenant platform. LLM inference is external
  via **OpenRouter → Gemini 2.5 Flash** (Flash-Lite for bulk classification, Flash for nuanced
  synthesis); embeddings from a Gemini embedding model written into pgvector (768-dim). Two net-new
  components are sanctioned: a **browser-extension node client** (MV3, self-hosted enterprise
  install, per-tenant) and an always-on **media-worker container** (OCR/ASR; cannot run inside Edge
  Functions).
- **Coordinator API:** node lifecycle (`node-register`, `work-lease`, `submit`, `heartbeat`) plus
  reconciliation + trust scoring run as Edge Functions over Postgres + pgmq. Nodes authenticate with
  a tenant-scoped node token, never a user session.
- **Secrets:** the commenter-hash key, service-role key, and LLM/embedding keys live in Supabase
  Vault or function secrets; never committed, never logged. Node tokens are tenant-scoped and
  revocable. No raw commenter handle, credential, or session cookie is ever stored or logged.
- **Data residency & retention:** per-tenant jurisdiction config drives region and retention;
  the India profile pins personal data to an India region with automated pg_cron purge of raw text
  and a hard no-raw-media-warehousing rule.
- **Auth:** tenant staff (Admin / Analyst) behind Supabase Auth, scoped to exactly one tenant, with
  RLS enforcing both least privilege and tenant isolation at the database layer.

## Development Workflow (Spec-Driven Development)

This project follows GitHub Spec Kit. Work proceeds through the artifacts, not ad-hoc coding:
1. **Constitution** (this file) — governing principles.
2. **/speckit-specify** — requirements & user stories (what/why, no tech).
3. **/speckit-clarify** — de-risk ambiguity before planning.
4. **/speckit-plan** — technical plan; its **Constitution Check** gate MUST pass before research
   and MUST be re-checked after design.
5. **/speckit-tasks** — ordered, actionable tasks; build is foundation-first (tenant isolation +
   node capture → enrichment + narrative → lifecycle + coordination → scale + resilience).
6. **/speckit-implement** — execute tasks.

No implementation begins before the relevant spec, plan, and tasks exist and the Constitution Check
passes.

## Governance

This constitution supersedes all other practices. Amendments MUST be made by editing this file via
`/speckit-constitution`, with a Sync Impact Report and a semantic version bump:
- **MAJOR** — a principle removed or redefined in a backward-incompatible way.
- **MINOR** — a new principle or section added, or guidance materially expanded.
- **PATCH** — clarifications and wording fixes.

Every plan and task review MUST verify compliance with these principles; any deviation MUST be
recorded and justified in the plan's Complexity Tracking section, or the work MUST be revised.
Principles I, II, and III are NON-NEGOTIABLE and cannot be waived by a plan-level justification.

**Version**: 1.0.0 | **Ratified**: 2026-06-26 | **Last Amended**: 2026-06-26
