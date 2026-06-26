# Data Model: Opposition Narrative Intelligence

Shared-schema multi-tenant Postgres on Supabase. **Every tenant-scoped table carries `tenant_id`**
and is governed by RLS so a tenant — and its nodes and users — can only ever touch its own rows
(Principle I). Embeddings use `pgvector` (768-dim). Raw commenter handles and raw media bytes are
**never** stored (Principle III).

## Conventions

- Surrogate keys are UUIDs unless noted.
- `tenant_id uuid not null references tenant(id)` appears on every tenant-scoped table; composite
  indexes lead with `tenant_id`.
- `author_hash` is a keyed HMAC of the source handle, computed **before** insert; the raw handle is
  never stored.
- Timestamps are `timestamptz`.
- "raw text" columns (`post.caption`, `comment.body`) are subject to the retention purge (FR-018).
- RLS predicate helper: `tenant_id = current_tenant()` where `current_tenant()` resolves the caller's
  tenant from their JWT claim (users) or node token (nodes). Service role bypasses RLS.

## Identity & tenancy

### tenant
The isolation root — a customer political organisation.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| name | text | display name |
| jurisdiction | text | profile key, e.g. `IN-DPDP` (FR-017) |
| redundancy_factor | int | nodes per assignment, default 3 (2–3) |
| raw_identity_enabled | bool | default false; jurisdiction-gated (Principle III) |
| status | enum(active, suspended) | |
| created_at | timestamptz | |

### tenant_user
Tenant staff; maps 1:1 to a Supabase auth user, scoped to one tenant (FR-016).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | references auth.users(id) |
| tenant_id | uuid (fk → tenant) | |
| role | enum(admin, analyst) | |
| created_at | timestamptz | |
- Rule: a user belongs to exactly one tenant; `current_tenant()` reads this for RLS.

### node
A registered IT-wing browser node (Principle IV, VII).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk → tenant) | |
| label | text | operator-visible name |
| token_hash | text | HMAC of the node's bearer token; raw token shown once at register |
| trust_score | real | 0–1, default 0.5; decays on divergence/error (FR-014) |
| status | enum(active, quarantined, revoked) | low-trust → quarantined |
| last_seen_at | timestamptz | from heartbeat |
| created_at | timestamptz | |

### node_heartbeat
Liveness + health time-series (FR-015).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| node_id | uuid (fk → node) | |
| at | timestamptz | |
| ok_count | int | successful captures since last beat |
| error_count | int | 401/429/other |
| ip_status | enum(healthy, throttled, blocked) | drives coverage-gap reporting |

## Capture targets & work

### tracked_account
An opposition account a tenant watches — the capture target (replaces any consent/own-account model).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| platform | enum(instagram) | youtube deferred |
| handle | text | public handle |
| external_id | text null | resolved numeric user id |
| is_private | bool | if true → dropped from capture (Principle II) |
| priority | int | assignment weighting |
| added_by | uuid (fk → tenant_user) | |
| created_at | timestamptz | |
| unique (tenant_id, platform, handle) | | |

### work_assignment
An account or post leased to a node, with redundancy (FR-004, FR-006).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| node_id | uuid (fk → node) null | null until leased |
| target_kind | enum(account, post_metrics, comments) | what to capture |
| tracked_account_id | uuid (fk) null | |
| post_id | uuid (fk) null | for metric re-sampling / comments |
| redundancy_index | int | 1..redundancy_factor |
| state | enum(pending, leased, submitted, expired) | |
| lease_expires_at | timestamptz null | |
| not_before | timestamptz | scheduling / velocity cadence (FR-006) |
| created_at | timestamptz | |

### submission
A raw node submission, pre-reconciliation (Principle VI/VII).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| node_id | uuid (fk → node) | |
| work_assignment_id | uuid (fk) | |
| payload | jsonb | normalised capture (no raw media, no raw handles) |
| captured_at | timestamptz | |
| reconciled | bool | default false |
| diverged | bool | set if it disagreed with redundant peers (FR-014) |

## Captured data

### account_snapshot
Follower-count + profile metrics over time → trend (FR-005).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| tracked_account_id | uuid (fk) | |
| at | timestamptz | |
| followers | bigint | |
| following | bigint | |
| posts_count | int | |

### post
A captured public post/reel (FR-005).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| tracked_account_id | uuid (fk) | |
| shortcode | text | platform shortcode |
| permalink | text | |
| is_video | bool | reel vs image |
| caption | text null | **raw text — purged on retention schedule** (FR-018) |
| audio_id | text null | reel audio cluster key — **shared-audio coordination signal** |
| taken_at | timestamptz | lifecycle anchor |
| media_url | text null | transient; consumed by media worker then cleared |
| caption_embedding | vector(768) null | for clustering |
| narrative_id | uuid (fk → narrative) null | cluster assignment |
| first_seen_at | timestamptz | |
| last_sampled_at | timestamptz | freshness (FR-015) |
| unique (tenant_id, shortcode) | | |

### post_metric_sample
Time-series engagement per post → velocity/decay (FR-006). Multi-sampled.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| post_id | uuid (fk) | |
| at | timestamptz | |
| like_count | bigint | proxy for reach (Principle V) |
| comment_count | bigint | |
| view_count | bigint null | reels |

### hashtag / mention
Derived caption entities (FR-005) — coordination via identical hashtag sets.
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| post_id | uuid (fk) | |
| value | text | `#tag` or `@handle` (mention handles are public account refs, not commenters) |
| kind | enum(hashtag, mention) | |

### media_transcript
OCR/ASR text for a post — **raw media NOT stored** (FR-008, Principle III).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| post_id | uuid (fk) | |
| kind | enum(ocr, asr) | frames vs audio |
| text | text | derived transcript (joined into clustering) |
| transcript_embedding | vector(768) null | |
| created_at | timestamptz | |

### comment
A public comment. Author identity stored only as a keyed hash (FR-007).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| post_id | uuid (fk) | |
| author_hash | text | HMAC; raw handle never stored. Raw handle only if `tenant.raw_identity_enabled` |
| author_raw | text null | **off by default**; only populated when jurisdiction-gated flag on |
| body | text null | **raw text — purged on retention schedule** (FR-018) |
| created_at | timestamptz | source comment time |
| ingested_at | timestamptz | |
| embedding | vector(768) null | |
| sentiment | enum(hostile, neutral, positive) null | |
| sentiment_confidence | real null | 0–1 (FR-013) |
| language | text null | ta / en / mixed |

## Analytics

### narrative
A semantic cluster of opposition posts/comments (FR-009/010).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| centroid | vector(768) | cluster centroid |
| theme_summary | text null | LLM-generated label (claim/framing/target) |
| stance | enum(opposition_attack, opposition_promote, neutral) | what the cluster is doing |
| volume | int | post+comment count in window |
| growth_rate | real | rate of change |
| coordination_score | real null | 0–1 inferred (FR-011) |
| confidence | real null | 0–1 (FR-013) |
| lifecycle_state | enum(emerging, peaking, decaying, dormant, resurgent) | (FR-010) |
| half_life_hours | real null | decay estimate |
| first_seen_at | timestamptz | |
| last_updated_at | timestamptz | |

### narrative_observation
Time-series point per narrative → decay curve (FR-010).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| narrative_id | uuid (fk) | |
| at | timestamptz | |
| volume | int | new posts in window |
| velocity | real | engagement velocity (Δengagement / Δt) |

### account_narrative_participation
Which accounts carry which narrative — the amplifier graph (FR-012).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| tracked_account_id | uuid (fk) | |
| narrative_id | uuid (fk) | |
| post_count | int | contributions to the cluster |
| amplification_score | real | how reliably this account converts the narrative into velocity |
| is_origin | bool | probable patient-zero for the cluster |
| unique (tenant_id, tracked_account_id, narrative_id) | | |

### coordination_signal
A flagged synchrony/content/audio/author-network event — **inferred** (FR-011).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| narrative_id | uuid (fk) null | |
| signal_type | enum(temporal, content, shared_audio, author_network) | |
| score | real | 0–1 vs baseline |
| baseline | real | expected level |
| account_ids | uuid[] | contributing tracked accounts |
| evidence | jsonb | e.g. shared audio_id, near-dup caption pairs |
| detected_at | timestamptz | |

### alert
A war-room event (emerging narrative / coordinated attack) + triage (FR-012/019).
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (pk) | |
| tenant_id | uuid (fk) | |
| kind | enum(emerging_narrative, coordinated_attack) | |
| narrative_id | uuid (fk) null | |
| coordination_signal_id | uuid (fk) null | |
| status | enum(open, acknowledged, closed) | |
| assignee_user_id | uuid (fk → tenant_user) null | |
| detected_at | timestamptz | |
| acknowledged_at | timestamptz null | |
| closed_at | timestamptz null | |
| response_note | text null | |
| response_latency | interval (generated) | `closed_at − detected_at` (FR-019) |

### detection_settings
Per-tenant tunable thresholds (FR-011, one row per tenant).
| Field | Type | Notes |
|-------|------|-------|
| tenant_id | uuid (pk, fk → tenant) | one row per tenant |
| emerging_velocity_threshold | real | early-warning trip (FR-012) |
| coordination_window | interval | synchrony window |
| coordination_min_accounts | int | distinct accounts for coordination |
| min_cluster_volume | int | narrative materiality floor |
| sim_threshold | real | cosine-distance cut-off for clustering (default 0.25; raise to ~0.4–0.5 for short/code-mixed text) |
| updated_by | uuid (fk → tenant_user) null | Admin only |
| updated_at | timestamptz | |

## Supporting (operational)

- **pgmq queues**: `enrich_jobs` (embed/classify/hash), `media_jobs` (OCR/ASR), `reconcile_jobs`
  (+ DLQs).
- **pg_cron jobs**: `enrich`, `media-dispatch`, `detect-narratives`, `coordination-detect`,
  `assign-work` (velocity-aware), `reconcile-submissions`, `retention-purge`.
- **app_config**: service-role-only key/value (hash key handle, etc.); not tenant data.

## Tenant-scoped views (security_invoker = on)

- **narrative_board**: tenant's narratives with `performance_score` and `lifecycle_state` + data
  freshness. Primary US1 surface.
- **alert_board**: open/acknowledged alerts ⋈ narrative/coordination signal, with `data_fresh_as_of`.
- **amplifier_targets**: ranked `account_narrative_participation` per narrative.
- **coordination_board**: recent coordination signals with type/score/contributing accounts.
- **node_coverage**: per-tenant active nodes, target node count, achieved vs target throughput,
  coverage gaps (FR-015, the scaling-law view).

## Entity relationships

```text
tenant 1—N tenant_user
tenant 1—N node 1—N node_heartbeat
tenant 1—N tracked_account 1—N post 1—N {post_metric_sample, comment, media_transcript, hashtag/mention}
tenant 1—N work_assignment 1—N submission        (node executes assignment → submission)
post N—1 narrative 1—N {narrative_observation, coordination_signal, alert}
tracked_account N—N narrative  (via account_narrative_participation)
```

## Retention & isolation rules (cross-cutting)

- RLS ON for every tenant table; predicate `tenant_id = current_tenant()`; default deny. Cross-tenant
  access denied at the DB layer (Principle I, SC-001).
- `post.caption`, `comment.body`, and any `media_url` purged on the tenant's retention schedule
  (default 30 days); `media_url` cleared as soon as the media worker emits a transcript (Principle
  III, FR-008/018).
- `comment.author_raw` only ever populated when `tenant.raw_identity_enabled` is true AND the
  jurisdiction profile permits it; otherwise the column stays null and only `author_hash` exists.
- Node-facing RLS: a node token resolves to its `node.tenant_id`; a node may read only its own leases
  and write only its own submissions/heartbeats.
