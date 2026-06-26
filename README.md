# OpenPolitics — Opposition Narrative Intelligence

> A multi-tenant intelligence platform where each tenant — a political organisation — measures the
> **public** narrative output of its **opposition's** cadre: what narratives they push, how those
> narratives rise and decay, when pushes are coordinated, and who amplifies them.

Ingestion is public-data scraping distributed across each tenant's own volunteer node network — its
"IT wing". The platform turns thousands of public opposition posts into a handful of labelled
narratives worth a war-room's attention, each carrying a confidence **signal**, never asserted as
fact.

The targets are the opposition's **public** accounts; the only thing the platform ever touches is data
that is visible to a logged-out member of the public. It never logs in, never uses anyone's
credentials, and never measures a tenant's own accounts.

---

## 1. The idea

A war-room analyst watches a single live board that names the narratives the opposition's cadre is
currently pushing across their public posts — the claim, the framing, the target, how much volume
each carries, and whether it is rising or fading. Underneath, four things make that board possible:

1. **Distributed public capture** — a network of Manifest-V3 browser-extension *nodes* on
   volunteers' residential IPs lease small batches of work, fetch public opposition data through an
   isolated logged-out guest session, and submit normalised captures to a coordinator. Nodes never
   log in and never touch the operator's personal session.
2. **Enrichment** — captions, reel transcripts, and public comments are embedded (pgvector, 768-dim)
   and classified (Gemini 2.5 Flash / Flash-Lite via OpenRouter). Media is **transcribed then
   discarded** — the derived text is kept, the raw bytes never are.
3. **Analytics** — embeddings cluster into labelled **narratives** with lifecycle and decay curves;
   an **inferred** coordination signal fuses synchronised timing, near-duplicate captions, reused
   reel audio, and same-hashed-author co-pushing; **amplifier** accounts are ranked by how reliably
   they convert a narrative into engagement velocity; and an **emerging-narrative early warning**
   trips before a cluster peaks.
4. **Isolation** — every row carries a `tenant_id` and is row-level-security isolated. Many competing
   political organisations live on one shared-schema deployment and none can read, write, or even
   enumerate another's data.

### The scaling law — "your IT-wing strength is your scale"

Throughput is a function of node count, not our infrastructure bill:

> throughput per tenant ≈ (active nodes) × (safe requests / node / day)

At ~100 safe guest-requests/node/day, ~30 nodes covers ~250 accounts at a 2-hour cadence; ~500 nodes
covers a 10k-account target at ~5 hours. Roughly linear. Scale is the tenant's recruiting problem.
When node capacity falls below target, **coverage degrades proportionally and visibly** — the board
never silently under-reports.

---

## 2. Architecture

```text
        VOLUNTEER NODE NETWORK (the tenant's "IT wing")
        ┌──────────────────────────────────────────────┐
        │  MV3 browser extension · residential IP ·      │
        │  isolated LOGGED-OUT guest session             │   lease → capture → submit → heartbeat
        │  (rate-capped + jittered, never logs in)       │ ───────────────────────────────────────┐
        └──────────────────────────────────────────────┘                                          │
                                                                                                   ▼
   ┌───────────────────────────────────  SUPABASE (shared-schema, one region per jurisdiction) ───────────┐
   │                                                                                                       │
   │   COORDINATOR (Edge Functions, node token auth — verify_jwt = false)                                  │
   │     node-register · work-lease · submit · heartbeat                                                   │
   │        │ normalise capture · HMAC-hash comment authors at ingest · enqueue                            │
   │        ▼                                                                                              │
   │   pgmq queues:  enrich_jobs ──▶ media_jobs ──▶ reconcile_jobs            ┌─────────────────────────┐  │
   │        │                            │                                    │   MEDIA-WORKER          │  │
   │        │                            └───────── media_url ──────────────▶ │  (always-on container)  │  │
   │        ▼                                                                  │  fetch CDN media →      │  │
   │   PIPELINE (Edge Functions, invoked by pg_cron with the service role)    │  OCR/ASR → transcript   │  │
   │     enrich · detect-narratives · coordination-detect · assign-work       │  → DISCARD raw bytes    │  │
   │     reconcile · retention-purge                                          └─────────────────────────┘  │
   │        │                                                                                              │
   │        ▼                                                                                              │
   │   POSTGRES + pgvector   (every tenant row: tenant_id + RLS, default deny)                             │
   │     tracked_account · post · post_metric_sample · comment(author_hash) · media_transcript            │
   │     narrative · narrative_observation · coordination_signal · account_narrative_participation · alert │
   │        │                                                                                              │
   │        ├── tenant-scoped views (security_invoker): narrative_board · coordination_board ·             │
   │        │      amplifier_targets · alert_board · node_coverage                                         │
   │        │                                                                                              │
   │        └── Realtime (postgres_changes, RLS-filtered) ──▶ live war-room                                │
   │                                                                                                       │
   │   WAR-ROOM (React SPA, Supabase Auth + JWT tenant claim)                                              │
   │     narrative board · narrative detail · coordination board · amplifiers · node coverage · alerts     │
   │     alert-triage · detection-settings (Admin)                                                         │
   └───────────────────────────────────────────────────────────────────────────────────────────────────────┘

   External inference: OpenRouter → Gemini 2.5 Flash / Flash-Lite (classification + synthesis) ·
   Gemini embedding model → pgvector (768-dim). Only derived text is ever sent; never a join key.
```

### Component map

| Surface | Lives in | Responsibility |
|---|---|---|
| **Coordinator** | `backend/supabase/functions/{node-register,work-lease,submit,heartbeat}` | Node lifecycle: enrolment, rate-capped redundant work leases, capture normalisation, liveness. Node-token auth (`verify_jwt = false`). |
| **Pipeline** | `backend/supabase/functions/{enrich,detect-narratives,coordination-detect,assign-work,reconcile,retention-purge}` | Embed/classify/hash, cluster + label + lifecycle + early-warning, inferred coordination, velocity-aware assignment, reconciliation + node trust, retention purge. Invoked by `pg_cron`. |
| **War-room API** | `backend/supabase/functions/{alert-triage,detection-settings}` + views | Alert triage and per-tenant thresholds, under the signed-in user's JWT + RLS. |
| **Node client** | `extension/` | MV3 extension: isolated guest session, lease/submit/heartbeat. The only component that touches the target platform, and only logged-out. |
| **Media worker** | `backend/media-worker/` | Always-on container: fetch CDN media → OCR/ASR → transcript → discard bytes. The one job Edge Functions cannot do. |
| **War-room SPA** | `frontend/` | React board: narratives, coordination, amplifiers, node coverage, alerts. |
| **Schema** | `backend/supabase/migrations/0001–0007` | Multi-tenant schema, pgvector, RLS, pgmq, pg_cron, views, detection. |

---

## 3. The nine principles (in brief)

The constitution (`.specify/memory/constitution.md`) governs every spec, plan, and task.

| # | Principle | In one line |
|---|---|---|
| I | **Multi-Tenant Isolation** *(non-negotiable)* | `tenant_id` + RLS on every row; cross-tenant access is impossible and tested as a property. |
| II | **Public-Data-Only** *(non-negotiable)* | Logged-out guest session only; never log in, never defeat a private gate. The load-bearing legal bet. |
| III | **Data Minimisation & No-Warehousing** *(non-negotiable)* | Comment authors HMAC-hashed at ingest; raw media transcribed-then-discarded; raw text on a retention TTL. |
| IV | **Volunteer-Node Safety** | Isolated guest cookie jar; rate-capped + jittered; one-way egress; the node holds no tenant data beyond its lease. |
| V | **Honest Signals** | Every probabilistic output is a labelled signal with confidence; coordination is **inferred**; human-in-the-loop before action. |
| VI | **Adversarial Robustness** | Assume targets adapt — cross-validate across redundant nodes, randomise cadence, never trust one sensor. |
| VII | **Data-Integrity & Anti-Poisoning** | 2–3 node redundancy + reconciliation + decaying trust score; a compromised node cannot silently poison metrics. |
| VIII | **Jurisdiction-Aware Compliance** | Per-tenant jurisdiction profile drives retention/identity/residency; India/DPDP at launch; risk is founder/tenant-owned. |
| IX | **Platform & Anti-Bot Resilience** | Degrade gracefully; surface coverage gaps; never fail closed silently. |

---

## 4. Repository layout

```text
backend/
├── supabase/
│   ├── migrations/      # 0001 schema · 0002 vector · 0003 rls · 0004 queues · 0005 cron · 0006 views · 0007 detection
│   ├── functions/       # coordinator + pipeline + war-room Edge Functions (Deno/TypeScript)
│   ├── shared/          # db, llm, embeddings, hash, node-auth, tenant, labels, log
│   ├── seed/            # demo_tenant.sql — two tenants, nodes, captured posts, a coordination burst
│   └── tests/           # RLS isolation property, reconciliation/trust, detection, enrich, retention
├── media-worker/        # always-on OCR/ASR container (transcribe-then-discard)
└── docker/              # self-hosted local stack: kong.yml, migrate.sh, edge-main, db-init

extension/               # MV3 node client (TypeScript): guest session, lease/submit/heartbeat
frontend/                # React war-room SPA + landing hero
specs/001-opposition-intel/   # spec · plan · research · data-model · quickstart · tasks · contracts/
.specify/memory/         # constitution.md (the nine principles — source of truth)
docs/                    # compliance, deploy, local-dev, node-network, landing-page, secrets
```

---

## 5. Getting started

- **Local dev** — bring the whole stack up with one `docker compose up`, migrate, seed, run the
  pipeline, and exercise a simulated node: [`docs/local-dev.md`](docs/local-dev.md). Mirrors
  [`specs/001-opposition-intel/quickstart.md`](specs/001-opposition-intel/quickstart.md).
- **Deploy** — provision Supabase per jurisdiction (India for launch), set secrets, apply migrations,
  deploy functions, run the media worker, distribute the extension: [`docs/deploy.md`](docs/deploy.md).
- **The node network** — install, safety model, rate caps, redundancy/trust, the scaling law:
  [`docs/node-network.md`](docs/node-network.md).
- **Compliance** — jurisdiction-aware posture, the India/DPDP profile, the public-data legal bet:
  [`docs/compliance.md`](docs/compliance.md).

This project is built with [GitHub Spec Kit](https://github.com/github/spec-kit): the constitution
governs, then `spec → plan → research → data-model → tasks → implement`. No implementation begins
before the Constitution Check passes.

---

## 6. Honest limits

State these plainly — they are constitutional, not caveats bolted on:

- **Coordination is an inference, not proof.** Targets are adaptive and designed to look organic. The
  output is a confidence signal naming the type (temporal / content / shared-audio / author-network)
  and the contributing accounts — never a verdict. A human reviews before any action.
- **Engagement counts are a proxy for reach.** Impressions are unobservable; likes/comments/views are
  what is public, and they are labelled as a proxy.
- **Coverage is bounded by node count and IP reputation.** A burned residential IP throttles to a
  persistent 401; the platform backs off, re-leases to another node, and shows the gap. It does not
  invent data to fill it. Below target node count, coverage degrades — visibly.
- **Amplifier rank, patient-zero, lifecycle, half-life are estimates**, each carried with confidence.
- **We build on rented land.** Platform anti-bot changes are expected; the design degrades gracefully
  rather than pretending all is well.

## 7. Legal posture

The entire posture rests on **public, logged-out access** — the *Meta v. Bright Data* (N.D. Cal.
2024) line that scraping public, unauthenticated data is not unauthorised access. The hard rule is
**never log in** (Principle II): logging in would forfeit that protection and reframe the activity as
unauthorised access under the IT Act. The platform also **never warehouses raw media** (sidestepping
copyright-reproduction exposure) and **never persists raw commenter handles** by default (the highest
item in the data-protection review).

Residual risk is primarily **political** — an opposition complaint — and is explicitly
**founder/tenant-owned, per jurisdiction**, recorded in [`docs/compliance.md`](docs/compliance.md).
The launch jurisdiction is **India / DPDP**; the configuration generalises to stricter profiles
(e.g. EU/GDPR) without code changes. **This is not legal advice.**

---

## Status

**Foundation laid; all surfaces scaffolded.** The multi-tenant schema (migrations 0001–0007 — schema,
pgvector, RLS, pgmq, pg_cron, views, detection) is in place, with the coordinator + pipeline Edge
Functions, the MV3 node client, the media-worker container, and the React war-room scaffolded against
it. Tenant isolation is enforced as a database property and exercised by cross-tenant negative tests.
Launch jurisdiction is India / DPDP; the multi-jurisdiction config is built with one profile shipped.
