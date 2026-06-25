-- demo_burst.sql — seed a synthetic coordinated hostile burst to validate the wedge
-- WITHOUT calling Instagram/YouTube/Gemini. Comments are pre-embedded (synthetic vector) and
-- pre-classified as hostile, so `select run_detection();` will cluster them and raise an alert.
-- Safe to re-run; uses a dedicated demo cadre.
--
-- Usage:
--   psql "$DATABASE_URL" -f backend/supabase/seed/demo_burst.sql
--   psql "$DATABASE_URL" -c "select run_detection();"
-- Then watch the war-room board light up via Realtime.

do $$
declare
  v_cadre uuid;
  v_acct  uuid;
  v_post  uuid;
  v_vec   text;
  i       int;
begin
  -- Synthetic 768-dim embedding (unit on the first axis) so all burst comments cluster together.
  v_vec := '[' || '1' || repeat(',0', 767) || ']';

  insert into cadre (display_name) values ('DEMO — synthetic burst') returning id into v_cadre;
  insert into connected_account (cadre_id, platform, external_id, token_ref)
    values (v_cadre, 'instagram', 'demo-' || gen_random_uuid(), 'demo-token-ref')
    returning id into v_acct;
  insert into post (connected_account_id, platform_post_id, published_at, last_ingested_at)
    values (v_acct, 'demo-post-' || gen_random_uuid(), now(), now())
    returning id into v_post;

  -- 40 distinct commenters, near-identical hostile messaging in a short window → coordination.
  for i in 1..40 loop
    insert into comment (post_id, commenter_hash, body, created_at, ingested_at,
                         sentiment, sentiment_confidence, language, embedding)
    values (v_post,
            'demo-hash-' || i,
            'broken promises, total corruption',
            now(), now(),
            'hostile', 0.92, 'en',
            v_vec::vector);
  end loop;

  raise notice 'Seeded demo burst: cadre=% account=% post=% (40 hostile comments)', v_cadre, v_acct, v_post;
end $$;
