# Deploy & Validate Runbook

How to stand up an OpenPolitics deployment and validate it end-to-end. One shared-schema Supabase
project holds all tenants, isolated by `tenant_id` + RLS (Principle I). The hosted project's
**region is set per the tenant jurisdiction profile** — the launch `IN-DPDP` profile pins an India
region (Principle VIII).

Prereqs on your machine: `supabase` CLI (≥2.39), `deno` (≥2.4), `node` (≥20), Docker, `git`.

---

## 1. Provision the Supabase project (region per jurisdiction)

1. Create a project in the Supabase dashboard. **Region MUST match the launch jurisdiction** — for
   `IN-DPDP` an **India region** (e.g. `ap-south-1` / Mumbai), so personal data stays in-country.
   Note the project ref and DB password.
2. Authenticate and link the CLI:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

## 2. Apply the database schema

```bash
cd backend/supabase
supabase db push        # applies migrations/0001..0007 in order
```
This creates, in order:

| Migration | Brings up |
|---|---|
| `0001_schema.sql` | Multi-tenant tables (tenant, node, tracked_account, work_assignment, submission, post, comment, narrative, …) — every tenant row carries `tenant_id`. |
| `0002_vector.sql` | pgvector columns + HNSW indexes (768-dim) on captions, transcripts, comments. |
| `0003_rls.sql` | Row-level security: tenant isolation + Admin/Analyst least privilege; default deny. |
| `0004_queues.sql` | pgmq `enrich_jobs` / `media_jobs` / `reconcile_jobs` (+ DLQs) and claim/complete/fail RPCs. |
| `0005_cron.sql` | `app_config` (service-role-only), `invoke_function()`, and the `pg_cron` schedule. |
| `0006_views.sql` | Tenant-scoped read surfaces (`security_invoker = on`): narrative_board, coordination_board, amplifier_targets, alert_board, node_coverage. |
| `0007_detection.sql` | The analytics SQL: clustering, lifecycle, coordination, reconciliation + node trust. |

> The embedding dimension is **768** (`0002_vector.sql` + `shared/embeddings.ts`). If you switch
> embedding models, change BOTH together.

## 3. Configure secrets (never in code — see docs/secrets.md)

```bash
supabase secrets set \
  COMMENTER_HASH_KEY="$(openssl rand -hex 32)" \
  NODE_TOKEN_KEY="$(openssl rand -hex 32)" \
  NODE_ENROLMENT_SECRET="$(openssl rand -hex 32)" \
  OPENROUTER_API_KEY=... \
  EMBEDDINGS_PROVIDER=vertex \
  VERTEX_EMBEDDINGS_URL="https://asia-south1-aiplatform.googleapis.com/v1/projects/<p>/locations/asia-south1/publishers/google/models/gemini-embedding-001:predict" \
  VERTEX_SA_EMAIL=... VERTEX_SA_PRIVATE_KEY="..." \
  FRONTEND_ORIGIN="https://<your-deployed-frontend-origin>"
```

- `COMMENTER_HASH_KEY` — keyed HMAC for comment-author hashing at ingest (Principle III). Rotating it
  breaks historical hash continuity by design.
- `NODE_TOKEN_KEY` — keyed HMAC used to derive/verify `node.token_hash`; raw node tokens are never
  stored.
- `NODE_ENROLMENT_SECRET` — signs/validates tenant enrolment codes consumed by `node-register`.
- `OPENROUTER_API_KEY` + the `EMBEDDINGS_*` / `VERTEX_*` block — LLM classification/synthesis and
  embeddings. Prefer an India-region embedding path for `IN-DPDP`.
- `FRONTEND_ORIGIN` — **required in production**: CORS allow-origin for SPA→function calls.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions by
  the platform automatically.

## 4. Wire pg_cron → Edge Functions (`app_config`)

The scheduled pipeline (`0005_cron.sql`) calls each function over authenticated HTTP via
`invoke_function()`, which reads two service-role-only rows from `app_config`. Set **both**, or every
scheduled job is skipped:

```sql
insert into app_config(key, value) values
  ('functions_base_url', 'https://<project-ref>.functions.supabase.co'),
  ('cron_service_key',   '<SERVICE_ROLE_KEY>')
on conflict (key) do update set value = excluded.value;
```

The schedule covers `assign-work`, `enrich`, `media-dispatch`, `detect-narratives`,
`coordination-detect`, `reconcile`, and `retention-purge`.

## 5. Deploy Edge Functions

```bash
# Coordinator (node-token auth — verify_jwt = false, see config.toml):
supabase functions deploy node-register --no-verify-jwt
supabase functions deploy work-lease    --no-verify-jwt
supabase functions deploy submit        --no-verify-jwt
supabase functions deploy heartbeat     --no-verify-jwt

# Pipeline (invoked by pg_cron with the service-role bearer):
supabase functions deploy enrich
supabase functions deploy detect-narratives
supabase functions deploy coordination-detect
supabase functions deploy assign-work
supabase functions deploy reconcile
supabase functions deploy retention-purge      # data-minimisation gate — must be live before real data

# War-room API (signed-in user JWT + RLS):
supabase functions deploy alert-triage
supabase functions deploy detection-settings
```

> The four coordinator functions MUST have JWT enforcement **off** (nodes carry no Supabase JWT; each
> verifies its own tenant-scoped node token by HMAC-matching `node.token_hash`). This matches
> `verify_jwt = false` in `config.toml`; confirm it in the dashboard's function settings.

## 6. Run the media worker

The media worker cannot run inside Edge Functions (it needs a heavy OCR/ASR runtime). Run it as an
always-on container near the database:

```bash
cd backend/media-worker
# Provide DB access + LLM/ASR config via the container env, then:
docker compose up -d        # consumes media_jobs → OCR/ASR → writes media_transcript → discards bytes
```

It drains `media_jobs`, writes `media_transcript`, and clears `post.media_url` once a transcript is
emitted — raw media bytes are never warehoused (Principle III).

## 7. Distribute the node extension (self-hosted enterprise install)

The MV3 node client is distributed by **self-hosted enterprise install**, not a public store:

1. Build `extension/` for the target browser (Chromium/Firefox).
2. Host the packaged extension + update manifest on the tenant's own server.
3. Push it to volunteer machines via enterprise policy (e.g. `ExtensionInstallForcelist` /
   `ExtensionSettings`).
4. A tenant Admin issues a **tenant enrolment code**; each operator registers their node once (see
   `docs/node-network.md`). The node calls `node-register` with the code and receives its node token
   (shown once, stored thereafter only as a hash).

## 8. Create the first tenant + Admin

1. Seed a tenant row (jurisdiction `IN-DPDP`) and an enrolment code.
2. Create the Admin auth user (dashboard → Authentication → Add user, signups are off) and map it to
   the tenant in `tenant_user` with `role = 'admin'`. The Admin manages users, nodes, the target
   list, and detection thresholds; the JWT `tenant_id` claim drives `current_tenant()` for RLS.

## 9. Run the war-room frontend

```bash
cd ../../frontend
cp .env.example .env     # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install && npm run dev
```
Sign in from the landing hero with the Admin's email. For magic-link auth on a hosted frontend, set
the deployed origin in `config.toml` `[auth] site_url` + `additional_redirect_urls`, and set the
`FRONTEND_ORIGIN` function secret to the same origin (§3).

---

## Validate

### Fast path — seed + pipeline without live capture
```bash
psql "$DATABASE_URL" -f backend/supabase/seed/demo_tenant.sql   # two tenants, nodes, captured posts,
                                                                # a coordination burst on tenant A
make pipeline                                                   # enrich → detect-narratives →
                                                                # coordination-detect → assign-work → reconcile
```
Then sign in as a tenant-A Analyst: the narrative board shows labelled clusters with lifecycle, the
coordination card shows the inferred signal from the seeded burst, the amplifier list ranks accounts,
and the node-coverage view shows the scaling-law picture. Sign in as tenant B and confirm **none** of
tenant A's data is visible (Principle I).

### Simulate a node
Register a node with an enrolment code, lease work, submit a capture, and heartbeat — see
`specs/001-opposition-intel/quickstart.md` §2 and `docs/local-dev.md`.

### Run the tests
```bash
make test     # Deno + pgTAP: RLS tenant-isolation property (SC-001), reconciliation/trust,
              # detection, coordination (SC-006), enrich queue, retention purge (SC-005)
```

---

## Launch gates (must close before real data)

- [ ] **Region** matches the jurisdiction profile (India for `IN-DPDP`) — §1.
- [ ] **`retention-purge`** deployed + scheduled (raw text purged at 30 days; `media_url` cleared on
      transcript) — Principle III.
- [ ] **`app_config`** has `functions_base_url` + `cron_service_key`, else **no cron job runs** — §4.
- [ ] **Coordinator functions** have JWT enforcement off — §5.
- [ ] **`FRONTEND_ORIGIN`** set to the deployed SPA origin — §3.
- [ ] **Jurisdiction profile accepted** and risk owned by founder/tenant — `docs/compliance.md`.
