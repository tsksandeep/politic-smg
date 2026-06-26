# Phase 0 Research: Opposition Narrative Intelligence

## R1 — Public capture path (Instagram, logged-out)

**Decision**: Capture via a warm **logged-out guest session** in a real browser context, then read
JSON from the private-but-unauthenticated web endpoints.

**Findings (live-probed, June 2026)**:

| Path | Result (datacenter IP, no session) |
|---|---|
| `?__a=1&__d=dis` | dead (`201`, empty) |
| `/api/v1/users/web_profile_info/` over plain HTTP | `401 require_login` |
| `/graphql/query` single-post via `doc_id` over plain HTTP | `403 not-logged-in` |
| Profile HTML | `200`, post JSON stripped — only `og:` meta survives |

The reliable path: open the profile in a real browser context, **warm the guest session** (the first
data XHR returns `401` on a *cold* session; a page **reload** re-establishes it → `200`; a plain
wait does *not* warm it — it must be a navigation), then `fetch()` in-page with the warm cookies +
`x-ig-app-id: 936619743392459`:
- `/api/v1/users/web_profile_info/?username=…` → profile metadata + follower count.
- `/api/v1/feed/user/{uid}/?count=30&max_id=<cursor>` → posts/reels with `code`, `like_count`,
  `comment_count`, `play_count`, `caption.text`, `audio` metadata, `taken_at`, thumbnail. A `max_id`
  cursor API — **no GraphQL `doc_id`** to rotate every 2–4 weeks.
- Public comments endpoint per media for comment capture.

**Why a browser extension, not a server scraper or WebRTC**: reading the JSON requires bypassing
CORS, which only a browser **extension** (host-permissions) or a native client can do — WebRTC
cannot. Once the extension exists on the node it already has the residential IP, fetches directly,
and POSTs results over plain HTTPS; WebRTC would add TURN/signalling/NAT-traversal for zero benefit.
WebRTC is parked as a future "dumb native exit-node" variant only.

**Rationale**: the prototype (`backend/scrapers/instagram/scrape_profile.py`) proved this exact path;
it is the reference logic ported into the extension node client.

## R2 — The physical ceiling: IP reputation

**Decision**: scale horizontally with **node count**, not request rate. A fresh datacenter IP warms
to `200` and pages cleanly, but after ~10 rapid runs the same IP throttles to a **persistent 401** a
short cooldown won't clear (observed firsthand). Mitigations baked in: residential/mobile IPs (every
volunteer node is one), per-node rate caps + jitter, treat persistent `401` as "IP burned" → back
off + re-lease to another node, surface the gap (Principle IX). The scaling law:

> throughput per tenant ≈ (active nodes) × (safe requests / node / day)

At ~100 safe guest-requests/node/day: ~30 nodes ≈ 250 accounts @ 2h cadence; ~100 nodes ≈ ~800; ~500
nodes ≈ the full 10k @ ~5h. Roughly linear — scale is the tenant's recruiting problem, not our infra
bill.

## R3 — Velocity sampling (the cost driver)

**Decision**: engagement counts are snapshots; to measure velocity/decay we **re-sample the same
post several times in its first 24–48h**, not once. High-velocity posts therefore cost more node
budget. The `assign-work` generator prioritises **fresh + accelerating** posts and tapers cadence as
a post ages (`work_assignment.not_before` schedules the next sample). This is the main tuning knob
between freshness and node load.

## R4 — Multi-tenant isolation

**Decision**: **shared-schema multi-tenancy** — one Postgres, `tenant_id` on every tenant row, RLS
predicate `tenant_id = current_tenant()`, default deny. `current_tenant()` resolves from a JWT claim
(users) or the node token (nodes). Service role bypasses RLS and is used only by trusted backend
functions. Project-per-tenant remains available as a premium hard-isolation tier but is not the
default. Isolation is verified by **cross-tenant negative tests** (Principle I, SC-001).

**Rationale**: standard SaaS path; one operational surface; isolation provable and testable. The
premium per-project tier exists for tenants who require physical separation.

## R5 — Enrichment & LLM tiering (reused engine)

**Decision**: keep the proven two-tier routing — **Gemini 2.5 Flash-Lite** (bulk: per-item
sentiment/language/coarse features) escalating ambiguous cases to **Gemini 2.5 Flash** (nuanced:
narrative theme synthesis, coordination judgment, summaries), via OpenRouter. Embeddings from a
Gemini embedding model (768-dim) into pgvector, region per tenant. Captions + transcripts +
comment text all embed into the same space for clustering.

## R6 — Coordination as inference

**Decision**: fuse four signal families into a single `coordination_signal` with a baseline + anomaly
threshold, **always labelled inferred**, human-in-the-loop mandatory (Principle V/VI):
- **temporal** — synchronised drops within `coordination_window` across ≥ `coordination_min_accounts`.
- **content** — near-duplicate captions / identical hashtag sets / reposted media (perceptual/text
  similarity).
- **shared-audio** — reused reel `audio_id` across accounts (a strong, cheap signal).
- **author-network** — same hashed comment authors co-pushing across multiple opposition targets.

Adversarial posture: targets may plant decoy coordination once they suspect monitoring →
cross-validate across redundant nodes, randomise sampling, never assert proof.

## R7 — Media pipeline (transcribe-then-discard)

**Decision**: a separate always-on **media-worker container** (cannot run in Edge Functions: no
browser/heavy runtime) fetches media from the IG CDN (datacenter IPs are generally fine for the CDN),
runs OCR on frames + ASR on audio (Gemini multimodal or self-hosted Whisper), writes
`media_transcript` text, and **discards the raw bytes** — never warehousing media (Principle III,
sidesteps copyright-reproduction exposure). Tiered: metadata always; transcription only for
high-velocity posts.

## R8 — Node trust & reconciliation

**Decision**: redundant assignment (2–3 nodes/item, per-tenant `redundancy_factor`) + reconciliation:
agreeing submissions are accepted and bump node trust; divergent ones are flagged and decay the
outlier's trust; sustained low trust → `quarantined`. Defends against both platform anti-bot noise
and a deliberately malicious node (Principle VII).

## R9 — Jurisdiction profiles

**Decision**: per-tenant `jurisdiction` key drives retention windows, identity handling (raw-identity
gate), residency region, and in-bounds targets. Launch ships **IN-DPDP** (publicly-available posture,
SDF electoral-risk awareness, India region, 30-day raw-text TTL, raw-identity off). The config is
shaped to also express stricter profiles (e.g. EU/GDPR special-category political-opinion handling)
without code changes, but only IN-DPDP is enabled at launch (Principle VIII).
