-- 0007_detection.sql — the analytics brain (Principles V/VI/VII). All functions iterate over active
-- tenants and operate strictly within each tenant's rows, so pg_cron can call them parameterless.
-- Detection runs in SQL because clustering is pgvector similarity work; the Edge Functions are thin
-- triggers that add LLM theme labels and orchestrate. Every probabilistic value is stored with its
-- confidence; coordination is recorded as an inferred signal, never asserted as proven.

-- Pin search_path (the migration runner applies files with a bare search_path).
set search_path = public, extensions;

-- ---------- ingest / enrich write RPCs (vector cast lives in SQL) ----------

create or replace function set_comment_analysis(
  p_id uuid, p_sentiment text, p_confidence real, p_language text, p_embedding text
) returns void language plpgsql security definer set search_path = public as $$
begin
  update comment set sentiment = p_sentiment, sentiment_confidence = p_confidence,
                     language = p_language, embedding = p_embedding::vector
   where id = p_id;
end $$;

create or replace function set_post_embedding(p_id uuid, p_embedding text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update post set caption_embedding = p_embedding::vector where id = p_id;
end $$;

-- Media worker writes derived transcript text + embedding and CLEARS media_url (no raw media kept).
create or replace function add_media_transcript(
  p_tenant uuid, p_post uuid, p_kind text, p_text text, p_embedding text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into media_transcript (tenant_id, post_id, kind, text, transcript_embedding)
  values (p_tenant, p_post, p_kind, p_text, nullif(p_embedding,'')::vector);
  update post set media_url = null where id = p_post;   -- transcribe-then-discard (Principle III)
end $$;

-- ---------- narrative detection: cluster + metrics + lifecycle + emerging early-warning ----------

create or replace function run_detection() returns void
language plpgsql security definer set search_path = public as $$
declare
  t record; s detection_settings; c record; match_id uuid;
  -- sim_threshold is per-tenant (s.sim_threshold); cosine distance, smaller = more similar.
  v_recent int; v_prior int; v_growth real; v_velocity real; nstate text;
  n record;
begin
  for t in select id from tenant where status = 'active' loop
    select * into s from detection_settings where tenant_id = t.id;
    if not found then continue; end if;

    -- Assign analyzed posts (the narrative carriers) to nearest narrative, or create one.
    for c in
      select id, caption_embedding as emb from post
       where tenant_id = t.id and caption_embedding is not null and narrative_id is null
       order by first_seen_at limit 500
    loop
      select nr.id into match_id from narrative nr
        where nr.tenant_id = t.id and nr.centroid is not null
          and (nr.centroid <=> c.emb) < s.sim_threshold
        order by (nr.centroid <=> c.emb) limit 1;
      if match_id is null then
        insert into narrative (tenant_id, centroid) values (t.id, c.emb) returning id into match_id;
      end if;
      update post set narrative_id = match_id where id = c.id;
    end loop;

    -- Attach analyzed hostile comments to the nearest narrative (adds volume / author-network signal).
    for c in
      select id, embedding as emb from comment
       where tenant_id = t.id and embedding is not null and narrative_id is null
         and sentiment = 'hostile'
       order by ingested_at limit 1000
    loop
      select nr.id into match_id from narrative nr
        where nr.tenant_id = t.id and nr.centroid is not null
          and (nr.centroid <=> c.emb) < s.sim_threshold
        order by (nr.centroid <=> c.emb) limit 1;
      if match_id is not null then
        update comment set narrative_id = match_id where id = c.id;
      end if;
    end loop;

    -- Recompute per-narrative metrics + lifecycle, write an observation, raise emerging alerts.
    for n in select id from narrative where tenant_id = t.id loop
      select count(*) into v_recent from (
        select 1 from post where narrative_id = n.id and first_seen_at > now() - s.coordination_window
        union all
        select 1 from comment where narrative_id = n.id and ingested_at > now() - s.coordination_window
      ) z;
      select count(*) into v_prior from (
        select 1 from post where narrative_id = n.id
          and first_seen_at <= now() - s.coordination_window
          and first_seen_at >  now() - (s.coordination_window * 2)
        union all
        select 1 from comment where narrative_id = n.id
          and ingested_at <= now() - s.coordination_window
          and ingested_at >  now() - (s.coordination_window * 2)
      ) z;

      v_growth   := v_recent::real / greatest(v_prior, 1);
      -- velocity proxy: recent engagement accumulation across the narrative's posts.
      select coalesce(avg(pm.like_count + pm.comment_count),0)::real into v_velocity
        from post p join post_metric_sample pm on pm.post_id = p.id
       where p.narrative_id = n.id and pm.at > now() - s.coordination_window;

      nstate := case
        when v_recent = 0 and v_prior > 0 then 'dormant'
        when v_prior = 0 and v_recent > 0 then 'emerging'
        when v_growth >= 1.5 then (case when v_prior = 0 then 'emerging' else 'resurgent' end)
        when v_growth between 0.8 and 1.5 then 'peaking'
        else 'decaying' end;

      update narrative set
        volume = (select count(*) from post where narrative_id = n.id)
               + (select count(*) from comment where narrative_id = n.id),
        growth_rate = v_growth,
        confidence = (select avg(sentiment_confidence) from comment where narrative_id = n.id),
        lifecycle_state = nstate,
        last_updated_at = now()
      where id = n.id;

      insert into narrative_observation (tenant_id, narrative_id, volume, velocity)
      values (t.id, n.id, v_recent, v_velocity);

      -- Emerging-narrative early warning: crossing the velocity threshold BEFORE peak (FR-012).
      if v_growth >= s.emerging_velocity_threshold
         and v_recent >= s.min_cluster_volume
         and nstate in ('emerging','resurgent')
         and not exists (select 1 from alert a
                          where a.narrative_id = n.id and a.status in ('open','acknowledged')) then
        insert into alert (tenant_id, kind, narrative_id)
        values (t.id, 'emerging_narrative', n.id);
      end if;
    end loop;

    -- Amplifier graph: per-account participation + amplification score (FR-012).
    insert into account_narrative_participation
      (tenant_id, tracked_account_id, narrative_id, post_count, amplification_score, is_origin)
    select t.id, p.tracked_account_id, p.narrative_id, count(*),
           least(1.0, (avg(coalesce(pm.like_count,0) + coalesce(pm.comment_count,0)) / 1000.0))::real,
           false
      from post p
      left join lateral (
        select like_count, comment_count from post_metric_sample
         where post_id = p.id order by at desc limit 1) pm on true
     where p.tenant_id = t.id and p.narrative_id is not null
     group by p.tracked_account_id, p.narrative_id
    on conflict (tenant_id, tracked_account_id, narrative_id) do update
      set post_count = excluded.post_count, amplification_score = excluded.amplification_score;

    -- Patient-zero: earliest poster in each narrative is the probable origin.
    update account_narrative_participation anp set is_origin = (anp.tracked_account_id = o.acc)
      from (
        select p.narrative_id, (array_agg(p.tracked_account_id order by p.taken_at))[1] as acc
          from post p where p.tenant_id = t.id and p.narrative_id is not null and p.taken_at is not null
          group by p.narrative_id
      ) o
     where anp.tenant_id = t.id and anp.narrative_id = o.narrative_id;
  end loop;
end $$;

-- ---------- coordination detection: temporal / content / shared-audio / author-network ----------

create or replace function detect_coordination() returns void
language plpgsql security definer set search_path = public as $$
declare t record; s detection_settings; r record;
begin
  for t in select id from tenant where status = 'active' loop
    select * into s from detection_settings where tenant_id = t.id;
    if not found then continue; end if;

    -- SHARED AUDIO: same reel audio_id reused across >= min_accounts distinct accounts in window.
    for r in
      select p.audio_id, count(distinct p.tracked_account_id) as accts,
             array_agg(distinct p.tracked_account_id) as ids,
             (array_agg(p.narrative_id) filter (where p.narrative_id is not null))[1] as nid
        from post p
       where p.tenant_id = t.id and p.audio_id is not null
         and p.first_seen_at > now() - s.coordination_window
       group by p.audio_id
      having count(distinct p.tracked_account_id) >= s.coordination_min_accounts
    loop
      insert into coordination_signal (tenant_id, narrative_id, signal_type, score, baseline, account_ids, evidence)
      values (t.id, r.nid, 'shared_audio',
              least(1.0, r.accts::real / (s.coordination_min_accounts * 2)), 0,
              r.ids, jsonb_build_object('audio_id', r.audio_id, 'accounts', r.accts));
    end loop;

    -- CONTENT: identical hashtag set pushed by >= min_accounts distinct accounts in window.
    for r in
      select pe.value, count(distinct p.tracked_account_id) as accts,
             array_agg(distinct p.tracked_account_id) as ids
        from post_entity pe
        join post p on p.id = pe.post_id
       where pe.tenant_id = t.id and pe.kind = 'hashtag'
         and p.first_seen_at > now() - s.coordination_window
       group by pe.value
      having count(distinct p.tracked_account_id) >= s.coordination_min_accounts
    loop
      insert into coordination_signal (tenant_id, signal_type, score, baseline, account_ids, evidence)
      values (t.id, 'content',
              least(1.0, r.accts::real / (s.coordination_min_accounts * 2)), 0,
              r.ids, jsonb_build_object('hashtag', r.value, 'accounts', r.accts));
    end loop;

    -- TEMPORAL: a burst of posts from many accounts within a tight sub-window (synchronised drop).
    for r in
      select count(distinct p.tracked_account_id) as accts, array_agg(distinct p.tracked_account_id) as ids
        from post p
       where p.tenant_id = t.id and p.taken_at > now() - (s.coordination_window / 3)
      having count(distinct p.tracked_account_id) >= s.coordination_min_accounts
    loop
      insert into coordination_signal (tenant_id, signal_type, score, baseline, account_ids, evidence)
      values (t.id, 'temporal',
              least(1.0, r.accts::real / (s.coordination_min_accounts * 2)), 0,
              r.ids, jsonb_build_object('window', (s.coordination_window/3)::text, 'accounts', r.accts));
    end loop;

    -- AUTHOR-NETWORK: same hashed comment author pushing across many opposition targets.
    for r in
      select c.author_hash, count(distinct p.tracked_account_id) as targets
        from comment c join post p on p.id = c.post_id
       where c.tenant_id = t.id and c.ingested_at > now() - s.coordination_window
       group by c.author_hash
      having count(distinct p.tracked_account_id) >= s.coordination_min_accounts
    loop
      insert into coordination_signal (tenant_id, signal_type, score, baseline, account_ids, evidence)
      values (t.id, 'author_network',
              least(1.0, r.targets::real / (s.coordination_min_accounts * 2)), 0,
              '{}', jsonb_build_object('author_hash', left(r.author_hash,12)||'…', 'targets', r.targets));
    end loop;

    -- Roll fresh strong signals into a coordinated-attack alert + narrative coordination_score.
    insert into alert (tenant_id, kind, narrative_id, coordination_signal_id)
    select cs.tenant_id, 'coordinated_attack', cs.narrative_id, cs.id
      from coordination_signal cs
     where cs.tenant_id = t.id and cs.detected_at > now() - interval '10 minutes' and cs.score >= 0.5
       and not exists (select 1 from alert a
                        where a.coordination_signal_id = cs.id);

    update narrative n set coordination_score = sub.s
      from (select narrative_id, max(score) s from coordination_signal
             where tenant_id = t.id and narrative_id is not null
               and detected_at > now() - s.coordination_window group by narrative_id) sub
     where n.id = sub.narrative_id and n.tenant_id = t.id;
  end loop;
end $$;

-- ---------- work assignment generation: redundant + velocity-aware ----------

create or replace function generate_assignments() returns void
language plpgsql security definer set search_path = public as $$
declare t record; ta record; p record; i int;
begin
  for t in select * from tenant where status = 'active' loop
    -- Account captures: one redundant set per non-private tracked account on a ~2h cadence.
    for ta in
      select * from tracked_account
       where tenant_id = t.id and not is_private
         and not exists (
           select 1 from work_assignment wa
            where wa.tracked_account_id = tracked_account.id and wa.target_kind = 'account'
              and wa.state in ('pending','leased') )
         and not exists (
           select 1 from account_snapshot s
            where s.tracked_account_id = tracked_account.id and s.at > now() - interval '2 hours')
    loop
      for i in 1..t.redundancy_factor loop
        insert into work_assignment (tenant_id, target_kind, tracked_account_id, redundancy_index)
        values (t.id, 'account', ta.id, i);
      end loop;
    end loop;

    -- Velocity re-sampling: posts younger than 48h, not sampled in the last 30 min (FR-006).
    for p in
      select * from post
       where tenant_id = t.id and taken_at > now() - interval '48 hours'
         and (last_sampled_at is null or last_sampled_at < now() - interval '30 minutes')
         and not exists (
           select 1 from work_assignment wa
            where wa.post_id = post.id and wa.target_kind = 'post_metrics'
              and wa.state in ('pending','leased') )
       order by taken_at desc limit 200
    loop
      for i in 1..least(t.redundancy_factor, 2) loop
        insert into work_assignment (tenant_id, target_kind, tracked_account_id, post_id, redundancy_index)
        values (t.id, 'post_metrics', p.tracked_account_id, p.id, i);
      end loop;
    end loop;
  end loop;
end $$;

-- ---------- reconciliation + node trust (Principle VII) ----------

create or replace function reconcile_submissions() returns void
language plpgsql security definer set search_path = public as $$
declare t record; g record; majority numeric; sub record;
begin
  for t in select id from tenant where status = 'active' loop
    -- Group unreconciled submissions by the logical target (post_metrics on the same post).
    for g in
      select wa.post_id, array_agg(s.id) as sub_ids,
             percentile_disc(0.5) within group (order by (s.payload->'metrics'->>'like_count')::bigint) as med_likes
        from submission s join work_assignment wa on wa.id = s.work_assignment_id
       where s.tenant_id = t.id and not s.reconciled and wa.target_kind = 'post_metrics'
       group by wa.post_id
      having count(*) >= 2
    loop
      for sub in
        select s.id, s.node_id, (s.payload->'metrics'->>'like_count')::bigint as likes
          from submission s where s.id = any(g.sub_ids)
      loop
        if g.med_likes is not null and sub.likes is not null
           and abs(sub.likes - g.med_likes) > greatest(g.med_likes * 0.2, 10) then
          update submission set reconciled = true, diverged = true where id = sub.id;
          update node set trust_score = greatest(0, trust_score - 0.05) where id = sub.node_id;
        else
          update submission set reconciled = true where id = sub.id;
          update node set trust_score = least(1, trust_score + 0.01) where id = sub.node_id;
        end if;
      end loop;
    end loop;

    -- Single-submission targets: accept and lightly reward (nothing to cross-check yet).
    update submission s set reconciled = true
      from work_assignment wa
     where wa.id = s.work_assignment_id and s.tenant_id = t.id and not s.reconciled;

    -- Quarantine persistently low-trust nodes (a compromised node can't keep poisoning metrics).
    update node set status = 'quarantined'
     where tenant_id = t.id and status = 'active' and trust_score < 0.2;
  end loop;
end $$;

-- ---------- retention purge (Principle III / FR-018) ----------
-- Clear raw text (post.caption, comment.body) + any leftover media_url older than the retention
-- window; derived/anonymised data (author_hash, embeddings, hashtags, metric samples, transcripts,
-- narratives) persists. p_tenant null = all tenants (cron); a tenant id = that tenant only. The
-- retention-purge Edge Function calls this; tests call it directly.
create or replace function retention_purge(p_tenant uuid default null, p_days int default 30)
returns void language plpgsql security definer set search_path = public as $$
begin
  update post set caption = null, media_url = null
   where first_seen_at < now() - make_interval(days => p_days)
     and (p_tenant is null or tenant_id = p_tenant);
  update comment set body = null
   where ingested_at < now() - make_interval(days => p_days)
     and (p_tenant is null or tenant_id = p_tenant);
  -- defence-in-depth: drop media_url as soon as a transcript exists, regardless of age (no warehousing).
  update post p set media_url = null
   where p.media_url is not null
     and exists (select 1 from media_transcript m where m.post_id = p.id)
     and (p_tenant is null or p.tenant_id = p_tenant);
end $$;
