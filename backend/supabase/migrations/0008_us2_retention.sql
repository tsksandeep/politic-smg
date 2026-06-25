-- 0008_us2_retention.sql — US2 onboarding support + retention/recompute functions.
-- (Supports T035/T036/T037/T037a and the launch-blocking T045 purge.)

-- Short-lived OAuth state for the consent flow (state → cadre/platform). Purged with data.
create table if not exists oauth_state (
  state       text primary key,
  cadre_id    uuid not null references cadre (id) on delete cascade,
  platform    text not null check (platform in ('instagram', 'youtube')),
  created_at  timestamptz not null default now()
);
alter table oauth_state enable row level security; -- service-role only; no client policies

-- Store an account's access token in Vault and record only the reference on the row (Principle III).
create or replace function store_account_token(p_account uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select vault.create_secret(p_token, 'acct_token_' || p_account::text) into v_secret_id;
  update connected_account set token_ref = v_secret_id::text where id = p_account;
end;
$$;

-- Strengthen detection (redefines 0007 version): only comments from CURRENTLY CONNECTED
-- accounts drive clustering/metrics, so a revoked account's data drops out immediately
-- even before the scheduled physical purge (edge case "consent revoked mid-incident", T037a).
create or replace function run_detection() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s detection_settings;
  c record;
  match_id uuid;
  sim_threshold constant real := 0.25;
begin
  select * into s from detection_settings order by updated_at desc limit 1;

  for c in
    select cm.id, cm.embedding
    from comment cm
    join post p on p.id = cm.post_id
    join connected_account ca on ca.id = p.connected_account_id
    where cm.sentiment = 'hostile' and cm.embedding is not null and cm.narrative_id is null
      and ca.consent_status = 'connected'
    order by cm.ingested_at
    limit 500
  loop
    select n.id into match_id
      from narrative n
     where n.centroid is not null and (n.centroid <=> c.embedding) < sim_threshold
     order by (n.centroid <=> c.embedding)
     limit 1;
    if match_id is null then
      insert into narrative (centroid) values (c.embedding) returning id into match_id;
    end if;
    update comment set narrative_id = match_id where id = c.id;
  end loop;

  update narrative n set
    volume = sub.vol, growth_rate = sub.growth, coordination_score = sub.coord,
    confidence = sub.conf, last_updated_at = now()
  from (
    select nm.id,
      count(*) filter (where cm.ingested_at > now() - s.coordination_window) as vol,
      (count(*) filter (where cm.ingested_at > now() - s.coordination_window))::real
        / greatest(count(*) filter (
            where cm.ingested_at <= now() - s.coordination_window
              and cm.ingested_at > now() - (s.coordination_window * 2)), 1) as growth,
      least(1.0, count(distinct cm.commenter_hash) filter (where cm.ingested_at > now() - s.coordination_window)::real
          / greatest(s.coordination_min_accounts, 1)) as coord,
      avg(cm.sentiment_confidence) as conf
    from narrative nm
    join comment cm on cm.narrative_id = nm.id
    join post p on p.id = cm.post_id
    join connected_account ca on ca.id = p.connected_account_id and ca.consent_status = 'connected'
    group by nm.id
  ) sub
  where n.id = sub.id;

  insert into alert (narrative_id, affected_scope)
  select n.id, jsonb_build_object(
      'cadres', (select count(distinct ca.cadre_id) from comment cm
                   join post p on p.id = cm.post_id
                   join connected_account ca on ca.id = p.connected_account_id
                  where cm.narrative_id = n.id),
      'posts', (select count(distinct cm.post_id) from comment cm where cm.narrative_id = n.id))
  from narrative n
  where n.volume >= s.min_volume and n.growth_rate >= s.min_growth_rate
    and not exists (select 1 from alert a where a.narrative_id = n.id and a.status in ('open', 'acknowledged'));
end;
$$;

-- Read an account's access token from Vault by its stored reference (backend/service-role only).
create or replace function read_account_token(p_account uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_token text;
begin
  select ds.decrypted_secret into v_token
    from connected_account ca
    join vault.decrypted_secrets ds on ds.id = ca.token_ref::uuid
   where ca.id = p_account;
  return v_token;
end;
$$;

-- Recompute after a revoke/purge so removed data drops out mid-incident (T037a).
create or replace function recompute_after_revoke()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s detection_settings;
begin
  select * into s from detection_settings order by updated_at desc limit 1;

  -- Narratives with no remaining comments from CONNECTED accounts → zero them out.
  -- (Revoked-account comments still physically exist until the scheduled purge, but must
  -- stop driving alerts immediately — they are excluded here just as in run_detection.)
  update narrative n
     set volume = 0, coordination_score = 0, last_updated_at = now()
   where not exists (
     select 1 from comment c
     join post p on p.id = c.post_id
     join connected_account ca on ca.id = p.connected_account_id and ca.consent_status = 'connected'
     where c.narrative_id = n.id
   );

  -- Recompute the rest (clusters + metrics + new alerts).
  perform run_detection();

  -- Auto-close open/ack alerts whose narrative fell below the volume threshold.
  update alert a
     set status = 'closed',
         closed_at = now(),
         response_note = coalesce(a.response_note, '') || ' [auto-closed: source data removed]'
    from narrative n
   where a.narrative_id = n.id
     and a.status in ('open', 'acknowledged')
     and n.volume < s.min_volume;
end;
$$;

-- Retention + revoked-account purge (T045, LAUNCH-BLOCKING).
create or replace function purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text_purged int;
  v_revoked_accounts int;
begin
  -- 1) Delete raw comment text older than 30 days; keep anonymized derivatives (FR-009).
  update comment
     set body = null
   where body is not null
     and ingested_at < now() - interval '30 days';
  get diagnostics v_text_purged = row_count;

  -- 2) Purge all content for revoked accounts (FR-010). Cascades drop posts→comments.
  with revoked as (
    select id from connected_account where consent_status = 'revoked'
  )
  delete from post where connected_account_id in (select id from revoked);
  get diagnostics v_revoked_accounts = row_count;

  -- 3) Recompute so removed data no longer drives alerts.
  perform recompute_after_revoke();

  -- 4) Tidy expired oauth_state rows.
  delete from oauth_state where created_at < now() - interval '1 hour';

  return jsonb_build_object('raw_text_purged', v_text_purged, 'revoked_posts_deleted', v_revoked_accounts);
end;
$$;
