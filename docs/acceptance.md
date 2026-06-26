# Acceptance & Validation Plan

How to prove an OpenPolitics deployment meets its spec. Status: **foundation laid; all surfaces
scaffolded** — the multi-tenant schema (migrations 0001–0007), the coordinator + pipeline Edge
Functions, the MV3 node client, the media-worker, and the React war-room are in place. This document
is the validation **plan** (not a fabricated run record): the commands to run and the assertions each
success criterion and functional requirement maps to.

Run everything against a fresh local stack (`make up && make migrate && make seed && make pipeline`,
see `docs/local-dev.md`) or a provisioned project (`docs/deploy.md`). Tests live in
`backend/supabase/tests/` (Deno + pgTAP), run via `make test`.

## Stack & schema (fresh-DB apply)
- All migrations **0001–0007** apply cleanly on a wiped database (`vector`, `pgmq`, `pg_cron`,
  `pg_net`, `pgcrypto` extensions present), tracked in `_app_migrations`.
- Every tenant-scoped table carries `tenant_id`; **RLS enabled on all of them**, default deny.
- Tenant-scoped views (`security_invoker = on`): `narrative_board`, `coordination_board`,
  `amplifier_targets`, `alert_board`, `node_coverage`.
- `pg_cron` jobs scheduled: `assign-work`, `enrich`, `media-dispatch`, `detect-narratives`,
  `coordination-detect`, `reconcile`, `retention-purge` (`0005_cron.sql`).
- Realtime publication includes `alert`, `narrative`, `coordination_signal`, `node_heartbeat`.

## Success criteria
| SC | Assertion | Validate via |
|----|-----------|--------------|
| **SC-001** | 100% of cross-tenant read/write/enumerate attempts denied at the DB layer | RLS isolation property test (Deno + pgTAP): tenant-A JWT/node token cannot select/insert/update tenant-B rows |
| **SC-002** | Throughput ≈ `nodes × safe-req/node/day`; degrades visibly below target | `node_coverage` view shows active vs target nodes + achieved vs target throughput as simulated nodes drop |
| **SC-003** | Emerging narrative surfaces **before** its engagement peak | seed burst + `make pipeline`: early-warning alert appears with a rising lifecycle state ahead of the seeded peak |
| **SC-004** | 100% of probabilistic outputs carry a confidence/estimate label; coordination always **inferred** | view/contract test: every narrative/coordination/amplifier row returns confidence; coordination labelled inferred |
| **SC-005** | No raw commenter handle and no raw media byte ever persisted; raw text purged on schedule | schema test (`author_raw` null by default, no media bytes column) + retention test (`comment.body`/`media_url` gone after `retention-purge`) |
| **SC-006** | A coordinated burst raises a coordination signal; an isolated post does not | seeded near-dup + shared-`audio_id` burst trips `coordination_detect`; a lone post does not |
| **SC-007** | Board never shows stale data without indicating recency; coverage gaps always shown | freshness banner + `node_coverage` gap shown when node capacity below target |

## Functional requirements (mapping)
| FR | Covered by |
|----|-----------|
| FR-001 public-data-only, logged-out | node client guest-session path; private `tracked_account` flagged + dropped on submit |
| FR-002 `tenant_id` + RLS, no cross-tenant | RLS isolation property test (SC-001) |
| FR-003 tenant-scoped node registration | `node-register` enrolment-code → tenant-scoped node token (hashed) |
| FR-004 rate-capped redundant leases | `work-lease` returns tenant-scoped, rate-capped, redundancy-aware batches |
| FR-005 capture post/metric/comment fields | `submit` normalises into `post` / `post_metric_sample` / `comment` |
| FR-006 velocity re-sampling | `assign-work` prioritises fresh + accelerating posts (`not_before` cadence) |
| FR-007 author HMAC at ingest, raw off by default | `submit`/`enrich` hash authors; `author_raw` null unless gated flag on |
| FR-008 media transcribe-then-discard | media-worker writes `media_transcript`, clears `media_url`; no raw bytes |
| FR-009 cluster into labelled narratives | `detect-narratives` clusters + LLM theme label + lifecycle + confidence |
| FR-010 lifecycle/decay time-series | `narrative_observation` decay curve from multi-sampled volume × velocity |
| FR-011 inferred coordination + HITL | `coordination-detect` fuses temporal/content/shared-audio/author-network; labelled inferred |
| FR-012 amplifier rank + origin + early-warning | `account_narrative_participation` ranking; emerging-narrative alert |
| FR-013 probabilistic = labelled signal | views return confidence; engagement counts labelled proxy-for-reach |
| FR-014 reconcile + node trust | `reconcile` accepts agreement (trust up), flags divergence (trust down → quarantine) |
| FR-015 freshness + coverage gaps visible | `node_coverage` view + freshness banner |
| FR-016 Admin/Analyst RBAC, one tenant | RLS least-privilege policies (`0003_rls.sql`) |
| FR-017 jurisdiction profile | `tenant.jurisdiction = IN-DPDP` drives retention/identity/residency |
| FR-018 auto-purge raw text | `retention-purge` deletes `caption`/`body` at 30 days; keeps derived data |
| FR-019 alert triage live | `alert-triage` (ack/assign/annotate/close) → `alert` Realtime channel |

## Edge cases to exercise
- Decoy narratives / fake coordination → cross-validated across redundant nodes; never asserted proof.
- Burned IP (persistent 401) → node backs off, yields lease, reports coverage gap; item re-leased.
- Account converted to private → detected, flagged `is_private`, dropped (no logged-in fetch).
- Caption-less reel → still captured (metrics + `audio_id`), queued for transcription, not dropped.
- Comment author identity → only `author_hash` persisted by default; same hash enables
  same-actor-across-targets detection.
- Cross-tenant leakage attempt (node or user for tenant A requesting tenant B) → denied at the DB.

## Caveats
- **pgTAP** RLS tests run on a Postgres image with the `pgtap` extension (CI / hosted project); on the
  self-hosted local image without it, the isolation property is exercised by the Deno simulated-JWT /
  node-token tests instead.
- Real live capture + real Gemini/embeddings need live credentials and a residential-IP node; local
  validation runs against the deterministic mock and the seeded vectors.
