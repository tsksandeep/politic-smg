# Feature Specification: Opposition Narrative Intelligence

**Feature Branch**: `001-opposition-intel`

**Created**: 2026-06-26

**Status**: Draft

**Input**: A political organisation (tenant) monitors the **public** Instagram output of its
opposition's cadre and measures what narratives they push, how those narratives rise and decay,
when pushes are coordinated, and who amplifies them — using public-data scraping distributed across
the tenant's own volunteer node network ("IT wing").

## Clarifications

### Session 2026-06-26

- Q: Tenant-isolation model? → A: Shared-schema multi-tenancy with `tenant_id` + RLS; a dedicated
  project-per-tenant "hard-isolation" tier is offered as a premium option.
- Q: Commenter identity handling at launch? → A: HMAC-hash all authors at ingest; a raw-identity
  mode exists only as a per-tenant, jurisdiction-gated, off-by-default flag.
- Q: Launch jurisdiction? → A: India / DPDP only. The multi-jurisdiction config is built; one
  profile ships.
- Q: Node-client distribution? → A: Self-hosted enterprise install of the MV3 browser extension.
- Q: Redundancy factor per tracked account/post? → A: 2–3 nodes, configurable per tenant.
- Q: Raw-text retention default (captions, comment bodies)? → A: 30 days, jurisdiction-configurable;
  derived/anonymised data (hashes, embeddings, narrative/metric time-series) retained longer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Analyst sees what the opposition is pushing (Priority: P1)

A tenant's war-room analyst watches a single live board that names the narratives the opposition's
cadre is currently pushing across their public posts — the claim, the framing, the target, how much
volume each carries, and whether it is rising or fading. The board is scoped strictly to that
tenant; no other tenant's data is ever visible.

**Why this priority**: This is the core intelligence product — "know what they are saying and how it
is moving." Everything else (coordination, amplifiers, alerts) builds on having clustered,
labelled narratives over public opposition content.

**Independent Test**: With a tenant's target list and a handful of registered nodes capturing public
posts, confirm the board shows clustered, human-readable narratives with volume and growth, and that
a second tenant signed in to the same deployment sees none of the first tenant's data.

**Acceptance Scenarios**:

1. **Given** captured public posts from tracked opposition accounts, **When** the enrichment and
   clustering pipeline runs, **Then** the narrative board shows labelled narrative clusters with
   volume, growth, and lifecycle state, each label clearly a generated summary.
2. **Given** two tenants on the same deployment, **When** an analyst of tenant A queries any board,
   detail, or work view, **Then** they see only tenant A's rows — never tenant B's accounts, posts,
   narratives, nodes, or work.
3. **Given** a narrative cluster, **When** the analyst opens it, **Then** they see representative
   captions, contributing accounts (amplifier graph), the audio/hashtag signals, and a confidence
   score — every probabilistic value labelled a signal, not a verdict.

---

### User Story 2 - A volunteer node captures public opposition data (Priority: P1)

A tenant volunteer installs the node browser extension, registers it to the tenant, and the node
leases small batches of work (accounts/posts to capture), fetches the public data over its own
residential IP using an isolated guest session, submits the results, and heartbeats liveness. The
node never logs in and never touches the operator's personal session.

**Why this priority**: This is the data supply for everything. Without nodes there is no capture;
the scaling law ("your IT-wing strength is your scale") lives entirely here.

**Independent Test**: Register one node, lease a batch, capture a public profile + feed via the warm
guest-session path, submit it, and confirm normalised posts/metrics appear for the tenant — with the
operator's logged-in session demonstrably untouched.

**Acceptance Scenarios**:

1. **Given** a registered node, **When** it requests work, **Then** it receives a small, rate-capped
   lease of tracked accounts/posts scoped to its tenant only.
2. **Given** a leased batch, **When** the node captures public data with an isolated guest session
   and submits it, **Then** the coordinator normalises and stores it under the tenant and enqueues
   enrichment.
3. **Given** a cold guest session that returns 401, **When** the node warms it (reload), **Then**
   capture proceeds; if the IP stays blocked, the node backs off and reports a coverage gap rather
   than failing silently.
4. **Given** any capture, **When** it runs, **Then** the node uses only its isolated guest cookie
   jar and never the operator's logged-in cookies or credentials.

---

### User Story 3 - Coordinated-attack and amplifier detection (Priority: P2)

The platform fuses signals — synchronised posting times, near-duplicate captions / identical hashtag
sets, reused reel audio, and same-hashed-author co-pushing — into an **inferred** coordination
signal with a baseline + anomaly threshold, and ranks the accounts that reliably convert a narrative
into engagement velocity (the opposition's key amplifier nodes). A human reviews before any action.

**Why this priority**: Coordination + amplifier identification is the differentiated intelligence,
but it depends on clustered narratives (US1) and multi-sampled metrics (US2) existing first.

**Independent Test**: Inject a set of near-duplicate posts across several tracked accounts in a short
window sharing one `audio_id`; confirm a coordination signal is raised, labelled inferred, with the
contributing accounts and the signal type, and that a single isolated post does not trip it.

**Acceptance Scenarios**:

1. **Given** several tracked accounts posting near-identical captions within a short window,
   **When** coordination detection runs, **Then** a coordination signal is raised naming the type
   (temporal/content/shared-audio/author-network) and contributing accounts, labelled inferred.
2. **Given** narrative participation over time, **When** amplifier ranking runs, **Then** accounts
   are ranked by how reliably they convert a narrative into engagement velocity.
3. **Given** a new cluster crossing a velocity threshold before peak, **When** early-warning runs,
   **Then** an emerging-narrative alert surfaces on the board ahead of the peak.

---

### User Story 4 - Redundancy, reconciliation & node trust (Priority: P3)

Each tracked account/post is assigned to 2–3 nodes. The coordinator reconciles redundant
submissions, flags divergence, and scores node trust over time so a compromised or failing node
cannot silently poison the tenant's metrics; coverage degrades gracefully as nodes churn.

**Why this priority**: It hardens the network against an adaptive adversary and churn, but the
product demonstrates value (US1–US3) before this resilience layer is essential.

**Acceptance Scenarios**:

1. **Given** redundant submissions for the same post, **When** they agree, **Then** the value is
   accepted and contributing nodes gain trust; **When** they diverge, **Then** the divergence is
   flagged and the outlier node's trust decays.
2. **Given** falling active-node count, **When** capacity drops below the target, **Then** coverage
   degrades proportionally and the shortfall is shown on a coverage/scaling-law view — never hidden.

---

### Edge Cases

- **Decoy narratives / fake coordination**: an adaptive target may feed planted content once it
  suspects monitoring — cross-validate across redundant nodes; never trust a single sensor.
- **IP burned mid-run**: a node throttled to a persistent 401 must back off, rotate/yield the lease,
  and surface a coverage gap; the account is re-leased to another node.
- **Private / converted-to-private account**: must be detected and dropped from capture (Principle
  II); never attempt a logged-in fetch.
- **Reels with no caption**: video-only posts must still be captured (metrics + audio_id) and queued
  for transcription rather than dropped.
- **Velocity sampling cost**: high-velocity posts need several samples in their first 24–48h;
  assignment must prioritise fresh + accelerating posts without starving the long tail.
- **Comment author identity**: raw handles must never be persisted by default; the stable hash must
  still allow same-actor-across-targets detection.
- **Cross-tenant leakage attempt**: a node or user acting for tenant A requesting tenant B's work or
  rows must be denied at the database layer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST ingest only data publicly accessible without authenticating into any
  account; nodes MUST use an isolated logged-out guest session and MUST NEVER log in, use
  credentials, or defeat a private gate.
- **FR-002**: Every tenant data row MUST carry a `tenant_id` and MUST be isolated by RLS; a tenant,
  its nodes, and its users MUST NEVER read, write, or enumerate another tenant's data or work.
- **FR-003**: Tenants MUST be able to register browser-extension nodes scoped to exactly one tenant;
  nodes authenticate with a tenant-scoped, revocable node token.
- **FR-004**: The coordinator MUST lease rate-capped, jittered batches of tracked accounts/posts to
  nodes, scoped to the node's tenant, and MUST redundantly assign each item to a configurable 2–3
  nodes.
- **FR-005**: Nodes MUST capture caption text, hashtags, @mentions, post/reel timestamp, like/
  comment/view counts, reel `audio_id`, public comments, follower-count snapshots, and media URLs;
  and MUST submit them to the coordinator with liveness heartbeats.
- **FR-006**: System MUST re-sample engagement metrics for a post several times during its first
  24–48h to measure velocity and decay; assignment MUST prioritise fresh and accelerating posts.
- **FR-007**: System MUST HMAC-hash comment author identity at ingest and MUST NEVER persist the raw
  handle by default; a raw-identity mode MAY exist only as a per-tenant, jurisdiction-gated,
  off-by-default flag.
- **FR-008**: System MUST fetch media centrally, OCR/transcribe it, store derived **text only**
  (`media_transcript`), and MUST NEVER warehouse raw media bytes.
- **FR-009**: System MUST embed captions/transcripts and cluster them into labelled narratives
  (claim/framing/target/register) with volume, growth, lifecycle state, and confidence.
- **FR-010**: System MUST compute per-narrative lifecycle/decay time-series (birth/peak/decay/death,
  half-life, resurgence) from multi-sampled volume × engagement velocity.
- **FR-011**: System MUST detect coordination by fusing temporal, content, shared-audio, and
  author-hash-network signals into an inferred coordination score with a baseline + anomaly
  threshold and a mandatory human-in-the-loop; coordination MUST be labelled inferred.
- **FR-012**: System MUST rank amplifier accounts (those reliably converting a narrative into
  engagement velocity), identify probable origin/patient-zero, and raise emerging-narrative
  early-warning alerts before peak.
- **FR-013**: System MUST present every probabilistic output (narrative confidence, coordination,
  amplifier rank, lifecycle) as a confidence score or estimate, never as definitive fact; engagement
  counts MUST be labelled a proxy for reach.
- **FR-014**: System MUST redundantly reconcile submissions, flag divergence, and maintain a per-node
  trust score that decays on divergence/error/anomaly; low-trust nodes MUST be down-weighted.
- **FR-015**: System MUST make data freshness and coverage gaps visible; coverage MUST degrade
  proportionally to node capacity and MUST NEVER silently under-report.
- **FR-016**: System MUST restrict access to a tenant's authorised staff only, supporting two
  least-privilege roles — **Admin** (manages tenant users, nodes, target list, settings) and
  **Analyst** (monitors boards and triages) — both scoped to one tenant.
- **FR-017**: Each tenant MUST declare a jurisdiction profile that drives retention, identity
  handling, residency, and in-bounds targets; the launch profile is India / DPDP.
- **FR-018**: System MUST automatically purge raw text (captions, comment bodies) on the tenant's
  retention schedule (default 30 days); anonymised/derived data MAY be retained longer.
- **FR-019**: Analysts MUST be able to acknowledge, assign, annotate, and close alerts, with status
  changes reflected live to other analysts of the same tenant.

### Key Entities *(include if feature involves data)*

- **Tenant**: a customer political organisation; the isolation root for all data.
- **Tenant User**: Admin or Analyst staff member scoped to one tenant.
- **Node**: a registered IT-wing browser node (tenant-scoped) with a trust score and heartbeat.
- **Tracked Account**: an opposition account a tenant watches — the capture target.
- **Work Assignment**: an account/post leased to a node (with redundancy factor).
- **Submission**: a raw node submission, pre-reconciliation.
- **Account Snapshot**: follower-count + profile metrics over time (trend).
- **Post**: a captured public post/reel (caption, taken_at, audio_id, permalink).
- **Post Metric Sample**: time-series like/comment/view per post (velocity/decay).
- **Hashtag / Mention**: entities derived from captions.
- **Media Transcript**: OCR/ASR text for a post (raw media not stored).
- **Comment**: a public comment with HMAC author hash, body (TTL), sentiment, embedding.
- **Narrative**: a cluster — centroid, volume, growth, coordination_score, lifecycle_state, stance.
- **Narrative Observation**: a time-series point per narrative (decay curve).
- **Account Narrative Participation**: which accounts carry which narrative (amplifier graph).
- **Coordination Signal**: a flagged synchrony/content/audio/author-network event (inferred).
- **Alert**: a war-room event (emerging narrative / coordinated attack) + triage lifecycle.
- **Detection Settings**: per-tenant tunable thresholds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tenant isolation holds under test — 100% of cross-tenant read/write/enumerate attempts
  are denied at the database layer.
- **SC-002**: With a tenant's target list and N nodes, the platform sustains capture throughput of
  roughly `N × safe-requests-per-node-per-day`, degrading gracefully (and visibly) below target node
  count.
- **SC-003**: An emerging narrative crossing the velocity threshold surfaces on the board **before**
  its engagement peak in a representative replay.
- **SC-004**: 100% of probabilistic outputs shown carry a visible confidence/estimate label;
  coordination is always labelled inferred.
- **SC-005**: No raw commenter handle and no raw media byte is ever persisted (verified by schema +
  retention tests); raw text is purged on schedule.
- **SC-006**: A coordinated burst (near-duplicate captions + shared audio across accounts in a short
  window) raises a coordination signal; a single isolated post does not.
- **SC-007**: The board never shows stale data without indicating recency, and coverage gaps are
  always shown when node capacity is below target.

## Assumptions

- **Scale is a recruiting function**: throughput scales with the tenant's node count, not our infra;
  coverage degrades gracefully, never silently, below target node count.
- **Coordination is inference, not proof**: always labelled, human-in-the-loop mandatory.
- **Reels are video-heavy**: transcription is the heaviest pipeline; tier it (metadata always,
  transcription for high-velocity posts).
- **Legal posture is public-data-only, logged-out**; residual risk is primarily political (an
  opposition complaint) and is tenant-owned, per jurisdiction.
- **Launch jurisdiction is India / DPDP**; the multi-jurisdiction config is built but one profile
  ships.
- **Language**: Tamil, English, and Tamil–English code-mixed content are in scope for the pilot.
