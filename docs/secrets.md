# Secrets & Credentials

No secret lives in code or git. Secrets have two homes: most are **Edge Function secrets** (env), and
the two values `pg_cron` needs to call functions live in the **`app_config`** table (service-role-only,
no RLS policy → only the service role can read them). The frontend uses only the public anon key; the
service-role key is backend-only. No raw commenter handle, node token, or session cookie is ever
stored or logged.

| Secret | Used by | Notes |
|---|---|---|
| `COMMENTER_HASH_KEY` | `shared/hash.ts` (at ingest, in `submit`/`enrich`) | Keyed HMAC for comment-author hashing (Principle III). Rotating it breaks historical hash continuity by design. |
| `NODE_TOKEN_KEY` | `shared/node-auth.ts` (`node-register` / `work-lease` / `submit` / `heartbeat`) | Keyed HMAC used to derive/verify `node.token_hash`. Raw node tokens are shown once at register and never stored. |
| `NODE_ENROLMENT_SECRET` | `node-register` | Signs/validates tenant enrolment codes a node redeems on first run. |
| `OPENROUTER_API_KEY` | `enrich`, `detect-narratives`, `coordination-detect` | Gemini 2.5 Flash / Flash-Lite via OpenRouter (classification + synthesis). |
| `EMBEDDINGS_PROVIDER` + `VERTEX_EMBEDDINGS_URL` | `shared/embeddings.ts` | 768-dim embeddings; for `IN-DPDP` prefer an India-region (`asia-south1`) Vertex `:predict` URL. |
| `VERTEX_SA_EMAIL`, `VERTEX_SA_PRIVATE_KEY` | `shared/embeddings.ts` | Service account to mint Vertex access tokens (cloud). |
| `FRONTEND_ORIGIN` | all war-room-facing functions | CORS allow-origin for SPA→function calls. **Required in production.** |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | Backend only; bypasses RLS; never exposed to the client. |
| `functions_base_url`, `cron_service_key` (in `app_config`) | `invoke_function()` (pg_cron) | Base URL + service-role bearer so scheduled jobs can call Edge Functions (see `0005_cron.sql`, `docs/deploy.md` §4). |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions
by the platform automatically — they are not set by hand.

## Setup
1. Create the Supabase project in the **region matching the tenant jurisdiction** (India for the
   launch `IN-DPDP` profile — Principle VIII).
2. Set the function secrets (strong random for the three keyed secrets):
   ```bash
   supabase secrets set \
     COMMENTER_HASH_KEY="$(openssl rand -hex 32)" \
     NODE_TOKEN_KEY="$(openssl rand -hex 32)" \
     NODE_ENROLMENT_SECRET="$(openssl rand -hex 32)" \
     OPENROUTER_API_KEY=... EMBEDDINGS_PROVIDER=vertex VERTEX_EMBEDDINGS_URL=... \
     VERTEX_SA_EMAIL=... VERTEX_SA_PRIVATE_KEY="..." \
     FRONTEND_ORIGIN="https://<deployed-frontend-origin>"
   ```
3. Set the two `app_config` rows so `pg_cron` can invoke functions (see `docs/deploy.md` §4):
   `functions_base_url` and `cron_service_key`.
4. Copy `frontend/.env.example` → `frontend/.env` with the project URL + anon key (anon key only —
   never the service-role key).

> Node tokens are tenant-scoped and revocable: an Admin can revoke a node (`node.status = revoked`)
> and it stops being leased work immediately. Enrolment codes are single-tenant and expire.
