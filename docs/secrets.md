# Secrets & Credentials (T005)

All secrets live in **Supabase Vault** (or Edge Function secrets) — never in code or git.
The frontend uses only the public anon key; the service-role key is backend-only.

| Secret | Used by | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | `analyze-comments`, `detect-narratives` | Gemini 2.5 Flash / Flash-Lite via OpenRouter |
| `GEMINI_EMBEDDING_API_KEY` | `analyze-comments` | Direct Gemini embedding endpoint (Google AI / Vertex) |
| `IG_APP_ID`, `IG_APP_SECRET` | `oauth-*`, `ig-webhook` | Facebook Login app for Instagram Graph API |
| `IG_WEBHOOK_VERIFY_TOKEN` | `ig-webhook` | Webhook subscription verification |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET` | `oauth-*`, `ingest-youtube` | YouTube Data API v3 (OAuth) |
| `COMMENTER_HASH_KEY` | `shared/hash.ts` | Keyed hash for commenter anonymization (Principle III) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | Backend only; never exposed to the client |

## Setup
1. Create the Supabase project in an **India region** (Principle III).
2. Set Edge Function secrets: `supabase secrets set OPENROUTER_API_KEY=... GEMINI_EMBEDDING_API_KEY=... ...`
3. Store `COMMENTER_HASH_KEY` as a strong random value; rotating it re-anonymizes (breaks
   historical hash continuity by design).
4. Copy `frontend/.env.example` → `frontend/.env` with the project URL + anon key.
