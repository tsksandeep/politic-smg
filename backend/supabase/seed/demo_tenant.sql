-- seed/demo_tenant.sql — deterministic two-tenant demo for the Opposition Narrative Intelligence
-- Platform. Proves the end-to-end pipeline AND tenant isolation (Principle I) on a fresh DB.
--
-- Tenant A "Indigo Front" gets a planted COORDINATION BURST: 5 distinct opposition accounts drop
-- near-identical captions, share ONE reel audio, and push the SAME hashtag set inside a tight window,
-- with rising-velocity metric samples and hostile comments. Tenant B "Saffron League" gets unrelated
-- benign posts. After `make pipeline` (run_detection + detect_coordination + the label triggers):
--   • Tenant A shows a LABELLED narrative, a coordination_signal, and an emerging + coordinated alert.
--   • Tenant B shows none of A's data (RLS isolates every row by tenant_id).
--
-- Embeddings are planted deterministically so run_detection clusters the burst WITHOUT any external
-- embedder: _seed_vec() builds a 768-dim mostly-zero vector with a single signature dimension set, so
-- same-signature rows have cosine distance 0 (< the 0.25 threshold) and different signatures are
-- orthogonal (distance 1). Burst caption+comment signature = dim 5; unrelated A = dim 40; B = dim 80.
--
-- Idempotent: the whole seed is guarded and no-ops if Tenant A already exists (fresh-DB seeding).

-- ---- deterministic vector helper: 768-dim, 1.0 at the given signature dims, else 0 ----
create or replace function _seed_vec(variadic dims int[])
returns text language sql immutable as $$
  select '[' || string_agg(case when (g - 1) = any(dims) then '1' else '0' end, ',' order by g) || ']'
  from generate_series(1, 768) g;
$$;

do $$
declare
  -- tenants
  ta uuid := '11111111-1111-1111-1111-111111111111'; -- Indigo Front (the burst)
  tb uuid := '22222222-2222-2222-2222-222222222222'; -- Saffron League (benign)
  -- users
  admin_a   uuid := '1a000000-0000-0000-0000-000000000001';
  analyst_a uuid := '1a000000-0000-0000-0000-000000000002';
  admin_b   uuid := '2b000000-0000-0000-0000-000000000001';
  analyst_b uuid := '2b000000-0000-0000-0000-000000000002';
  -- burst tracked accounts (A) + an unrelated A account
  a1 uuid := '1c000000-0000-0000-0000-000000000001';
  a2 uuid := '1c000000-0000-0000-0000-000000000002';
  a3 uuid := '1c000000-0000-0000-0000-000000000003';
  a4 uuid := '1c000000-0000-0000-0000-000000000004';
  a5 uuid := '1c000000-0000-0000-0000-000000000005';
  a6 uuid := '1c000000-0000-0000-0000-000000000006';
  -- B tracked accounts
  b1 uuid := '2c000000-0000-0000-0000-000000000001';
  b2 uuid := '2c000000-0000-0000-0000-000000000002';
  -- burst posts (A)
  p1 uuid := '1b000000-0000-0000-0000-000000000001';
  p2 uuid := '1b000000-0000-0000-0000-000000000002';
  p3 uuid := '1b000000-0000-0000-0000-000000000003';
  p4 uuid := '1b000000-0000-0000-0000-000000000004';
  p5 uuid := '1b000000-0000-0000-0000-000000000005';
  v_audio text := 'reel_audio_scam_8842';
  -- resolved after tenant_user seeding; stay null if auth.users seeding fell back (keeps FKs valid).
  added_by_a uuid;
  added_by_b uuid;
begin
  if exists (select 1 from tenant where id = ta) then
    raise notice 'demo seed already applied — skipping.';
    return;
  end if;

  -- ---- auth.users (local only): tenant_user FKs auth.users; guard so seeding survives any schema
  -- drift. Password 'demo-pass' (bcrypt) lets these users sign in locally; magic-link also works. ----
  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    values
      ('00000000-0000-0000-0000-000000000000', admin_a,   'authenticated', 'authenticated',
       'admin@indigo.test',   crypt('demo-pass', gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
      ('00000000-0000-0000-0000-000000000000', analyst_a, 'authenticated', 'authenticated',
       'analyst@indigo.test', crypt('demo-pass', gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
      ('00000000-0000-0000-0000-000000000000', admin_b,   'authenticated', 'authenticated',
       'admin@saffron.test',  crypt('demo-pass', gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
      ('00000000-0000-0000-0000-000000000000', analyst_b, 'authenticated', 'authenticated',
       'analyst@saffron.test', crypt('demo-pass', gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
    on conflict (id) do nothing;
    -- GoTrue scans these token columns as non-null strings; a NULL yields a 500
    -- "Database error finding user" at sign-in. Initialise them to '' (the API sets these itself).
    update auth.users set confirmation_token = '', recovery_token = '',
                          email_change_token_new = '', email_change = ''
     where id in (admin_a, analyst_a, admin_b, analyst_b);
  exception when others then
    raise notice 'auth.users seed skipped (%) — provision war-room users via the API instead.', sqlerrm;
  end;

  -- ---- tenants ----
  insert into tenant (id, name, jurisdiction) values
    (ta, 'Indigo Front', 'IN-DPDP'),
    (tb, 'Saffron League', 'IN-DPDP')
  on conflict (id) do nothing;

  -- ---- detection settings (explicit; match the IN-DPDP defaults) ----
  insert into detection_settings
    (tenant_id, emerging_velocity_threshold, coordination_window, coordination_min_accounts, min_cluster_volume)
  values
    (ta, 2.0, '30 minutes', 4, 5),
    (tb, 2.0, '30 minutes', 4, 5)
  on conflict (tenant_id) do nothing;

  -- ---- tenant_user (admin + analyst per tenant) — only for auth.users that actually exist, so a
  -- fallback during auth seeding can't leave a dangling FK ----
  insert into tenant_user (id, tenant_id, role)
  select v.id, v.tid, v.role
  from (values (admin_a, ta, 'admin'), (analyst_a, ta, 'analyst'),
               (admin_b, tb, 'admin'), (analyst_b, tb, 'analyst')) v(id, tid, role)
  where exists (select 1 from auth.users u where u.id = v.id)
  on conflict (id) do nothing;

  -- added_by must reference an existing tenant_user (nullable) — resolve to null if not seeded.
  select id into added_by_a from tenant_user where id = admin_a;
  select id into added_by_b from tenant_user where id = admin_b;

  -- ---- nodes (active IT-wing capture nodes) ----
  insert into node (tenant_id, label, token_hash, trust_score, status) values
    (ta, 'indigo-node-mumbai', 'demo_hash_indigo_1', 0.8, 'active'),
    (ta, 'indigo-node-chennai', 'demo_hash_indigo_2', 0.7, 'active'),
    (tb, 'saffron-node-delhi', 'demo_hash_saffron_1', 0.75, 'active');

  -- ---- tracked accounts ----
  insert into tracked_account (id, tenant_id, platform, handle, priority, added_by) values
    (a1, ta, 'instagram', 'opp_cadre_alpha',  5, added_by_a),
    (a2, ta, 'instagram', 'opp_cadre_bravo',  5, added_by_a),
    (a3, ta, 'instagram', 'opp_cadre_charlie',5, added_by_a),
    (a4, ta, 'instagram', 'opp_cadre_delta',  5, added_by_a),
    (a5, ta, 'instagram', 'opp_cadre_echo',   5, added_by_a),
    (a6, ta, 'instagram', 'opp_localnews',    2, added_by_a),
    (b1, tb, 'instagram', 'rival_handle_one', 4, added_by_b),
    (b2, tb, 'instagram', 'rival_handle_two', 4, added_by_b)
  on conflict (tenant_id, platform, handle) do nothing;

  -- ================= TENANT A: the coordination burst =================
  -- 5 distinct accounts, near-identical captions, ONE shared audio, identical hashtag set, all inside
  -- the last ~8 minutes (well within the 30-min coordination window and the 10-min temporal window).
  -- caption_embedding signature = dim 5 → all cluster into ONE narrative.
  insert into post (id, tenant_id, tracked_account_id, shortcode, permalink, is_video, caption,
                    audio_id, taken_at, caption_embedding, first_seen_at, last_sampled_at)
  values
    (p1, ta, a1, 'A-BURST-1', 'https://instagram.com/p/aburst1', true,
     'Why is the ruling party SILENT on the 500cr scam? The people deserve answers. #ExposeTheScam #PeopleDeserveAnswers',
     v_audio, now() - interval '8 minutes', _seed_vec(5)::vector, now() - interval '8 minutes', now() - interval '1 minute'),
    (p2, ta, a2, 'A-BURST-2', 'https://instagram.com/p/aburst2', true,
     'The ruling party stays SILENT on the 500cr scam — people deserve answers now. #ExposeTheScam #PeopleDeserveAnswers',
     v_audio, now() - interval '7 minutes', _seed_vec(5)::vector, now() - interval '7 minutes', now() - interval '1 minute'),
    (p3, ta, a3, 'A-BURST-3', 'https://instagram.com/p/aburst3', true,
     'Silence again from the ruling party on the 500cr scam. The people deserve answers! #ExposeTheScam #PeopleDeserveAnswers',
     v_audio, now() - interval '6 minutes', _seed_vec(5)::vector, now() - interval '6 minutes', now() - interval '1 minute'),
    (p4, ta, a4, 'A-BURST-4', 'https://instagram.com/p/aburst4', true,
     'Ruling party SILENT on the 500cr scam. We the people deserve real answers. #ExposeTheScam #PeopleDeserveAnswers',
     v_audio, now() - interval '5 minutes', _seed_vec(5)::vector, now() - interval '5 minutes', now() - interval '1 minute'),
    (p5, ta, a5, 'A-BURST-5', 'https://instagram.com/p/aburst5', true,
     'Why so SILENT, ruling party? The 500cr scam — people deserve answers. #ExposeTheScam #PeopleDeserveAnswers',
     v_audio, now() - interval '4 minutes', _seed_vec(5)::vector, now() - interval '4 minutes', now() - interval '1 minute');

  -- identical hashtag set across all 5 accounts → CONTENT coordination signal.
  insert into post_entity (tenant_id, post_id, kind, value)
  select ta, pid, 'hashtag', tag
  from (values (p1),(p2),(p3),(p4),(p5)) p(pid)
  cross join (values ('#exposethescam'),('#peopledeserveanswers')) h(tag);

  -- rising-velocity engagement samples (3 per post → climbing like/comment counts).
  insert into post_metric_sample (tenant_id, post_id, at, like_count, comment_count)
  select ta, p.pid, now() - (s.mins || ' minutes')::interval, s.likes, s.cmts
  from (values (p1),(p2),(p3),(p4),(p5)) p(pid)
  cross join (values (8, 40, 5), (4, 160, 18), (1, 430, 41)) s(mins, likes, cmts);

  -- hostile comments on the burst (signature dim 5 → attach to the burst narrative; sentiment hostile
  -- → counted as author-network volume). Distinct author_hash so author_network does NOT false-fire.
  insert into comment (tenant_id, post_id, author_hash, body, created_at, ingested_at,
                       embedding, sentiment, sentiment_confidence, language)
  values
    (ta, p1, 'demo_ch_0001', 'This party is totally corrupt, they betrayed us. Resign now!',
     now() - interval '7 minutes', now() - interval '7 minutes', _seed_vec(5)::vector, 'hostile', 0.93, 'en'),
    (ta, p2, 'demo_ch_0002', 'Broken promise after broken promise. Shame on these liars.',
     now() - interval '6 minutes', now() - interval '6 minutes', _seed_vec(5)::vector, 'hostile', 0.91, 'en'),
    (ta, p3, 'demo_ch_0003', 'Total fraud. They only loot and scam the people.',
     now() - interval '5 minutes', now() - interval '5 minutes', _seed_vec(5)::vector, 'hostile', 0.90, 'en'),
    (ta, p4, 'demo_ch_0004', 'Worst leaders ever, time to resign. We will not forget.',
     now() - interval '4 minutes', now() - interval '4 minutes', _seed_vec(5)::vector, 'hostile', 0.92, 'mixed'),
    (ta, p5, 'demo_ch_0005', 'Fake answers, useless governance. The scam is obvious.',
     now() - interval '3 minutes', now() - interval '3 minutes', _seed_vec(5)::vector, 'hostile', 0.89, 'en'),
    (ta, p1, 'demo_ch_0006', 'Cheaters and liars, the 500cr loot must be exposed.',
     now() - interval '2 minutes', now() - interval '2 minutes', _seed_vec(5)::vector, 'hostile', 0.90, 'en');

  -- two UNRELATED benign A posts (signature dim 40) → a separate, low-volume narrative, NO alert.
  insert into post (tenant_id, tracked_account_id, shortcode, permalink, is_video, caption,
                    taken_at, caption_embedding, first_seen_at, last_sampled_at)
  values
    (ta, a6, 'A-MISC-1', 'https://instagram.com/p/amisc1', false,
     'Massive turnout at the morning roadshow in the north district today.',
     now() - interval '6 hours', _seed_vec(40)::vector, now() - interval '6 hours', now() - interval '6 hours'),
    (ta, a6, 'A-MISC-2', 'https://instagram.com/p/amisc2', false,
     'Volunteers distributing relief kits after the weekend rains. #CommunityFirst',
     now() - interval '5 hours', _seed_vec(40)::vector, now() - interval '5 hours', now() - interval '5 hours');

  -- ================= TENANT B: unrelated benign posts (signature dim 80) =================
  -- No shared audio across >=4 accounts, no identical hashtag spam, outside the temporal window → no
  -- coordination, no alert. Lives under tenant_id = tb so RLS keeps it invisible to Tenant A.
  insert into post (tenant_id, tracked_account_id, shortcode, permalink, is_video, caption,
                    taken_at, caption_embedding, first_seen_at, last_sampled_at)
  values
    (tb, b1, 'B-POST-1', 'https://instagram.com/p/bpost1', false,
     'Sharing our manifesto highlights for the upcoming session. #Vision2027',
     now() - interval '5 hours', _seed_vec(80)::vector, now() - interval '5 hours', now() - interval '5 hours'),
    (tb, b1, 'B-POST-2', 'https://instagram.com/p/bpost2', false,
     'Thank you to everyone who joined the town hall this evening.',
     now() - interval '4 hours', _seed_vec(80)::vector, now() - interval '4 hours', now() - interval '4 hours'),
    (tb, b2, 'B-POST-3', 'https://instagram.com/p/bpost3', false,
     'Behind the scenes from todays constituency visit across the riverside wards.',
     now() - interval '3 hours', _seed_vec(80)::vector, now() - interval '3 hours', now() - interval '3 hours');

  insert into comment (tenant_id, post_id, author_hash, body, created_at, ingested_at,
                       embedding, sentiment, sentiment_confidence, language)
  select tb, p.id, 'demo_bh_0001', 'Great work, proud to support this team.',
         now() - interval '4 hours', now() - interval '4 hours', _seed_vec(80)::vector, 'positive', 0.86, 'en'
  from post p where p.tenant_id = tb and p.shortcode = 'B-POST-1';

  raise notice 'demo seed applied: Tenant A (Indigo Front) burst + Tenant B (Saffron League) benign.';
end $$;

-- helper is single-use; drop it so it never leaks into runtime schema.
drop function if exists _seed_vec(int[]);
