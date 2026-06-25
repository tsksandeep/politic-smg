-- 0014_analyze_queue.sql — wire the analyze pipeline onto pgmq with retries + a dead-letter queue.
--
-- 0005_queues.sql provisioned analyze_jobs (+ analyze_jobs_dlq) but the hot path never used them:
-- analyze-comments selected `embedding is null` rows directly. That pull model is self-healing but
-- has NO bounded retries and NO poison-message handling — a comment that always fails classification
-- is re-tried forever, silently. This migration adds public SECURITY DEFINER wrappers around pgmq
-- (pgmq is SQL-only; not exposed over the API per config.toml) so the Edge Function can:
--   reconcile → enqueue any unembedded comment not already queued (catch-all; nothing is lost),
--   claim     → read a batch with a visibility timeout; auto-move over-limit messages to the DLQ,
--   complete  → delete a message on success,
--   fail      → make a message immediately visible again so its read_ct climbs toward the DLQ.
-- Idempotent: every comment maps to at most one live analyze_jobs message (dedup by comment_id).

-- Enqueue one comment for analysis (called by producers: ig-webhook, backfill, ingest-youtube).
create or replace function enqueue_analyze_comment(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  -- Skip if already queued (live or dead-lettered) so producer + reconcile can't double-enqueue.
  if exists (select 1 from pgmq.q_analyze_jobs q where (q.message->>'comment_id') = p_comment::text)
     or exists (select 1 from pgmq.q_analyze_jobs_dlq d where (d.message->>'comment_id') = p_comment::text)
  then
    return;
  end if;
  perform pgmq.send('analyze_jobs', jsonb_build_object('comment_id', p_comment));
end;
$$;

-- Sweep: enqueue every analyzable (un-embedded, has body) comment not already in the queue or DLQ.
-- This makes the queue the single source of truth even for rows inserted before this migration,
-- or if a producer's best-effort enqueue failed. Returns how many it added.
create or replace function reconcile_analyze_queue(p_limit int default 1000)
returns int
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_count int := 0;
  c record;
begin
  for c in
    select cm.id
      from comment cm
     where cm.embedding is null
       and cm.body is not null
       and not exists (select 1 from pgmq.q_analyze_jobs q where (q.message->>'comment_id') = cm.id::text)
       and not exists (select 1 from pgmq.q_analyze_jobs_dlq d where (d.message->>'comment_id') = cm.id::text)
     order by cm.ingested_at
     limit p_limit
  loop
    perform pgmq.send('analyze_jobs', jsonb_build_object('comment_id', c.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Claim a batch for processing. Reads make messages invisible for p_vt seconds; a worker must
-- complete (delete) or fail (reset visibility) each one. Messages whose read_ct exceeds
-- p_max_reads are moved to analyze_jobs_dlq here and NOT returned (poison-message cap).
create or replace function claim_analyze_jobs(
  p_qty int default 100,
  p_vt int default 120,
  p_max_reads int default 5
)
returns table (msg_id bigint, comment_id uuid)
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  r record;
begin
  for r in select * from pgmq.read('analyze_jobs', p_vt, p_qty) loop
    if r.read_ct > p_max_reads then
      perform pgmq.send('analyze_jobs_dlq', r.message);
      perform pgmq.delete('analyze_jobs', r.msg_id);
      continue;
    end if;
    msg_id := r.msg_id;
    comment_id := (r.message->>'comment_id')::uuid;
    return next;
  end loop;
end;
$$;

-- Acknowledge successful processing.
create or replace function complete_analyze_job(p_msg_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  perform pgmq.delete('analyze_jobs', p_msg_id);
end;
$$;

-- Mark a failed attempt: make the message visible again immediately. Its read_ct has already been
-- incremented by the claim, so repeated failures converge on the DLQ cutoff in claim_analyze_jobs.
create or replace function fail_analyze_job(p_msg_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  perform pgmq.set_vt('analyze_jobs', p_msg_id, 0);
end;
$$;
