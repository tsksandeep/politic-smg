# Secrets & Credentials (T005)

All secrets live in **Supabase Vault** (or Edge Function secrets) — never in code or git.
The frontend uses only the public anon key; the service-role key is backend-only.

| Secret | Used by | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | `analyze-comments`, `detect-narratives` | Gemini 2.5 Flash / Flash-Lite via OpenRouter |
| `VERTEX_EMBEDDINGS_URL` | `analyze-comments` | Vertex AI `gemini-embedding-001` `:predict` URL (asia-south1 for India residency) |
| `VERTEX_SA_EMAIL`, `VERTEX_SA_PRIVATE_KEY` | `shared/embeddings.ts` | Service account to mint Vertex access tokens (prod) |
| `NANGO_HOST`, `NANGO_SECRET_KEY` | `oauth-start`, `oauth-callback`, `backfill`, `ingest-youtube` | Self-hosted Nango — manages cadre OAuth + token storage/refresh |
| `IG_APP_SECRET` | `ig-webhook` | Instagram comment webhook HMAC verification (separate from Nango) |
| `IG_WEBHOOK_VERIFY_TOKEN` | `ig-webhook` | Webhook subscription verification |
| `COMMENTER_HASH_KEY` | `shared/hash.ts` | Keyed hash for commenter anonymization (Principle III) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | Backend only; never exposed to the client |
| `app.functions_base_url`, `service_role_key` (Vault) | `invoke_edge_function` (pg_cron) | Supabase Cron → Edge Function invocation (see deploy.md) |

> Platform OAuth **client** credentials (Instagram via Facebook Login, YouTube via Google) are no
> longer Edge Function secrets — they are configured **inside Nango** per integration. The app only
> needs `NANGO_HOST` + `NANGO_SECRET_KEY`. Nango stores and auto-refreshes per-cadre tokens, so there
> is no per-cadre token vault or token-refresh job in the app anymore.

## Setup
1. Create the Supabase project in an **India region** (Principle III).
2. Stand up **Nango** (self-hosted, India region): register the `instagram` + `youtube` integrations
   with the real Facebook/Google client id+secret, then copy the environment **Secret Key**.
3. Set Edge Function secrets: `supabase secrets set OPENROUTER_API_KEY=... VERTEX_EMBEDDINGS_URL=...
   VERTEX_SA_EMAIL=... VERTEX_SA_PRIVATE_KEY=... NANGO_HOST=... NANGO_SECRET_KEY=... IG_APP_SECRET=...`
4. Store `COMMENTER_HASH_KEY` as a strong random value; rotating it re-anonymizes (breaks
   historical hash continuity by design).
5. Copy `frontend/.env.example` → `frontend/.env` with the project URL + anon key + `VITE_NANGO_HOST`.
