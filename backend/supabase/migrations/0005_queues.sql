-- 0005_queues.sql — pgmq queues for the ingestion pipeline (T011, R4)
-- fetch → normalize → enqueue → analyze → persist, with retries + dead-letter handling.

create extension if not exists pgmq;

-- Ingestion jobs (e.g. "poll this YouTube channel", "backfill this account").
select pgmq.create('ingest_jobs');
-- Per-comment analysis jobs consumed by analyze-comments (Gemini classification + embedding).
select pgmq.create('analyze_jobs');

-- Dead-letter queues for messages that exceed max retries (drained/inspected manually).
select pgmq.create('ingest_jobs_dlq');
select pgmq.create('analyze_jobs_dlq');
