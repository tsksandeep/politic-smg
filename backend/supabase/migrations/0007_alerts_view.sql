-- 0007_alerts_view.sql — war-room board view + US1 supporting functions (T027, supports T024/T025)
-- Detection runs in SQL because the clustering is pgvector similarity work; the detect-narratives
-- Edge Function is a thin trigger that calls run_detection() then adds LLM theme summaries.

-- Board view: one row per alert, joined to its narrative, with freshness (FR-015).
create or replace view alert_board as
select
  a.id,
  a.status,
  a.assignee_user_id,
  a.detected_at,
  a.acknowledged_at,
  a.closed_at,
  n.theme_summary,
  n.volume,
  n.growth_rate,
  n.confidence,
  n.coordination_score,
  a.affected_scope,
  (select max(c.ingested_at) from comment c where c.narrative_id = n.id) as data_fresh_as_of
from alert a
join narrative n on n.id = a.narrative_id;

-- Run RLS as the querying user so analysts/admins see the board under their policies.
alter view alert_board set (security_invoker = on);

-- Persist analysis results for one comment (embedding cast from text → vector). Used by T024.
create or replace function set_comment_analysis(
  p_id uuid,
  p_sentiment text,
  p_confidence real,
  p_language text,
  p_embedding text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update comment
     set sentiment = p_sentiment,
         sentiment_confidence = p_confidence,
         language = p_language,
         embedding = p_embedding::vector
   where id = p_id;
end;
$$;

-- Core detection (T025): cluster unassigned hostile comments into narratives, recompute
-- metrics over the configured window, and raise alerts crossing thresholds. Positive/neutral
-- comments are ignored (FR-005, healthy-spike exclusion).
create or replace function run_detection() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s detection_settings;
  c record;
  match_id uuid;
  sim_threshold constant real := 0.25; -- cosine distance; smaller = more similar
begin
  select * into s from detection_settings order by updated_at desc limit 1;

  -- Assign each analyzed, hostile, unclustered comment to nearest narrative (or create one).
  for c in
    select id, embedding from comment
     where sentiment = 'hostile' and embedding is not null and narrative_id is null
     order by ingested_at
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

  -- Recompute narrative metrics over the recent window vs the prior window (growth).
  update narrative n set
    volume = sub.vol,
    growth_rate = sub.growth,
    coordination_score = sub.coord,
    confidence = sub.conf,
    last_updated_at = now()
  from (
    select nm.id,
      count(*) filter (where c.ingested_at > now() - s.coordination_window) as vol,
      (count(*) filter (where c.ingested_at > now() - s.coordination_window))::real
        / greatest(count(*) filter (
            where c.ingested_at <= now() - s.coordination_window
              and c.ingested_at > now() - (s.coordination_window * 2)), 1) as growth,
      least(1.0,
        count(distinct c.commenter_hash) filter (where c.ingested_at > now() - s.coordination_window)::real
          / greatest(s.coordination_min_accounts, 1)) as coord,
      avg(c.sentiment_confidence) as conf
    from narrative nm
    join comment c on c.narrative_id = nm.id
    group by nm.id
  ) sub
  where n.id = sub.id;

  -- Raise an alert for any narrative crossing thresholds that has no open/acknowledged alert.
  insert into alert (narrative_id, affected_scope)
  select n.id, jsonb_build_object(
      'cadres', (select count(distinct ca.cadre_id)
                   from comment c
                   join post p on p.id = c.post_id
                   join connected_account ca on ca.id = p.connected_account_id
                  where c.narrative_id = n.id),
      'posts', (select count(distinct c.post_id) from comment c where c.narrative_id = n.id))
  from narrative n
  where n.volume >= s.min_volume
    and n.growth_rate >= s.min_growth_rate
    and not exists (
      select 1 from alert a where a.narrative_id = n.id and a.status in ('open', 'acknowledged'));
end;
$$;
