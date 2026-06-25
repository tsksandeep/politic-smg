# Politic — SMG (Social Media Graph)

> A consented, single-party **observability cockpit** for political cadre social media.
> Cadres connect their public Instagram (Creator) and YouTube accounts via OAuth; the
> party gets unified visibility into what its base is pushing, how it performs, and how
> the public reacts — on the party's *own* content only.

This is a **bespoke, single-tenant platform for one party**, not a multi-tenant SaaS.
The moat is the curated party-context knowledge base and the relationship — not the code.

---

## 1. The idea (final, narrowed scope)

The party's cadres voluntarily connect their party-related public social accounts
(Instagram Creator/Business + YouTube) through **explicit OAuth consent**. From that
consented data the platform runs three jobs on one shared pipeline:

1. **Rapid response (the wedge)** — detect anti-party narratives and coordinated trolling
   in the comment sections of *our own* cadres' posts in near-real-time, and surface them
   fast enough to mobilize a counter-response.
2. **Performance analytics** — best/worst content, posting frequency, reach & engagement,
   **unique *engaged* audience** and cadre-overlap mapping.
3. **Message discipline** — detect & flag off-message or rule-breaking posts *after*
   publication (observability, not enforcement) against a curated party-context KB.

All three are **three views over one consented dataset**, not three pipelines.

### Why this shape
- The 2026 TN result (a digital-first insurgent dethroning an incumbent) put every party's
  digital machine under review. The demand is for **better digital war machines**; cadre
  observability is one credible component. We ride that attention but pitch concrete
  rapid-response value — not a "you lost because of this" narrative that won't survive
  scrutiny.
- Every feature that required open-platform scraping, opposition-account access, or
  follower-identity data has been **cut or reframed** (see §4), because the platform APIs
  in 2026 block them and India's DPDP regime makes them a liability.

---

## 2. In scope / out of scope

| ✅ In scope | ❌ Out of scope |
|---|---|
| Cadre posts on **consented** IG Creator + YT accounts | Personal IG accounts (Basic Display API dead, Dec 2024) |
| Comments on **our own** cadres' posts | Scraping opposition-owned accounts / open-platform comment mining |
| Sentiment / anti-party / coordinated-troll **patterns** | Building identifiable dossiers on citizens |
| Unique **engaged** audience (deduped by username) | True cross-account **follower** deduplication (APIs never expose follower identities) |
| Detect & **flag** off-message posts | **Blocking/preventing** posts (we don't control cadre accounts) |
| Aggregate, anonymized comment analysis | Long-term identifiable comment retention |

---

## 3. Honest limits (state these to the party upfront)

- **Detect & flag = a scoreboard + early-warning system, not a control system.** We observe
  posts after publication; we cannot stop a post we don't control.
- **"Public vs opposition commenter" is probabilistic.** Coordinated opposition is designed
  to look organic. Output is a confidence signal, never a verdict.
- **"Unique audience" = unique engagers**, deduped by username (exact for the engaged
  subset), plus an optional *estimated* dedup reach. Not follower counts.
- **Platform dependency is real.** Google's YouTube quota-increase **audit** is the single
  biggest external risk and must be validated *before* committing (no paid-quota path).

---

## 4. Reframed / cut features

| Original ask | Disposition | What we do instead |
|---|---|---|
| Non-unique followers per account | ⚠️ Reframed | Unique **engaged** audience by username; cadre-overlap redundancy map; modeled dedup *estimate* |
| Pick up opposition-comment virality | ⚠️ Constrained | Only within **our own** posts' comment sections |
| Differentiate public vs opp commenters | ⚠️ Probabilistic | Confidence-scored classification, clearly labeled as signal |
| Rules on what not to push | ✅ Kept | LLM + policy classifier flags violations post-publication |
| RAG search + central party vector DB | ✅ Kept | pgvector-backed semantic search over content + party-context KB |

---

## 5. Key metrics

- **Unique engaged audience** (deduped usernames across all connected cadre accounts)
- **Cadre overlap map** — which cadres reach the same people vs distinct pockets
- **Narrative velocity** — rate of anti-party theme growth in own comment sections
- **On-message rate** — % of cadre posts aligned to current party narrative
- **Response latency** — time from attack-narrative detection to counter-mobilization

---

## 6. Architecture — single-tenant on Supabase

One dedicated Supabase project per party (true single tenancy: isolated Postgres,
storage bucket, auth pool, and secrets — no shared multi-tenant plane). The LLM layer is
**external** (OpenRouter → Gemini 2.5 Flash), so the platform's only job is data,
ingestion, and serving — which collapses cleanly onto a single Postgres.

```
                         ┌────────────────────────────────────────────────┐
   Cadre OAuth consent   │              SUPABASE (single tenant)          │
   (IG Creator / YT) ───▶│                                                │
                         │  ┌── Onboarding Edge Fn ─┐                     │
   IG comment webhooks ─▶│  │  OAuth via Nango      │                     │
   YT polling (pg_cron) ▶│  └────────────┬──────────┘                     │
                         │               ▼                                │
                         │   pgmq queue ──▶ Ingest Edge Fns (micro-batch) │
                         │   (fetch → normalize → enqueue)                │
                         │               │                                │
                         │               ├──────────────┐                 │
                         │               ▼              ▼                 │
                         │        OpenRouter API   Supabase Storage       │
                         │     (Gemini 2.5 Flash)   (raw payloads/blobs)  │
                         │               │                                │
                         │               ▼                                │
                         │   ┌─────────  POSTGRES  ──────────┐            │
                         │   │ relational tables             │            │
                         │   │ + pgvector (RAG / party KB)   │            │
                         │   │ + time-series metrics         │            │
                         │   └───────────────┬───────────────┘            │
                         │                   │                            │
                         │    Realtime (Postgres changes) ──▶ live alerts │
                         │                   │                            │
                         │   PostgREST / Edge Fn API ──▶ dashboard (SPA)  │
                         │                   ▲                            │
                         └───────────────────┼────────────────────────────┘
                                             │
                              Supabase Auth + RLS — internal party users only

   ── escape hatch (add only if Edge Fn limits bite) ──────────────────────
   one small Render background worker as the always-on ingestion orchestrator
```

### Component mapping

| Need | Supabase capability | Notes |
|---|---|---|
| Relational data (cadres, accounts, posts, comments, metrics) | **Postgres** | The dedup/overlap/frequency analytics are native SQL (window functions) |
| Vector search (content RAG + party-context KB) | **pgvector** | Same DB as analytics — hybrid SQL + vector, no separate store to sync |
| Time-series metrics (engagement, narrative velocity) | **Postgres** (+ partitioning / optional TimescaleDB) | Partition by time; roll up to aggregates |
| Internal auth | **Auth + RLS** | SSO/email for party users; row-level security enforces least privilege |
| Realtime alerts (rapid-response wedge) | **Realtime** | Stream Postgres changes to the dashboard; no custom WS server |
| Raw payloads, media thumbs, archived comment dumps | **Storage** | S3-compatible; system of record for raw ingest |
| Ingestion pipeline decoupling | **pgmq** | Postgres-native queue: fetch → normalize → analyze → persist, with retries/DLQ |
| Scheduled YT polling + token refresh | **pg_cron** | Triggers micro-batch Edge Functions; backoff to respect quota |
| Compute (OAuth flows, ingest workers, API) | **Edge Functions** (Deno) | One function per bounded responsibility; webhooks land here |
| Cadre OAuth + token storage/refresh | **Nango** (self-hosted, per-tenant) | Brokers IG/YT consent; stores + auto-refreshes per-cadre tokens; the app keeps only a connection handle |
| Internal secrets (service-role key for cron) | **Vault** (+ Postgres) | Cadre OAuth *client* secrets live inside Nango, not the app |
| LLM inference | **OpenRouter → Gemini 2.5 Flash** | External API; see §7 |

### Scaling note (compute, not storage)
Postgres comfortably handles low-thousands-of-accounts comment volume (partition the hot
comment tables, keep raw dumps in Storage). The real ceiling is **Edge Function execution
limits** for long ingestion runs — but YouTube's 10k-unit/day quota throttles polling anyway,
so frequent **small** pg_cron micro-batches stay well inside the limits. Only if that proves
insufficient do we add the **Render background worker** escape hatch (one always-on
orchestrator that drains pgmq) — Supabase's one weak spot, Render's strongest.

---

## 7. AI / NLP layer — Gemini 2.5 Flash via OpenRouter

All inference is an external API call through **OpenRouter**, which gives one key, one
billing surface, model fallback, and a request log. Two-tier to control cost at volume
(thousands of accounts × many posts/comments):

- **Tier 1 — bulk, cheap:** **Gemini 2.5 Flash-Lite** for high-volume work — per-comment
  sentiment, language detection, coarse spam/troll-pattern classification.
- **Tier 2 — nuanced:** **Gemini 2.5 Flash** for on-message/off-message judgment against the
  party-context KB, anti-party theme synthesis, and rapid-response narrative summaries.

Route by difficulty; escalate only the ambiguous cases from Tier 1 to Tier 2 to keep cost
down. OpenRouter handles provider fallback and a unified audit trail of every model call.

**Embeddings & RAG:** OpenRouter is chat-completion-focused, so embeddings come from a
**Gemini embedding model called directly** (Google AI / Vertex), written into **pgvector**.
The party-context knowledge base (manifesto, current talking points, banned topics,
historical positions) lives in that same Postgres; both semantic content search and the
on-message classifier retrieve from it via hybrid SQL + vector queries.

---

## 8. Security & compliance (DPDP posture: minimize & anonymize)

- **Cadre data:** lawful basis = explicit OAuth consent. Per-cadre tokens are held and
  auto-refreshed by **Nango** (self-hosted, India region), encrypted at rest; the app stores
  only a connection handle, never a token (IG long-lived ~60-day lifecycle handled by Nango);
  revocation fully honored (Nango connection deleted + data purged).
- **Commenter data:** analyzed in **aggregate**; commenter usernames **hashed** internally;
  troll detection works on *patterns* (hashed IDs, timing bursts, text similarity), not
  identities. **Short retention with auto-deletion** (pg_cron purge jobs); raw comment text
  not retained long-term.
- **Access:** dashboards behind **Supabase Auth**; **row-level security (RLS)** enforces
  least-privilege internal roles at the database layer.
- **Auditability:** OpenRouter request log + a Postgres access/audit trail retain a record of
  model calls and data access for accountability.
- **Data residency:** pin the Supabase project to an India region to keep personal data
  in-country.
- This posture is also the public-trust line: *we do not build dossiers on citizens.*
- Substantive DPDP provisions bite **May 2027** — retention/deletion and lawful-basis
  documentation are designed in from day one, not bolted on.

---

## 9. Risks & open dependencies

1. **Google quota audit** — validate the YouTube Data API quota increase **before** build;
   no paid-quota path, audits can reject data-heavy use cases.
2. **Platform dependency** — Meta/Google can change quotas or deprecate endpoints; keep
   contingency per platform.
3. **Single-customer concentration** — consulting economics (build fee + retainer), revenue
   tied to one party's election cycle; price accordingly.
4. **Cadre-adoption framing** — must read as *help cadres get amplified*, not *police them*;
   introduce accountability views last and carefully.

---

## 10. Non-goals

- Not a multi-tenant SaaS (single party, single Supabase project).
- Not a content-blocking / pre-publish gate (observability only).
- Not an opposition-surveillance tool (own posts only).
- Not a citizen-profiling system (aggregate + anonymized).

---

## 11. Roadmap (wedge-first)

- **Phase 0 — De-risk:** pass Google quota audit; sign one design-partner party; finalize
  DPDP data-flow.
- **Phase 1 — Rapid response (wedge):** consented onboarding + own-post comment ingestion +
  anti-party narrative detection + live alerts. The demo that closes the contract.
- **Phase 2 — Performance analytics:** unique engaged audience, cadre-overlap map, best/worst
  content, frequency.
- **Phase 3 — Message discipline:** party-context KB + on-message classifier + flagging.
- **Phase 4 — Accountability views:** introduced last, with adoption-safe framing.

---

## 12. Development (Spec-Driven)

This project is built with [GitHub Spec Kit](https://github.com/github/spec-kit). Artifacts:

- **Constitution:** `.specify/memory/constitution.md` (7 non-negotiable principles)
- **Feature 001 — rapid-response wedge:** `specs/001-rapid-response/`
  - `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `tasks.md`
- **Code:** `backend/supabase/` (migrations, Edge Functions, shared utils, tests) · `frontend/` (React board)
- **Deploy & validate:** [`docs/deploy.md`](docs/deploy.md) — provision (India region), set secrets,
  apply migrations, deploy functions, and validate (incl. a no-external-API demo seed at
  `backend/supabase/seed/demo_burst.sql`)
- **Release gates:** [`docs/quota-audit.md`](docs/quota-audit.md) (YouTube quota), `docs/compliance.md` (DPDP/residency, pending)

Status: Setup, Foundational, **US1 (the wedge MVP), US2 (consent onboarding via Nango), US3
(triage), and Polish are all implemented and locally validated.** A favourable-narrative +
cadre-coverage view (an early slice of Phase 2 analytics) ships alongside the wedge. The only
open item is the external **YouTube Data API quota audit** (Principle VII); until it is approved
the YouTube path stays code-gated (`YT_INGEST_ENABLED`) and the product runs **Instagram-first**.
