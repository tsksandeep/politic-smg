# Local Development

The entire local stack runs as **one self-hosted Docker Compose project** — no Supabase CLI. A
single `docker compose up` brings up Postgres, Auth (GoTrue), REST (PostgREST), Realtime, the Kong
API gateway, Edge Functions (edge-runtime), **MailHog** (email capture), the external-API **mock**,
and the Vite frontend, then applies migrations, seeds the demo, and seeds the realtime tenant.

## Why self-hosted compose
Every backend service is a first-class compose service pinned to the exact image the Supabase CLI
uses, so behaviour matches a real Supabase project — but it's all in one stack you control, with
**MailHog** swapped in for email and the external-API mock wired in. No Docker socket mounting, no
CLI orchestrator. See `docker-compose.yml` and `backend/docker/` (Kong routes, db bootstrap, the
migration runner, the edge-runtime router, realtime seed).

## Prerequisites
- Docker (Desktop on macOS/Windows). ~4 GB free RAM.
- Deno ≥ 2.4 only if you want to run `make lint` / `make test` / `make e2e` on the host.

## First run
```bash
cp .env.local.example .env.local   # 3rd-party + mock config (defaults to fully offline)
make up                            # or: docker compose up -d
make user EMAIL=you@party.test     # provision a war-room user (sign-ups are disabled)
```
Open the app at **http://localhost:5173**. Enter that email on the landing page → a magic link is
sent to **MailHog** (open **http://localhost:8025**), click it, and you land on the board.

The board comes pre-seeded (favourable best/worst narratives, anti-party narratives, cadre
coverage). To promote your user to Admin: `make psql` then
`update app_user set role='admin' where id=(select id from auth.users where email='you@party.test');`

## Endpoints
| URL | What |
|---|---|
| http://localhost:5173 | Frontend (war-room board) |
| http://localhost:54321 | Supabase API gateway (Kong → rest / auth / realtime / functions) |
| http://localhost:8025 | MailHog inbox (magic-link emails) |
| http://localhost:54322 | Postgres (`postgres:postgres`) |
| http://localhost:9100 | External-API mock (Meta/Google/OpenRouter/Gemini) |

## Everyday commands
| Command | Does |
|---|---|
| `make up` / `make down` | Start / stop the stack (keeps data) |
| `make reset` | Wipe data + recreate from scratch (re-migrates + re-seeds) |
| `make logs SVC=functions` | Tail logs for one service (omit `SVC=` for all) |
| `make ps` | Service status |
| `make user EMAIL=…` | Provision a war-room user |
| `make mail` | Open the MailHog inbox |
| `make psql` | psql shell on the database |
| `make e2e` | Comprehensive backend e2e against the running stack |
| `make lint` / `make fmt` / `make test` | Deno lint / format / DB-backed tests |

## LLM: mock vs real
`.env.local` controls the LLM. By default it points `OPENROUTER_BASE` at the local mock (fully
offline, deterministic). To use the real model, set a real `OPENROUTER_API_KEY` and
`OPENROUTER_BASE=https://openrouter.ai/api/v1` (and `OPENROUTER_MODEL`). Embeddings + platform
OAuth/data stay mocked unless you also provide real Gemini / Meta / Google credentials.

## How it bootstraps (notes & gotchas)
- **`db`** uses the `supabase/postgres` image. A one-time init script
  (`backend/docker/db-init/99-init.sql`, mounted to sort *after* the image's own scripts) sets the
  supabase role passwords, creates the `_realtime` schema, and registers the JWT secret.
- **`migrate`** (one-shot) waits for `auth.users` (GoTrue), then applies `migrations/*.sql` in order
  and seeds a fresh DB. It's **idempotent** (tracks applied files in `_app_migrations`), so re-running
  `docker compose up` is a no-op.
- **`realtime-init`** (one-shot) seeds the Realtime tenant via its API so the live board's websocket
  connects (self-hosted Realtime needs a tenant row). The web app waits for this.
- **Edge Functions** mount only `functions/` + `shared/` (not `deno.lock`, which is newer than the
  runtime's Deno). External base URLs come from `.env.local`; prod leaves them unset (real APIs).
- **Production provisioning** (real Supabase project, India region) is unchanged — see
  [`docs/deploy.md`](deploy.md).
