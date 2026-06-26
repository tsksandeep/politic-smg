# The Node Network — the tenant's "IT wing"

OpenPolitics does not scrape from its own infrastructure. All public capture is distributed across a
tenant's own **volunteer node network**: an MV3 browser extension running on volunteers' machines, on
their **residential IPs**, capturing public opposition data through an **isolated logged-out guest
session**. The network is the data supply for everything, and it is the scaling law:

> **your IT-wing strength is your scale** — throughput per tenant ≈ (active nodes) × (safe requests /
> node / day)

This document is the volunteer node model: how it installs, how it stays safe, how it is rate-limited,
how redundancy and trust keep it honest, and how coverage degrades gracefully.

---

## 1. Install (self-hosted enterprise distribution)

The node client is distributed by **self-hosted enterprise install**, not a public store:

1. The tenant builds `extension/` and hosts the package + update manifest on its own server.
2. It is pushed to volunteer machines via enterprise browser policy
   (`ExtensionInstallForcelist` / `ExtensionSettings` on Chromium; the equivalent on Firefox).
3. A tenant **Admin** issues a **tenant enrolment code**. Each operator registers their node **once**:
   the node calls `node-register` with the code and an operator-chosen label, and receives a
   tenant-scoped **node token** — shown once, stored thereafter only as a hash (`node.token_hash`).
4. From then on the node authenticates every coordinator call with `Authorization: Bearer
   <node_token>`. The token maps to exactly one node, hence one tenant; it carries no user session and
   is **revocable** by the Admin at any time.

---

## 2. Safety — the operator comes before throughput (Principle IV)

The node protects its operator above all else. These are hard rules in the client, not settings:

- **Never log in. Ever.** Capture uses only public, logged-out endpoints. The node never submits
  credentials, never uses anyone's account, and never tries to defeat a private gate, paywall, or
  follower-only restriction. A target that has gone private is reported and **dropped** from capture.
- **Isolated guest cookie jar.** The node maintains its own logged-out cookie jar for the target
  platform and **never touches, reads, or reuses the operator's logged-in session or personal
  cookies**. The operator's own accounts are invisible to the node.
- **One-way, minimal egress.** The node talks only to the coordinator (`work-lease` / `submit` /
  `heartbeat`), sending normalised captures. It receives only its current lease.
- **"Dumb" node.** The node holds **no tenant data beyond its current lease** and runs no analytics.
  Narratives, coordination, amplifiers — all of that lives in the backend. A node that is lost or
  compromised exposes at most one small lease, never the tenant's intelligence.

Volunteers lend their residential IPs at personal risk; a node that endangered an operator's personal
account would destroy the very network the platform depends on.

---

## 3. Rate caps + jitter (Principle IV, IX)

IP reputation is the physical ceiling, so the node scales by **count, not request rate**. Each node
enforces a server-issued budget (returned by `node-register` / `work-lease`):

- `max_requests_per_day` — the safe daily ceiling (~100 guest-requests/node/day as a baseline).
- `min_interval_ms` + `jitter_ms` — a minimum gap between requests with randomised jitter, so traffic
  never looks metronomic.

The capture path warms a logged-out guest session (the first data XHR on a cold session returns a
`401`; a page **navigation/reload** re-establishes it → `200`). If an IP throttles to a **persistent
401** ("IP burned"), the node:

1. backs off,
2. **yields the lease** so the assignment returns to `pending` and is re-leased to another node, and
3. reports the condition on its heartbeat (`ip_status: blocked`), which surfaces a **coverage gap** —
   never a silent under-report (Principle IX).

---

## 4. Redundancy, reconciliation & trust (Principles VI, VII)

This is offensive intelligence against an adaptive adversary, so no single node is ever trusted as
ground truth:

- **Redundant assignment.** Each tracked account/post is assigned to **2–3 nodes** (per-tenant
  `redundancy_factor`). A node never receives two redundancy copies of the same item.
- **Reconciliation.** `reconcile` compares redundant `submission` rows for the same logical target.
  Agreement → the value is accepted and contributing nodes **gain trust**; divergence → the row is
  flagged `diverged`, the outlier is identified, and its trust **decays**.
- **Trust score.** Every node carries a `trust_score` (0–1, default 0.5) that decays on divergence,
  errors, or anomalous output and recovers on consistent agreement. Sustained low trust →
  `node.status = quarantined`: the node stops being leased work and stops influencing metrics.
- **Anti-poisoning.** Because no single submission is authoritative, a compromised or failing node
  **cannot silently poison** a tenant's metrics — it is out-voted and down-weighted. Targets that
  plant decoy narratives or fake coordination once they suspect monitoring are countered the same way:
  cross-validate across redundant nodes, randomise sampling cadence, never assert proof.

---

## 5. The scaling law & graceful degradation

Throughput is roughly linear in node count:

| Active nodes | Approx coverage (@ ~100 safe req/node/day) |
|---|---|
| ~30 | ~250 accounts at a 2-hour cadence |
| ~100 | ~800 accounts |
| ~500 | a full 10k-account target at ~5-hour cadence |

Scale is the tenant's **recruiting** problem, not the platform's infra bill — grow the IT wing, grow
the coverage. Velocity sampling is the main cost knob: engagement counts are snapshots, so high-
velocity posts are re-sampled several times in their first 24–48h to measure velocity and decay, and
`assign-work` prioritises **fresh + accelerating** posts without starving the long tail.

When active-node count drops below target, **coverage degrades proportionally and visibly**: the
`node_coverage` view shows active nodes vs target, achieved vs target throughput, and the current
coverage gaps, and the board marks data freshness. The system never fails closed without saying so
(Principle IX) — a visible gap is always better than a silent "all clear".
