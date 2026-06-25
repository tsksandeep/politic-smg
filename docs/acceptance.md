# Acceptance — Local Validation Run (T050)

Recorded from a real local run: `supabase start` (Postgres 15.8) + Edge Functions served +
Vite container. All quickstart V1–V5 scenarios exercised against the live stack.

## Stack & schema
- ✅ `supabase start` — all **9 migrations applied** cleanly (0001–0009).
- ✅ Extensions present: `vector`, `pgmq`, `pg_cron`, `pg_net`, `pgcrypto`, `supabase_vault`.
- ✅ 9 tables; 9 functions (`run_detection`, `recompute_after_revoke`, `purge_expired_data`,
  `set_comment_analysis`, `store_account_token`, `read_account_token`, `current_app_role`,
  `is_admin`, `is_staff`).
- ✅ `alert_board` view created with `security_invoker = on`; 11 RLS policies; `detection_settings` seeded.

## Edge Functions (served via `supabase functions serve`)
- ✅ `detect-narratives` → `200 {"summarized":0}` (boots; runs `run_detection`).
- ✅ `oauth-callback?state=bad` → `400 {"error":"bad_state"}` (no data created).
- ✅ `alert-detail` (staff JWT) → returns `confidence_signal` (`isSignalNotVerdict:true`,
  labeled), **no commenter identity** in payload.

## Scenario results
| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| V1 | Hostile burst → alert on board | ✅ | demo seed (40 hostile) → 1 narrative (vol 40, coord 1.00) → 1 `open` alert; `alert_board` row `{posts:1,cadres:1}` |
| V1 | Positive surge → no alert | ✅ | `healthy_spike_test` passes (0 alerts) |
| V2 | Revoke → data drops out of active alerts | ✅ | `onboarding_test` passes (alert auto-closed after revoke) |
| V2 | Unsupported account → guidance, no data | ✅ | `unsupported_account_test` passes (`400`, no row) |
| V3 | Triage acknowledge→close → latency recorded | ✅ | `triage_test` passes (`response_latency` ≈ 5 min) |
| V4 | Privacy: only `commenter_hash`, no raw handle | ✅ | `anonymization_test` passes (keyed hash; no identity column) |
| V5 | RLS: analyst denied write, admin allowed | ✅ | analyst `UPDATE` → 0 rows; admin `UPDATE` → 1 row |
| V5 | Contract: confidence present, no identity | ✅ | `warroom_api_test` passes |

## Test suite
`deno test` against the live DB + served functions: **8 passed, 0 failed**
(6 DB-backed + `unsupported_account` + `warroom_api`).

## Frontend
- ✅ `docker compose up web` → Vite ready; `GET /` → `200`; `/src/main.tsx` transforms (`200`).

## Fixes made during validation
1. `config.toml`: removed `pgmq_public` from exposed API schemas (PostgREST schema-cache error;
   pgmq is used only inside SQL).
2. Edge functions: switched `@supabase/supabase-js` to the `npm:` specifier (edge runtime does
   not read our `deno.json` import map → boot error).
3. `recompute_after_revoke`: zero narratives by **connected-only** comments so a revoked
   account's alert auto-closes even before the physical purge (caught by `onboarding_test`).
4. DB-backed tests: `truncate ... restart identity cascade` for isolation (global `run_detection`).

## Still external (not validatable locally)
- T006/T047 — YouTube Data API quota audit (Google process).
- Live Instagram/YouTube ingestion + Gemini/OpenRouter classification (need real API keys);
  detection/clustering validated via pre-embedded synthetic data instead.
