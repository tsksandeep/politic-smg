-- 0004_queues.sql — pgmq work queues + claim/complete/fail RPCs (decoupled enrichment, R-pipeline).
-- Two queues drive the pipeline downstream of capture:
--   enrich_jobs : per-comment + per-post text → embed + classify + (comment) author-hash.
--   media_jobs  : per-post media_url → media worker fetches, OCR/ASR, transcript, discards bytes.
-- Each queued message carries its tenant_id so workers stay tenant-scoped. Poison messages move to
-- a DLQ after p_max_reads attempts. Service role invokes these (RLS-bypassing backend).

create extension if not exists pgmq cascade;

select pgmq.create('enrich_jobs');
select pgmq.create('media_jobs');

-- NOTE: `create extension` / `pgmq.create()` reset the session search_path as a side effect, and the
-- migration runner starts with a bare search_path — so re-assert it HERE (after those calls) before
-- creating unqualified objects in `public`.
set search_path = public, extensions, pgmq;

-- Enqueue helpers (called by the submit function after normalising a capture).
create or replace function enqueue_enrich(p_tenant uuid, p_kind text, p_id uuid)
returns void language sql security definer set search_path = public, pgmq as $$
  select pgmq.send('enrich_jobs', jsonb_build_object('tenant_id', p_tenant, 'kind', p_kind, 'id', p_id));
$$;

create or replace function enqueue_media(p_tenant uuid, p_post uuid)
returns void language sql security definer set search_path = public, pgmq as $$
  select pgmq.send('media_jobs', jsonb_build_object('tenant_id', p_tenant, 'post_id', p_post));
$$;

-- Generic claim: read a batch with a visibility timeout; auto-move over-retried messages to the DLQ.
create or replace function claim_jobs(p_queue text, p_qty int, p_vt int, p_max_reads int)
returns table (msg_id bigint, message jsonb)
language plpgsql security definer set search_path = public, pgmq as $$
begin
  -- Archive poison messages first (read_ct already past the cap).
  perform pgmq.archive(p_queue, m.msg_id)
    from pgmq.read(p_queue, 0, 1000) m
    where m.read_ct > p_max_reads;
  return query
    select m.msg_id, m.message from pgmq.read(p_queue, p_vt, p_qty) m;
end $$;

create or replace function complete_job(p_queue text, p_msg_id bigint)
returns void language sql security definer set search_path = public, pgmq as $$
  select pgmq.delete(p_queue, p_msg_id);
$$;

-- Fail = make visible again immediately so read_ct climbs toward the DLQ cap on the next claim.
create or replace function fail_job(p_queue text, p_msg_id bigint)
returns void language sql security definer set search_path = public, pgmq as $$
  select pgmq.set_vt(p_queue, p_msg_id, 0);
$$;

-- Reconcile any un-embedded comment / un-transcribed post that lacks a queue job (covers gaps).
create or replace function reconcile_enrich_queue(p_limit int default 1000)
returns int language plpgsql security definer set search_path = public, pgmq as $$
declare n int := 0; r record;
begin
  for r in
    select tenant_id, 'comment' as kind, id from comment
      where embedding is null and body is not null
      order by ingested_at limit p_limit
  loop
    perform pgmq.send('enrich_jobs', jsonb_build_object('tenant_id', r.tenant_id, 'kind', r.kind, 'id', r.id));
    n := n + 1;
  end loop;
  return n;
end $$;
