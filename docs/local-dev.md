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

## LLM + embeddings: mock / local / cloud
`.env.local` selects the provider by env only — no code change (`shared/llm.ts`, `shared/embeddings.ts`):

- **Mock (default)** — `OPENROUTER_BASE` + `VERTEX_EMBEDDINGS_URL` point at the mock; fully offline,
  deterministic.
- **Local real models** — point both at an **OpenAI-compatible server** (e.g. LM Studio at
  `http://host.docker.internal:1234/v1`): set `OPENROUTER_BASE` + `OPENROUTER_MODEL`,
  `LLM_RESPONSE_FORMAT=none` (LM Studio rejects `json_object`; JSON is steered by prompt + robust
  extraction), and `EMBEDDINGS_PROVIDER=openai` + `EMBEDDINGS_BASE` + `EMBEDDINGS_MODEL`
  (EmbeddingGemma is 768-dim, matching `vector(768)`). LM Studio must **serve on the local network**
  (not just 127.0.0.1) so the edge-runtime container can reach `host.docker.internal`. No key needed.
  Reasoning models (e.g. gemma-4) are slower per comment — fine for validation; keep batches small.
- **Cloud** — real `OPENROUTER_API_KEY` + `OPENROUTER_BASE=https://openrouter.ai/api/v1`, and Vertex
  embeddings via a service account (`EMBEDDINGS_PROVIDER=vertex`, `VERTEX_SA_*`, asia-south1 URL).

Platform OAuth/data (Instagram/YouTube) stay mocked via Nango's `providers.yaml` unless you wire real
Meta/Google credentials into Nango. See `.env.local.example` for the full annotated matrix.

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
