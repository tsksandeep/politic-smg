-- 0012_favourable_and_coverage.sql — widen the board beyond anti-party.
--
-- Narratives now carry a STANCE (anti_party | pro_party): hostile clusters are anti-party
-- (and still raise alerts), positive clusters are *favourable* narratives tracked for
-- performance (best/worst in favour of the party). Plus a per-cadre coverage view (which cadres
-- get the most positive vs negative reaction). This pulls a slice of Phase-2 analytics forward.

alter table narrative
  add column if not exists stance text not null default 'anti_party'
  check (stance in ('anti_party', 'pro_party'));

create index if not exists idx_narrative_stance on narrative (stance);

-- run_detection v3: cluster BOTH hostile→anti_party and positive→pro_party comments into
-- stance-tagged narratives (matching only within the same stance). Metrics recompute for all
-- narratives. Alerts are still raised ONLY for anti_party narratives crossing thresholds, so a
-- healthy/positive surge never alerts (FR-005). Connected-accounts-only (revoked data drops out).
create or replace function run_detection() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s detection_settings;
  c record;
  match_id uuid;
  v_stance text;
  sim_threshold constant real := 0.25;
begin
  select * into s from detection_settings order by updated_at desc limit 1;

  for c in
    select cm.id, cm.embedding, cm.sentiment
    from comment cm
    join post p on p.id = cm.post_id
    join connected_account ca on ca.id = p.connected_account_id
    where cm.sentiment in ('hostile', 'positive') and cm.embedding is not null and cm.narrative_id is null
      and ca.consent_status = 'connected'
    order by cm.ingested_at
    limit 500
  loop
    v_stance := case when c.sentiment = 'hostile' then 'anti_party' else 'pro_party' end;
    select n.id into match_id
      from narrative n
     where n.stance = v_stance and n.centroid is not null and (n.centroid <=> c.embedding) < sim_threshold
     order by (n.centroid <=> c.embedding)
     limit 1;
    if match_id is null then
      insert into narrative (centroid, stance) values (c.embedding, v_stance) returning id into match_id;
    end if;
    update comment set narrative_id = match_id where id = c.id;
  end loop;

  update narrative n set
    volume = sub.vol,
    growth_rate = sub.growth,
    coordination_score = sub.coord,
    confidence = sub.conf,
    last_updated_at = now()
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
  where n.stance = 'anti_party' and n.volume >= s.min_volume and n.growth_rate >= s.min_growth_rate
    and not exists (select 1 from alert a where a.narrative_id = n.id and a.status in ('open', 'acknowledged'));
end;
$$;

-- Narrative-level board (favourable narratives have no alert, so they need their own view).
-- performance_score = volume × growth → rank "best / worst in favour of the party". RLS via invoker.
create or replace view narrative_board as
select
  n.id, n.stance, n.theme_summary, n.volume, n.growth_rate, n.confidence, n.coordination_score,
  n.last_updated_at,
  (n.volume * greatest(n.growth_rate, 0))::real as performance_score,
  jsonb_build_object(
    'cadres', (select count(distinct ca.cadre_id) from comment cm
                 join post p on p.id = cm.post_id
                 join connected_account ca on ca.id = p.connected_account_id
                where cm.narrative_id = n.id),
    'posts', (select count(distinct cm.post_id) from comment cm where cm.narrative_id = n.id)
  ) as affected_scope,
  (select max(cm.ingested_at) from comment cm where cm.narrative_id = n.id) as data_fresh_as_of
from narrative n
where n.volume > 0;
alter view narrative_board set (security_invoker = on);

-- Per-cadre coverage: positive vs negative (hostile) reaction on the cadre's own posts.
create or replace view cadre_coverage as
select
  cad.id as cadre_id,
  cad.display_name,
  count(*) filter (where cm.sentiment = 'positive') as positive_count,
  count(*) filter (where cm.sentiment = 'hostile')  as negative_count,
  count(*) filter (where cm.sentiment = 'neutral')  as neutral_count,
  count(*) as total_count
from cadre cad
join connected_account ca on ca.cadre_id = cad.id and ca.consent_status = 'connected'
join post p on p.connected_account_id = ca.id
join comment cm on cm.post_id = p.id
group by cad.id, cad.display_name;
alter view cadre_coverage set (security_invoker = on);

-- Live board (FR-006): stream alert + narrative changes to the dashboard via Realtime.
do $$
begin
  alter publication supabase_realtime add table alert;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table narrative;
exception when duplicate_object then null; end $$;
