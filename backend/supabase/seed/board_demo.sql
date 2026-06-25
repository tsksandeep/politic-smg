-- board_demo.sql — seed a full two-sided war-room board WITHOUT external APIs.
-- Creates several cadres with pre-embedded, pre-classified comments so a single
-- `select run_detection();` produces:
--   * favourable (pro-party) narratives — best & worst performing
--   * anti-party narratives (which also raise alerts)
--   * varied per-cadre positive vs negative coverage
--
-- Usage:
--   psql "$DATABASE_URL" -f backend/supabase/seed/board_demo.sql
-- (run_detection + theme labelling happen at the end of this script).

do $$
declare
  b record;
  v_cadre uuid;
  v_acct uuid;
  v_post uuid;
  v_vec text;
  i int;
  gh int := 0;
begin
  create temp table tmp_cadre(name text primary key, post_id uuid) on commit drop;

  -- One cadre + account + post each.
  for b in select unnest(array['Arjun Mehta', 'Kavin Raj', 'Sana Iqbal', 'Deepak Rao', 'Priya Nair']) as name loop
    insert into cadre (display_name) values (b.name) returning id into v_cadre;
    insert into connected_account (cadre_id, platform, external_id, token_ref)
      values (v_cadre, 'instagram', 'demo-' || gen_random_uuid(), 'demo-token-ref') returning id into v_acct;
    insert into post (connected_account_id, platform_post_id, published_at, last_ingested_at)
      values (v_acct, 'demo-post-' || gen_random_uuid(), now(), now()) returning id into v_post;
    insert into tmp_cadre(name, post_id) values (b.name, v_post);
  end loop;

  -- Comment batches: (cadre, embedding axis = cluster, sentiment, confidence, count, body).
  -- axis 1 = "welfare praise" (big favourable), axis 2 = "grassroots appreciation" (small favourable),
  -- axis 0 = "corruption attack" (big anti), axis 4 = "economic-record mockery" (anti), axis 3 = neutral.
  for b in
    select * from (values
      ('Arjun Mehta', 1, 'positive', 0.91, 25, 'Brilliant work on the new welfare scheme, real change on the ground'),
      ('Kavin Raj',   1, 'positive', 0.90, 12, 'The welfare rollout actually reached our village, thank you'),
      ('Sana Iqbal',  1, 'positive', 0.89,  9, 'Finally a scheme that works, proud of the party'),
      ('Deepak Rao',  2, 'positive', 0.86,  8, 'Loved the grassroots campaign visit, very humble leader'),
      ('Sana Iqbal',  2, 'positive', 0.84,  4, 'Great to see door-to-door outreach again'),
      ('Priya Nair',  0, 'hostile',  0.93, 30, 'Broken promises, total corruption, shame on this party'),
      ('Deepak Rao',  0, 'hostile',  0.92, 12, 'All talk no action, resign already'),
      ('Kavin Raj',   0, 'hostile',  0.90,  8, 'Failed governance, you betrayed us'),
      ('Priya Nair',  4, 'hostile',  0.88, 28, 'Same old jokers, the economy is in ruins under them'),
      ('Arjun Mehta', 3, 'neutral',  0.70,  4, 'When is the next public event scheduled?')
    ) as t(cadre, axis, sent, conf, n, body)
  loop
    select post_id into v_post from tmp_cadre where name = b.cadre;
    v_vec := '[' || repeat('0,', b.axis) || '1' || repeat(',0', 767 - b.axis) || ']';
    for i in 1..b.n loop
      gh := gh + 1;
      insert into comment (post_id, commenter_hash, body, created_at, ingested_at,
                           sentiment, sentiment_confidence, language, embedding)
      values (v_post, 'demo-hash-' || gh, b.body, now(), now(), b.sent, b.conf, 'en', v_vec::vector);
    end loop;
  end loop;

  raise notice 'Seeded board demo: 5 cadres, % comments', gh;
end $$;

-- Cluster + score everything.
select run_detection();

-- Label narratives without an LLM call (seed is offline). Best/worst favourable + anti themes.
update narrative set theme_summary = 'Public praise for the new welfare scheme rollout'
  where stance = 'pro_party' and theme_summary is null and volume >= 30;
update narrative set theme_summary = 'Appreciation for the candidate''s grassroots campaign visits'
  where stance = 'pro_party' and theme_summary is null and volume < 30;
update narrative set theme_summary = 'Coordinated claims of broken promises and corruption'
  where stance = 'anti_party' and theme_summary is null and volume >= 40;
update narrative set theme_summary = 'Mockery of the party''s economic record'
  where stance = 'anti_party' and theme_summary is null;
