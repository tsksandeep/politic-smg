# Deploy & Validate Runbook — Politic-SMG (single tenant)

How to stand up one party's tenant and validate the US1 rapid-response wedge. This moves the
"written but unrun" code to "running and validated". One Supabase project **per party**.

Prereqs on your machine: `supabase` CLI (≥2.39), `deno` (≥2.4), `node` (≥20), `git`.

---

## 1. Provision the Supabase project (India region — Principle III)

1. Create a new project in the Supabase dashboard. **Region MUST be an India region**
   (e.g. `ap-south-1` / Mumbai). Note the project ref and DB password.
2. Authenticate and link the CLI:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

## 2. Apply the database schema

```bash
cd backend/supabase
supabase db push        # applies migrations/0001..0011 in order
```
This creates the schema, pgvector columns + HNSW indexes, RLS policies, Auth role trigger,
pgmq queues, pg_cron jobs (with authenticated invocation — 0010), the alert_board view, the
detection + retention functions, and Vault token storage/rotation (0008/0011).

> The embedding dimension is **768** (migration 0002 + `shared/embeddings.ts`). If you switch
> embedding models, change BOTH together.

## 3. Enable Realtime on the alert table

The war-room board subscribes to `alert` changes (FR-006). Add it to the Realtime publication:
```sql
alter publication supabase_realtime add table alert;
```
(Run in the SQL editor, or add as a migration once confirmed on hosted.)

## 4. Configure secrets (never in code — see docs/secrets.md)

First stand up **Nango** (self-hosted, India region): register the `instagram` + `youtube`
integrations with the real Facebook/Google client id+secret, and copy its environment Secret Key.

```bash
supabase secrets set \
  OPENROUTER_API_KEY=... \
  VERTEX_EMBEDDINGS_URL="https://asia-south1-aiplatform.googleapis.com/v1/projects/<p>/locations/asia-south1/publishers/google/models/gemini-embedding-001:predict" \
  VERTEX_SA_EMAIL=... VERTEX_SA_PRIVATE_KEY="..." \
  NANGO_HOST="https://<your-nango-host>" NANGO_SECRET_KEY=... \
  IG_APP_SECRET=... IG_WEBHOOK_VERIFY_TOKEN=... \
  COMMENTER_HASH_KEY="$(openssl rand -hex 32)" \
  FUNCTIONS_BASE_URL="https://<project-ref>.functions.supabase.co" \
  FRONTEND_ORIGIN="https://<your-deployed-frontend-origin>"
```
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge
  Functions automatically by the platform.
- Cadre OAuth + token storage/refresh is handled by **Nango** (the app only needs `NANGO_HOST` +
  `NANGO_SECRET_KEY`); platform OAuth client creds live inside Nango, not here.
- `FUNCTIONS_BASE_URL` is the inter-function call base (oauth-callback → backfill).
- `FRONTEND_ORIGIN` is **required in production**: it is the CORS allow-origin for the SPA→function
  calls AND where `oauth-callback` redirects the cadre's browser after consent. If unset it
  defaults to `*` (CORS) and `http://localhost:5173` (the redirect), which is wrong off your laptop.

## 5. Wire pg_cron → Edge Functions

The cron jobs invoke functions over authenticated HTTP (migration 0010). Set **both** the base
URL and the service-role key, or every scheduled job (analyze/detect/ingest/refresh/purge) is
skipped or rejected:
```sql
-- Base URL (persists across sessions):
alter database postgres set app.functions_base_url = 'https://<project-ref>.functions.supabase.co';

-- Service-role key in Vault — sent as the Bearer so the gateway's verify_jwt check passes
-- (analyze-comments, detect-narratives, ingest-youtube, retention-purge):
select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
```
> `ig-webhook` and `oauth-callback` are public (no JWT) and are declared `verify_jwt = false`
> in `config.toml`; the dashboard's function settings must match (disable "Enforce JWT").

## 6. Deploy Edge Functions

```bash
# Detection pipeline + war-room API:
supabase functions deploy analyze-comments
supabase functions deploy detect-narratives
supabase functions deploy detection-settings
supabase functions deploy alert-detail
supabase functions deploy alert-triage
# Onboarding / consent (US2):
supabase functions deploy oauth-start
supabase functions deploy oauth-callback     # public: set Enforce-JWT = off (config.toml verify_jwt=false)
supabase functions deploy accounts
supabase functions deploy account-revoke
supabase functions deploy backfill
# Ingestion + retention:
supabase functions deploy ig-webhook         # public: set Enforce-JWT = off (config.toml verify_jwt=false)
supabase functions deploy retention-purge    # LAUNCH-BLOCKING — must be live before real data
# YouTube path — deploy only after the quota audit is approved (docs/quota-audit.md):
# supabase functions deploy ingest-youtube    # also requires YT_INGEST_ENABLED=true
```

## 7. Create the first Admin

1. Create a user (dashboard → Authentication → Add user, or admin API). The Auth trigger
   (migration 0004) mirrors them into `app_user` as `analyst`.
2. Promote to admin (SQL editor):
   ```sql
   update app_user set role = 'admin'
   where id = (select id from auth.users where email = 'admin@party.example');
   ```

## 8. Register the Instagram webhook

In the Meta app dashboard, subscribe the app to Instagram `comments` webhooks pointing at
`https://<project-ref>.functions.supabase.co/ig-webhook`, using `IG_WEBHOOK_VERIFY_TOKEN`.

## 9. Run the frontend

```bash
cd ../../frontend
cp .env.example .env     # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install && npm run dev
```
Sign in from the landing hero: enter the Admin's party email → a Supabase magic link is sent
(`signInWithOtp`) → it returns to `/board`, where `RequireAuth` establishes the session.

> For magic-link auth to work on the **hosted** frontend, set the deployed origin in
> `config.toml` `[auth] site_url` + `additional_redirect_urls` (and the dashboard Auth URL
> config), and set the function secret `FRONTEND_ORIGIN` to that same origin (§4).

---

## Validate the wedge

### Fast path — demo without external APIs (recommended first)
Seed a synthetic hostile burst (pre-embedded, so no Gemini call needed) and run detection:
```bash
psql "$DATABASE_URL" -f backend/supabase/seed/demo_burst.sql
psql "$DATABASE_URL" -c "select run_detection();"
```
Then watch `/board` — an alert should appear live (Realtime). This exercises detection →
alert → board → anonymized detail end-to-end (quickstart **V1**, minus live ingestion).

### Full path
Follow `specs/001-rapid-response/quickstart.md` scenarios **V1–V5** against real connected
accounts (V2 onboarding requires US2, not yet built).

### Run the test suite
```bash
# Deno tests (DB-backed ones activate when DATABASE_URL is set):
cd backend/supabase
DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" \
  deno test --allow-env --allow-net --allow-read tests/

# pgTAP RLS test:
pg_prove -d "$DATABASE_URL" tests/rls_settings_test.sql
```

---

## Launch gates (must close before real data — Principle III / VII)
- [x] **T045** retention-purge function implemented + scheduled (raw text deleted at 30 days).
- [ ] **T046** India residency confirmed; DPDP retention/lawful-basis documented.
- [ ] **T047** YouTube quota audit approved (or YouTube path left disabled, Instagram-only).

### Wiring checklist (close before the pipeline runs end-to-end)
- [ ] `app.functions_base_url` set, and `service_role_key` stored in Vault (§5) — else **no cron
      job runs** (analyze/detect/refresh/purge all skip).
- [ ] `FRONTEND_ORIGIN` function secret set to the deployed SPA origin (§4) — else cadres are
      redirected to localhost after consent and SPA→function calls are CORS-blocked off-laptop.
- [ ] `ig-webhook` and `oauth-callback` have Enforce-JWT disabled in the dashboard (§6).
- [ ] Realtime enabled on `alert` (§3) — else the board doesn't update live.
