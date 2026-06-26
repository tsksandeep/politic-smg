# Compliance — Jurisdiction-Aware Data Handling

OpenPolitics is multi-tenant and multi-jurisdiction. Each tenant declares a **jurisdiction profile**
that drives retention windows, identity handling, data residency, and which targets are in bounds
(Principle VIII). The platform ships **one** profile enabled — **India / DPDP** — but the config is
shaped to express stricter profiles without code changes.

This document is the record of the legal posture and the risk owners. **It is not legal advice.**

---

## The legal bet (load-bearing)

The entire posture rests on **public, logged-out access**:

- **Public-data-only (Principle II, non-negotiable).** The platform ingests only data publicly
  accessible **without authenticating into any account**. Nodes use an isolated logged-out guest
  session. The system **never** logs in, **never** uses anyone's credentials, and **never** defeats a
  private gate, paywall, or follower-only restriction. Private accounts and private posts are out of
  bounds, full stop. A `tracked_account` discovered to be private is flagged `is_private` and dropped
  from capture.
- **Why it matters.** This is the *Meta v. Bright Data* (N.D. Cal. 2024) line: scraping public,
  unauthenticated data is not unauthorised access. Logging in would forfeit that protection and
  reframe the activity as unauthorised access under the IT Act. **The no-login rule is hard and
  cannot be waived** — it is enforced in the node client, not just promised here.
- **No-warehousing of raw media (Principle III).** Media is fetched, OCR'd/transcribed, and the
  derived **text only** is kept; the raw bytes are discarded. This sidesteps the
  copyright-reproduction exposure that warehousing images/video would create.

### Residual risk and ownership

The residual risk is primarily **political** — an opposition complaint — rather than a clean legal
prohibition on public-data scraping. That risk, plus any ToS-breach exposure, is **explicit and
founder/tenant-owned, per jurisdiction**. Each tenant accepts the posture for its own jurisdiction.
Undocumented risk is unowned risk; this file is where it is owned.

---

## India / DPDP profile (`IN-DPDP`) — shipped

The launch profile. Posture: **publicly-available, minimise & anonymise, in-country**.

### "Publicly available" posture
The DPDP Act exempts personal data that the Data Principal has **made publicly available**. Opposition
cadre posting on public accounts is the basis the profile relies on. The platform reinforces this by
holding the absolute minimum and never crossing into private data (Principle II).

### Significant-Data-Fiduciary / electoral-risk awareness
Election-adjacent political processing is sensitive and may attract Significant-Data-Fiduciary-style
scrutiny. The profile is built to support that posture: minimisation by default, documented retention,
auditable purge, and a hard gate on raw identity. Naming a Grievance Officer and a Data Protection
Officer in the tenant's privacy notice is a **tenant-owned** (not codeable) obligation.

### Data residency — in-country
The Supabase project is created in an **India region** (e.g. `ap-south-1` / Mumbai); personal data is
pinned in-country at rest (`config.toml` header; verified at provisioning, see `docs/deploy.md` §1).

### 30-day raw-text retention
Raw text — `post.caption` and `comment.body` — is purged **30 days** after ingestion by the
`retention-purge` function (scheduled hourly via `pg_cron`, migration `0005_cron.sql`), configurable
per jurisdiction. Anonymised / derived data — author hashes, embeddings, narrative and metric
time-series — carries no identity and is retained for the engagement.

### Comment authors HMAC-hashed at ingest
Comment author identity is stored only as a **keyed HMAC** (`shared/hash.ts`, keyed by
`COMMENTER_HASH_KEY`), computed **before** insert; the raw handle is never persisted by default. The
stable hash still allows same-actor-across-targets detection (the author-network coordination signal)
without ever holding an identity. Rotating the key breaks historical hash continuity by design.

### Raw-identity mode — gated OFF
A raw-identity comment mode exists only as a per-tenant, jurisdiction-gated, **off-by-default** flag
(`tenant.raw_identity_enabled`). `comment.author_raw` is populated **only** when that flag is true
**and** the jurisdiction profile permits it; otherwise the column stays null and only `author_hash`
exists. The `IN-DPDP` profile keeps it off.

### No raw-media warehousing
The media worker fetches CDN media, emits `media_transcript` text, and discards the bytes. `media_url`
is stored transiently and cleared as soon as a transcript is emitted. No image or video byte is ever
persisted.

### External processing (LLM + embeddings)
Only **derived text** — caption/transcript/comment body — is sent to OpenRouter → Gemini and the
Gemini embedding endpoint; never the author hash, account, tenant, or any join key, so the provider
cannot reconstruct a profile. Prefer an India-region inference path where available. Accepting the
provider DPAs (no-training / retention terms) and recording the processing region is a **tenant-owned
external sign-off** before production with real data.

---

## How the multi-jurisdiction config generalises

The per-tenant `jurisdiction` key selects a profile that parameterises the same machinery:

| Knob | `IN-DPDP` (shipped) | Stricter profile, e.g. `EU-GDPR` (representable, **not enabled**) |
|---|---|---|
| Legal basis for opposition data | "publicly available" exemption | Political opinion is **special-category** (Art. 9); the "publicly available" route narrows, and some targets may be **out of bounds** entirely |
| Raw-text retention | 30 days | Likely shorter; stricter purpose-limitation |
| Raw-identity mode | gated OFF | forbidden by profile |
| Residency | India region | EU region |
| Risk owner | tenant (India) | tenant (EU) |

The config is *shaped* to express the stricter profile so no code changes when a new jurisdiction is
enabled — but only `IN-DPDP` is on at launch (Principle VIII). A stricter profile may render targets
that are fair game under `IN-DPDP` out-of-bounds; the in-bounds-target rule is part of the profile.

---

## Data Principal rights (DPDP)

- **Grievance / DPO contact** — the tenant publishes a Grievance Officer + DPO in its privacy notice.
  Tenant-owned, per deployment; not code.
- **Erasure** — commenter identities are not stored (only a non-reversible keyed hash), and raw text
  auto-deletes at 30 days, so a commenter erasure request is largely satisfied standing. On request, a
  requester who proves a handle can have its matching `author_hash` rows deleted (we re-hash the
  supplied handle with the same key to locate rows). No identity index is retained.
- **Audit of erasure** — `retention-purge` logs deletion counts per run as the deletion record.

---

## External sign-offs (cannot be closed in code — owner + status)

These remain genuinely external; they are tracked, not codeable:

- [ ] **Jurisdiction profile accepted** for this tenant, residual political/ToS risk acknowledged —
  owner: **founder + tenant**.
- [ ] **LLM/embedding provider DPA** accepted and processing region recorded — owner: **tenant DPO + vendor**.
- [ ] **Grievance Officer + DPO** named and published in the privacy notice — owner: **tenant**.
- [ ] **Legal review** of retention windows for this deployment — owner: **tenant legal**.
- [ ] **Region confirmed** matching the jurisdiction profile at provisioning — owner: **deployer**.

---

*This document maps the build to the constitution (Principles II, III, VIII). It is a compliance
posture and risk register, not legal advice. Each tenant owns the legal call for its jurisdiction.*
