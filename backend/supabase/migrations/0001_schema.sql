-- 0001_schema.sql — base schema for Politic-SMG rapid-response wedge (T007)
-- Single tenant per party. All personal data resides in an India region (Principle III).

create extension if not exists "pgcrypto"; -- gen_random_uuid()
create extension if not exists "vector";  -- pgvector (columns added in 0002)

-- Internal authorized users; maps 1:1 to Supabase auth.users (Admin / Analyst). FR-016.
create table if not exists app_user (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('admin', 'analyst')),
  created_at  timestamptz not null default now()
);

-- Consenting party worker.
create table if not exists cadre (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  status        text not null default 'active' check (status in ('active', 'inactive')),
  created_at    timestamptz not null default now()
);

-- The ONLY ingestion source: a consented IG (Creator/Business) or YouTube account. FR-001/011.
create table if not exists connected_account (
  id                uuid primary key default gen_random_uuid(),
  cadre_id          uuid not null references cadre (id) on delete cascade,
  platform          text not null check (platform in ('instagram', 'youtube')),
  external_id       text not null,
  consent_status    text not null default 'connected' check (consent_status in ('connected', 'revoked')),
  connected_at      timestamptz not null default now(),
  revoked_at        timestamptz,
  token_ref         text not null,            -- reference to secret in Vault, never the token
  token_expires_at  timestamptz,
  backfill_done     boolean not null default false,
  unique (platform, external_id)
);

-- Content published by a connected account.
create table if not exists post (
  id                    uuid primary key default gen_random_uuid(),
  connected_account_id  uuid not null references connected_account (id) on delete cascade,
  platform_post_id      text not null,
  published_at          timestamptz,
  permalink             text,
  last_ingested_at      timestamptz,          -- freshness tracking (FR-015)
  unique (connected_account_id, platform_post_id)
);

-- Clustered hostile/anti-party theme detected across comments. FR-002/003/004.
create table if not exists narrative (
  id              uuid primary key default gen_random_uuid(),
  theme_summary   text,
  volume          integer not null default 0,
  growth_rate     real not null default 0,
  confidence      real,                       -- 0..1 (FR-004)
  coordination_score real,                    -- 0..1 (FR-003)
  first_seen_at   timestamptz not null default now(),
  last_updated_at timestamptz not null default now()
);

-- A reaction on a connected account's post. Identity stored ONLY as a keyed hash. FR-008/009.
create table if not exists comment (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references post (id) on delete cascade,
  commenter_hash      text not null,          -- keyed hash; raw handle is NEVER stored
  body                text,                   -- raw text; purged after 30 days (FR-009)
  created_at          timestamptz,            -- source comment time
  ingested_at         timestamptz not null default now(),
  sentiment           text check (sentiment in ('hostile', 'neutral', 'positive')),
  sentiment_confidence real,                  -- 0..1 (FR-004)
  language            text,                   -- 'ta' | 'en' | 'mixed'
  narrative_id        uuid references narrative (id) on delete set null
);

-- A surfaced narrative event for the war room.
create table if not exists alert (
  id                uuid primary key default gen_random_uuid(),
  narrative_id      uuid not null references narrative (id) on delete cascade,
  status            text not null default 'open' check (status in ('open', 'acknowledged', 'closed')),
  assignee_user_id  uuid references app_user (id) on delete set null,
  detected_at       timestamptz not null default now(),
  acknowledged_at   timestamptz,
  closed_at         timestamptz,
  response_note     text,
  affected_scope    jsonb not null default '{}'::jsonb
);

-- Global, Admin-tunable detection thresholds (single active row). FR-005.
create table if not exists detection_settings (
  id                        uuid primary key default gen_random_uuid(),
  min_volume                integer not null default 25,
  min_growth_rate           real not null default 2.0,
  coordination_window       interval not null default '15 minutes',
  coordination_min_accounts integer not null default 8,
  updated_by                uuid references app_user (id),
  updated_at                timestamptz not null default now()
);

-- Seed one default settings row.
insert into detection_settings (id) values (gen_random_uuid())
on conflict do nothing;

create index if not exists idx_comment_post on comment (post_id);
create index if not exists idx_comment_ingested_at on comment (ingested_at);
create index if not exists idx_comment_narrative on comment (narrative_id);
create index if not exists idx_alert_status on alert (status);
create index if not exists idx_post_account on post (connected_account_id);
create index if not exists idx_connected_account_cadre on connected_account (cadre_id);
