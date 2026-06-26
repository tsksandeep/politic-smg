-- 0001_schema.sql — base schema for OpenPolitics, the Opposition Narrative Intelligence Platform.
-- Shared-schema multi-tenancy: every tenant-scoped table carries tenant_id and is RLS-isolated
-- (Principle I). Raw commenter handles and raw media bytes are NEVER stored (Principle III).
-- Vector columns + HNSW indexes are added in 0002_vector.sql. RLS in 0003_rls.sql.

create extension if not exists "pgcrypto"; -- gen_random_uuid()
create extension if not exists "vector";   -- pgvector (columns added in 0002)

-- ============================ Identity & tenancy ============================

-- The isolation root: a customer political organisation.
create table if not exists tenant (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  jurisdiction      text not null default 'IN-DPDP',          -- profile key (Principle VIII)
  redundancy_factor int  not null default 3 check (redundancy_factor between 1 and 5),
  raw_identity_enabled boolean not null default false,        -- jurisdiction-gated (Principle III)
  status            text not null default 'active' check (status in ('active','suspended')),
  created_at        timestamptz not null default now()
);

-- Tenant staff; maps 1:1 to a Supabase auth user, scoped to exactly one tenant (FR-016).
create table if not exists tenant_user (
  id          uuid primary key references auth.users (id) on delete cascade,
  tenant_id   uuid not null references tenant (id) on delete cascade,
  role        text not null check (role in ('admin','analyst')),
  created_at  timestamptz not null default now()
);

-- A registered IT-wing browser node (Principle IV/VII). The raw bearer token is shown once at
-- registration and only its HMAC (token_hash) is stored.
create table if not exists node (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id) on delete cascade,
  label        text not null,
  token_hash   text not null unique,
  trust_score  real not null default 0.5 check (trust_score between 0 and 1),
  status       text not null default 'active' check (status in ('active','quarantined','revoked')),
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Liveness + health time-series (FR-015 — drives coverage-gap reporting).
create table if not exists node_heartbeat (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant (id) on delete cascade,
  node_id     uuid not null references node (id) on delete cascade,
  at          timestamptz not null default now(),
  ok_count    int not null default 0,
  error_count int not null default 0,
  ip_status   text not null default 'healthy' check (ip_status in ('healthy','throttled','blocked'))
);

-- ============================ Capture targets & work ============================

-- An opposition account a tenant watches — the capture target (Principle II: public only).
create table if not exists tracked_account (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id) on delete cascade,
  platform     text not null default 'instagram' check (platform in ('instagram')),
  handle       text not null,
  external_id  text,
  is_private   boolean not null default false,   -- if true → dropped from capture (Principle II)
  priority     int not null default 0,
  added_by     uuid references tenant_user (id),
  created_at   timestamptz not null default now(),
  unique (tenant_id, platform, handle)
);

-- An account/post leased to a node, with redundancy + velocity cadence (FR-004/006).
create table if not exists work_assignment (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant (id) on delete cascade,
  node_id            uuid references node (id) on delete set null,
  target_kind        text not null check (target_kind in ('account','post_metrics','comments')),
  tracked_account_id uuid references tracked_account (id) on delete cascade,
  post_id            uuid,                          -- fk added after post table exists (below)
  redundancy_index   int not null default 1,
  state              text not null default 'pending'
                       check (state in ('pending','leased','submitted','expired')),
  lease_expires_at   timestamptz,
  not_before         timestamptz not null default now(),   -- velocity scheduling (FR-006)
  created_at         timestamptz not null default now()
);

-- A raw node submission, pre-reconciliation (Principle VI/VII). No raw media, no raw handles.
create table if not exists submission (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant (id) on delete cascade,
  node_id            uuid not null references node (id) on delete cascade,
  work_assignment_id uuid not null references work_assignment (id) on delete cascade,
  payload            jsonb not null default '{}'::jsonb,
  captured_at        timestamptz not null default now(),
  reconciled         boolean not null default false,
  diverged           boolean not null default false
);

-- ============================ Analytics: narratives ============================
-- (declared before post/comment so their narrative_id FKs resolve)

-- A semantic cluster of opposition posts/comments (FR-009/010). centroid added in 0002.
create table if not exists narrative (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant (id) on delete cascade,
  theme_summary      text,
  stance             text not null default 'opposition_attack'
                       check (stance in ('opposition_attack','opposition_promote','neutral')),
  volume             int not null default 0,
  growth_rate        real not null default 0,
  coordination_score real,        -- 0..1 inferred (FR-011)
  confidence         real,        -- 0..1 (FR-013)
  lifecycle_state    text not null default 'emerging'
                       check (lifecycle_state in ('emerging','peaking','decaying','dormant','resurgent')),
  half_life_hours    real,
  first_seen_at      timestamptz not null default now(),
  last_updated_at    timestamptz not null default now()
);

-- ============================ Captured data ============================

-- Follower-count + profile metrics over time → trend (FR-005).
create table if not exists account_snapshot (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant (id) on delete cascade,
  tracked_account_id uuid not null references tracked_account (id) on delete cascade,
  at                 timestamptz not null default now(),
  followers          bigint,
  following          bigint,
  posts_count        int
);

-- A captured public post/reel (FR-005). caption is raw text (purged on retention schedule).
create table if not exists post (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant (id) on delete cascade,
  tracked_account_id uuid not null references tracked_account (id) on delete cascade,
  shortcode          text not null,
  permalink          text,
  is_video           boolean not null default false,
  caption            text,                          -- RAW TEXT — purged on retention schedule (FR-018)
  audio_id           text,                          -- reel audio cluster key (shared-audio signal)
  taken_at           timestamptz,                   -- lifecycle anchor
  media_url          text,                          -- transient; cleared once transcript emitted (FR-008)
  narrative_id       uuid references narrative (id) on delete set null,
  first_seen_at      timestamptz not null default now(),
  last_sampled_at    timestamptz,                   -- freshness (FR-015)
  unique (tenant_id, shortcode)
);

-- now that post exists, wire work_assignment.post_id
alter table work_assignment
  add constraint work_assignment_post_fk
  foreign key (post_id) references post (id) on delete cascade;

-- Time-series engagement per post → velocity/decay (FR-006). Multi-sampled.
create table if not exists post_metric_sample (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant (id) on delete cascade,
  post_id       uuid not null references post (id) on delete cascade,
  at            timestamptz not null default now(),
  like_count    bigint,                             -- proxy for reach (Principle V)
  comment_count bigint,
  view_count    bigint
);

-- Derived caption entities (FR-005) — coordination via identical hashtag sets.
create table if not exists post_entity (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id) on delete cascade,
  post_id   uuid not null references post (id) on delete cascade,
  kind      text not null check (kind in ('hashtag','mention')),
  value     text not null
);

-- OCR/ASR text for a post — RAW MEDIA NOT STORED (FR-008, Principle III). embedding added in 0002.
create table if not exists media_transcript (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant (id) on delete cascade,
  post_id    uuid not null references post (id) on delete cascade,
  kind       text not null check (kind in ('ocr','asr')),
  text       text not null,
  created_at timestamptz not null default now()
);

-- A public comment. Author identity stored ONLY as a keyed hash (FR-007). embedding added in 0002.
create table if not exists comment (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenant (id) on delete cascade,
  post_id              uuid not null references post (id) on delete cascade,
  author_hash          text not null,            -- HMAC; raw handle NEVER stored
  author_raw           text,                     -- OFF by default; only if tenant.raw_identity_enabled
  body                 text,                     -- RAW TEXT — purged on retention schedule (FR-018)
  created_at           timestamptz,              -- source comment time
  ingested_at          timestamptz not null default now(),
  sentiment            text check (sentiment in ('hostile','neutral','positive')),
  sentiment_confidence real,                     -- 0..1 (FR-013)
  language             text,                     -- ta | en | mixed
  narrative_id         uuid references narrative (id) on delete set null
);

-- ============================ Analytics: derived ============================

-- Time-series point per narrative → decay curve (FR-010).
create table if not exists narrative_observation (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id) on delete cascade,
  narrative_id uuid not null references narrative (id) on delete cascade,
  at           timestamptz not null default now(),
  volume       int not null default 0,
  velocity     real not null default 0           -- engagement velocity (Δengagement / Δt)
);

-- Which accounts carry which narrative — the amplifier graph (FR-012).
create table if not exists account_narrative_participation (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant (id) on delete cascade,
  tracked_account_id  uuid not null references tracked_account (id) on delete cascade,
  narrative_id        uuid not null references narrative (id) on delete cascade,
  post_count          int not null default 0,
  amplification_score real not null default 0,
  is_origin           boolean not null default false,
  unique (tenant_id, tracked_account_id, narrative_id)
);

-- A flagged synchrony/content/audio/author-network event — INFERRED (FR-011).
create table if not exists coordination_signal (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id) on delete cascade,
  narrative_id uuid references narrative (id) on delete set null,
  signal_type  text not null
                 check (signal_type in ('temporal','content','shared_audio','author_network')),
  score        real not null,                    -- 0..1 vs baseline
  baseline     real not null default 0,
  account_ids  uuid[] not null default '{}',
  evidence     jsonb not null default '{}'::jsonb,
  detected_at  timestamptz not null default now()
);

-- A war-room event (emerging narrative / coordinated attack) + triage lifecycle (FR-012/019).
create table if not exists alert (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id) on delete cascade,
  kind                   text not null check (kind in ('emerging_narrative','coordinated_attack')),
  narrative_id           uuid references narrative (id) on delete cascade,
  coordination_signal_id uuid references coordination_signal (id) on delete set null,
  status                 text not null default 'open' check (status in ('open','acknowledged','closed')),
  assignee_user_id       uuid references tenant_user (id) on delete set null,
  detected_at            timestamptz not null default now(),
  acknowledged_at        timestamptz,
  closed_at              timestamptz,
  response_note          text,
  response_latency       interval generated always as (closed_at - detected_at) stored
);

-- Per-tenant tunable detection thresholds (FR-011), one row per tenant.
create table if not exists detection_settings (
  tenant_id                   uuid primary key references tenant (id) on delete cascade,
  emerging_velocity_threshold real not null default 2.0,
  coordination_window         interval not null default '30 minutes',
  coordination_min_accounts   int not null default 4,
  min_cluster_volume          int not null default 5,
  -- cosine-distance cut-off for assigning a post/comment to an existing narrative (smaller = more
  -- similar). Tune per tenant: ~0.25 is tight; 0.4–0.5 groups short / code-mixed multilingual text.
  sim_threshold               real not null default 0.25 check (sim_threshold > 0 and sim_threshold < 1),
  updated_by                  uuid references tenant_user (id),
  updated_at                  timestamptz not null default now()
);

-- ============================ Indexes (tenant-leading) ============================
create index if not exists idx_node_tenant            on node (tenant_id);
create index if not exists idx_heartbeat_node         on node_heartbeat (tenant_id, node_id, at desc);
create index if not exists idx_tracked_tenant         on tracked_account (tenant_id);
create index if not exists idx_assignment_lease       on work_assignment (tenant_id, state, not_before);
create index if not exists idx_assignment_node        on work_assignment (tenant_id, node_id);
create index if not exists idx_submission_assignment  on submission (tenant_id, work_assignment_id);
create index if not exists idx_snapshot_account       on account_snapshot (tenant_id, tracked_account_id, at desc);
create index if not exists idx_post_account           on post (tenant_id, tracked_account_id);
create index if not exists idx_post_audio             on post (tenant_id, audio_id);
create index if not exists idx_post_narrative         on post (tenant_id, narrative_id);
create index if not exists idx_metric_post            on post_metric_sample (tenant_id, post_id, at desc);
create index if not exists idx_entity_post            on post_entity (tenant_id, post_id);
create index if not exists idx_entity_value           on post_entity (tenant_id, kind, value);
create index if not exists idx_transcript_post        on media_transcript (tenant_id, post_id);
create index if not exists idx_comment_post           on comment (tenant_id, post_id);
create index if not exists idx_comment_author         on comment (tenant_id, author_hash);
create index if not exists idx_comment_narrative      on comment (tenant_id, narrative_id);
create index if not exists idx_comment_ingested       on comment (tenant_id, ingested_at);
create index if not exists idx_observation_narrative  on narrative_observation (tenant_id, narrative_id, at desc);
create index if not exists idx_participation_narrative on account_narrative_participation (tenant_id, narrative_id);
create index if not exists idx_coordination_tenant    on coordination_signal (tenant_id, detected_at desc);
create index if not exists idx_alert_status           on alert (tenant_id, status);
create index if not exists idx_narrative_tenant       on narrative (tenant_id, last_updated_at desc);
