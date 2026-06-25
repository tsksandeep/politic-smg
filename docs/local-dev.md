# Local Development

A one-command local stack that mirrors production: Supabase (Postgres + pgvector + pgmq +
pg_cron + Vault, Auth, Realtime, Storage, Studio, Edge Runtime) plus the Vite dashboard.

## Why this shape (not a hand-rolled all-in-one compose)

The Supabase CLI (`supabase start`) **already runs the full backend as a managed Docker Compose
stack** — it's the officially recommended local approach, stays in lockstep with production, and
applies our `migrations/` automatically. Re-implementing all of those services in a custom
`docker-compose.yml` is what the *self-hosting* guide is for, and it drifts from prod. So:

- **Backend** → Supabase CLI (Docker under the hood). Our `backend/supabase/config.toml` pins
  ports, schemas (incl. `pgmq_public`), auth, and the edge runtime.
- **Frontend** → our `docker-compose.yml` (`web` service) runs the Vite dev server in a
  container with HMR tuned for Docker (`host:true`, `strictPort`, polling, explicit HMR port).
- **Glue** → the `Makefile` drives the whole loop.

Sources: [Supabase Local Dev & CLI](https://supabase.com/docs/guides/local-development),
[supabase start](https://supabase.com/docs/reference/cli/supabase-start),
[PGMQ extension](https://supabase.com/docs/guides/queues/pgmq),
[Self-hosted Functions](https://supabase.com/docs/guides/self-hosting/self-hosted-functions),
[Containerized React/Vite dev](https://docs.docker.com/guides/reactjs/develop/).

## Prerequisites
- Docker (Supabase local needs ~3–4 GB RAM free)
- Supabase CLI ≥ 2.39, Deno ≥ 2.4, Node ≥ 20, `psql`

## First run
```bash
cp .env.local.example .env.local      # pre-pointed at the local mock APIs (no real keys needed)
cp frontend/.env.example frontend/.env # (compose injects these; file is a fallback)

make up           # starts Supabase (applies all migrations) + writes .env + starts web
make functions    # in a SECOND terminal — hot-reloading Edge Functions
make demo         # seed a synthetic hostile burst + run detection (no external APIs)
```
Open the app at **http://localhost:5173** (board) and Studio at **http://localhost:54323**.
After `make demo`, the war-room board lights up via Realtime — the wedge, end-to-end, locally.

## Full pipeline locally with mocked external APIs
`make demo` seeds the DB directly. To exercise the **entire** code path — OAuth consent →
ingestion → LLM classification → embeddings → detection — with zero real credentials, the repo
ships a mock that stands in for every external API (Meta Graph, Google OAuth, YouTube Data API,
OpenRouter, Gemini). See `backend/supabase/mocks/server.ts`.

**One command (starts mock + functions, runs the e2e test, tears down):**
```bash
make start        # if not already running
make e2e
```
This drives `oauth-start → oauth-callback → backfill → analyze-comments → detect-narratives`
against the mock and asserts a live, summarized alert appears (`tests/e2e_local_test.ts`).

**Or run it interactively** (to click through the app against mocks):
```bash
make mock         # terminal 1 — mock APIs on :9100
make functions    # terminal 2 — functions read mock URLs from .env.local
```

**How prod vs local stays identical:** every external base URL lives in
`backend/supabase/shared/endpoints.ts`, read from an env var with the **real endpoint as the
default**. `.env.local` overrides them to the mock; production leaves them unset. No code path
branches on environment — only the env values differ. The API bases use `host.docker.internal`
(the edge-runtime container reaching the host); the browser-facing consent dialogs use
`localhost`. The mock listens on both.

## Everyday commands
| Command | Does |
|---|---|
| `make up` | Supabase + frontend (then run `make functions` separately) |
| `make functions` | Serve Edge Functions with hot reload |
| `make mock` | Run the mock external-API server (:9100) |
| `make e2e` | Full mocked end-to-end run (mock + functions + assert a live alert) |
| `make migrate` | Apply newly added migrations |
| `make reset` | Recreate the DB and re-apply ALL migrations |
| `make demo` | Seed the no-API hostile-burst demo + run detection |
| `make test` | Run DB-backed Deno tests against the local stack |
| `make lint` / `make fmt` | Lint / format Edge Function code |
| `make web-logs` | Tail the Vite container |
| `make down` | Stop web + Supabase (keeps data) |
| `make clean` | Stop everything and wipe local Supabase data |

## Creating a local admin
Sign-ups are disabled. Create a user in Studio (Authentication) — the trigger mirrors them into
`app_user` as `analyst` — then promote:
```sql
update app_user set role='admin'
where id = (select id from auth.users where email='you@example.com');
```

## Notes & gotchas
- **The browser talks to Supabase at `http://localhost:54321` directly** — the `web` container
  only serves JS. No cross-container networking needed for that path.
- **Local keys aren't secrets.** `supabase start` prints fixed local anon/service keys; `make env`
  captures the anon key into the git-ignored root `.env` for compose.
- **Edge Functions** auto-receive `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL`; only 3rd-party keys live in `.env.local`.
- **pg_cron** jobs no-op locally until `app.functions_base_url` is set (see `docs/deploy.md`);
  drive functions manually in dev (e.g. `curl localhost:54321/functions/v1/detect-narratives`).
- **YouTube** ingestion stays gated by the quota audit even locally — develop Instagram-first.
- Production provisioning/deploy lives in [`docs/deploy.md`](deploy.md).
