# Performance Approach — emerging narrative before peak (SC-003)

The platform's headline timing target is **SC-003**: an emerging narrative crossing the velocity
threshold surfaces on the board **before** its engagement peak. That is met by keeping each pipeline
stage short and frequent rather than large and slow, and by prioritising fresh + accelerating posts in
capture. Throughput itself is bounded by node count, not by our infrastructure (SC-002).

## Latency budget (capture → board)
| Stage | Mechanism | Cadence / target |
|---|---|---|
| Public post → captured | Node `work-lease` → `submit` | bounded by node capacity + per-node rate cap; redundant 2–3 nodes |
| Captured → reconciled | `reconcile` (pg_cron) | every ~5 min; agreeing redundant submissions accepted |
| Captured → embedded + classified | `enrich` drains `enrich_jobs` (pg_cron) | every ~1 min |
| Media → transcript | `media-worker` drains `media_jobs` | always-on; tiered (high-velocity posts first) |
| Enriched → narrative + lifecycle + early-warning | `detect-narratives` (pg_cron) | every ~3 min |
| Enriched → inferred coordination | `coordination-detect` (pg_cron) | every ~5 min |
| Narrative/alert → board | Supabase Realtime (`narrative` / `alert` / `coordination_signal`) | sub-second |

The early-warning trip (`detection_settings.emerging_velocity_threshold`) fires inside
`detect-narratives` on the multi-sampled volume × velocity curve, so a cluster is flagged on the way
up rather than at the peak.

## Scale assumptions
- **Throughput is recruiting, not infra** (SC-002): `≈ active_nodes × safe_requests/node/day`. Below
  target node count, coverage degrades proportionally and the `node_coverage` view shows the gap —
  never silent under-reporting (Principle IX).
- **Velocity sampling is the cost driver** (research R3): engagement counts are snapshots, so high-
  velocity posts are re-sampled several times in their first 24–48h. `assign-work` prioritises fresh +
  accelerating posts via `work_assignment.not_before`, tapering cadence as a post ages, without
  starving the long tail.
- **pgvector HNSW indexes** (`0002_vector.sql`) on caption/transcript/comment embeddings and
  `narrative.centroid` keep clustering lookups fast as volume grows.
- **Bounded pulls**: `enrich` and the analytics functions process bounded batches per invocation so
  each stays within Edge Function time limits; throughput scales by raising cadence/batch.
- **Media tiering**: transcription is the heaviest stage, so it is tiered — metadata always,
  OCR/ASR prioritised for high-velocity posts — keeping the media worker from becoming the bottleneck.

## How to validate
- Seed `backend/supabase/seed/demo_tenant.sql` (includes a coordination burst on tenant A), run
  `make pipeline`, and confirm the emerging narrative appears on the board with a rising lifecycle
  state and an early-warning alert before the seeded peak.
- Under representative load, confirm the enrich backlog (`comment`/`post` rows with `embedding is
  null`) stays near zero between runs; if it grows, raise the enrich batch/cadence.
- Watch `node_coverage`: as simulated nodes drop, achieved throughput should fall below target with
  the gap shown explicitly (SC-007).
