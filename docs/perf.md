# Performance Approach (T048) — meeting SC-001 (alert ≤15 min)

The 15-minute detection target (SC-001) is met by keeping each pipeline stage short and
frequent rather than large and slow.

## Latency budget (target, end-to-end ≤ 15 min)
| Stage | Mechanism | Cadence / target |
|---|---|---|
| Comment arrival → stored | IG webhook (push); YT poll | webhook: seconds · YT: ≤10 min poll |
| Stored → classified + embedded | `analyze-comments` (pg_cron) | every 1 min, batch 100 |
| Classified → narrative + alert | `detect-narratives` → `run_detection()` | every 2 min |
| Alert → board | Supabase Realtime | sub-second |

Worst case is dominated by the YouTube poll interval; Instagram (webhook) is near-real-time.

## Scale assumptions (low-thousands accounts)
- YouTube reads use the uploads playlist (1 unit) + `commentThreads` (1 unit) — **never**
  `search` (100 units). A per-run unit budget (`YT_DAILY_UNIT_BUDGET`) stops a run before the
  daily quota is exhausted; remaining channels roll to the next cycle (degrade, don't drop).
- pgvector **HNSW** indexes on `comment.embedding` / `narrative.centroid` keep clustering
  lookups fast as comment volume grows.
- `analyze-comments` is a bounded pull (batch size) so each invocation stays within Edge
  Function time limits; throughput scales by raising cadence/batch.

## How to validate
- Seed `backend/supabase/seed/demo_burst.sql`, then time `run_detection()` → board appearance.
- Under representative load, confirm the analyze backlog (`comment` rows with `embedding is null`)
  stays near zero between runs; if it grows, raise `ANALYZE_BATCH`/cadence or add the Render
  worker escape hatch (research.md R4).

## Escape hatch
If pg_cron micro-batches cannot keep the backlog drained, move ingestion/analysis to a single
always-on **Render background worker** draining pgmq (constitution §Technology). Not needed at
the target scale; documented as the next lever.
