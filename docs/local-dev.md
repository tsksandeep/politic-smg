# Local Development

The entire local stack runs as **one self-hosted Docker Compose project** — no Supabase CLI needed. A
single `docker compose up` (or `make up`) brings up Postgres, Auth (GoTrue), REST (PostgREST),
Realtime, Storage, the Kong API gateway, Edge Functions (edge-runtime), plus MailHog (email capture)
and an external-API/LLM **mock**, then applies migrations, seeds a demo, and seeds the realtime
tenant. The **media-worker** is included as an optional (commented) service — bring it up only when
you want OCR/ASR locally.

## Why self-hosted compose
Every backend service is a first-class compose service pinned to the exact image the Supabase CLI
uses, so behaviour matches a real Supabase project — but it's one stack you control. See
`docker-compose.yml` and `backend/docker/` (Kong routes, db bootstrap, the migration runner, the
edge-runtime router, the realtime seed).

## Prerequisites
- Docker (Desktop on macOS/Windows). ~4 GB free RAM.
- Deno ≥ 2.4 only if you want `make fmt` / `make test` on the host.

## First run
```bash
cp .env.local.example .env.local   # mock + secrets config (defaults to fully offline)
make up                            # docker compose up -d: Postgres, Auth, Realtime, Storage, edge runtime, kong
make migrate                       # apply backend/supabase/migrations 0001..0007 (multi-tenant schema + RLS)
make seed                          # backend/supabase/seed/demo_tenant.sql — two tenants, nodes, captured posts
```
`make up` applies migrations and the demo seed on first run automatically; `make migrate` / `make
seed` are there to re-run explicitly.

Open the war-room at **http://localhost:5173**. Magic-link emails land in **MailHog**
(**http://localhost:8025**).

## The demo seed (`demo_tenant.sql`)
Seeds **two** tenants so you can prove isolation, each with registered nodes, tracked opposition
accounts, captured public posts, and metric samples. Tenant A includes a planted **coordination
burst** — several near-duplicate captions sharing one reel `audio_id` in a short window — so
coordination detection trips with a labelled **inferred** signal, while an isolated post does not
(SC-006).

## Run the pipeline
```bash
make pipeline      # enrich → detect-narratives → coordination-detect → assign-work → reconcile
```
This invokes the five pipeline Edge Functions in order with the local service-role bearer (the same
way `pg_cron` invokes them in production via `app_config`). Or just let the seeded `pg_cron`
schedules fire on their own.

## Open the war-room
Sign in as a seeded **tenant-A Analyst**. You should see: the narrative board (labelled clusters +
lifecycle), a coordination card (inferred), the amplifier list, and the node-coverage / scaling-law
view. Then sign in as the **tenant-B** user and confirm **none** of tenant A's accounts, posts,
narratives, nodes, or work is visible (Principle I).

## Register a simulated node and exercise the coordinator
No real scraping — drive the coordinator endpoints by hand. A tenant Admin issues an enrolment code
(see the `make seed` output), then:

```bash
FN=http://localhost:54321/functions/v1

# 1. Register (consumes the enrolment code; returns the node token ONCE)
curl -sX POST $FN/node-register -H 'Content-Type: application/json' \
  -d '{"enrolment_code":"<code>","label":"laptop-1"}'
#   → { node_id, node_token, tenant_id, rate }

# 2. Lease work (tenant-A assignments only, rate-capped + redundancy-aware)
curl -sX POST $FN/work-lease -H "Authorization: Bearer <node_token>" \
  -H 'Content-Type: application/json' -d '{"max_items":5}'

# 3. Submit a capture (author handles HMAC-hashed + discarded server-side)
curl -sX POST $FN/submit -H "Authorization: Bearer <node_token>" \
  -H 'Content-Type: application/json' -d @capture.json

# 4. Heartbeat liveness/health (drives the coverage view)
curl -sX POST $FN/heartbeat -H "Authorization: Bearer <node_token>" \
  -H 'Content-Type: application/json' -d '{"ok_count":5,"error_count":0,"ip_status":"healthy"}'
```
A node leasing or submitting for another tenant's work is denied at the DB layer (Principle I).

## Endpoints
| URL | What |
|---|---|
| http://localhost:5173 | War-room SPA |
| http://localhost:54321 | Supabase API gateway (Kong → rest / auth / realtime / storage / functions) |
| http://localhost:8025 | MailHog inbox (magic-link emails) |
| http://localhost:54322 | Postgres (`postgres:postgres`) |
| http://localhost:9100 | External-API / LLM mock |

## Everyday commands
| Command | Does |
|---|---|
| `make up` / `make down` | Start / stop the stack (keeps data) |
| `make migrate` | Apply migrations 0001..0007 |
| `make seed` | (Re-)seed `demo_tenant.sql` (only seeds a fresh DB) |
| `make pipeline` | Run enrich → detect-narratives → coordination-detect → assign-work → reconcile |
| `make test` | Deno + pgTAP tests against the running stack |
| `make fmt` | Format Edge Function / shared / test code |

## LLM + embeddings: mock / local / cloud
`.env.local` selects the provider by env only — no code change (`shared/llm.ts`,
`shared/embeddings.ts`):

- **Mock (default)** — `OPENROUTER_BASE` + `VERTEX_EMBEDDINGS_URL` point at the mock; fully offline,
  deterministic.
- **Local real models** — point both at an OpenAI-compatible server (e.g. LM Studio at
  `http://host.docker.internal:1234/v1`): set `OPENROUTER_BASE` + `OPENROUTER_MODEL`,
  `LLM_RESPONSE_FORMAT=none`, and `EMBEDDINGS_PROVIDER=openai` + `EMBEDDINGS_BASE` + `EMBEDDINGS_MODEL`
  (a 768-dim model, matching `vector(768)`).
- **Cloud** — a real `OPENROUTER_API_KEY` + Vertex embeddings via a service account
  (`EMBEDDINGS_PROVIDER=vertex`, `VERTEX_SA_*`, asia-south1 URL).

## Media worker (optional locally)
OCR/ASR is heavy, so the media-worker service is **commented out** in `docker-compose.yml`. To run it:
uncomment the `media-worker` service (or `cd backend/media-worker && docker compose up`). It consumes
`media_jobs`, writes `media_transcript`, and discards the raw media bytes (Principle III).

## Verify the invariants
```bash
make test
```
Key assertions: cross-tenant select/insert/update is denied at the DB layer (SC-001); no
`comment.author_raw` and no `post.media_url` survive once enrichment + retention run (SC-005); a
single isolated post does not raise a coordination signal but the seeded burst does (SC-006).

## How it bootstraps (notes)
- **`db`** uses the `supabase/postgres` image; a one-time init script
  (`backend/docker/db-init/99-init.sql`) sets role passwords and registers the JWT secret.
- **`migrate`** (one-shot) waits for `auth.users` (GoTrue), applies `migrations/*.sql` in order, and
  seeds a fresh DB; it's idempotent (tracks applied files in `_app_migrations`).
- **`realtime-init`** (one-shot) seeds the Realtime tenant so the live board's websocket connects.
- **Edge Functions** mount only `functions/` + `shared/`. External base URLs come from `.env.local`;
  prod leaves them unset (real APIs).
- **Production provisioning** (real Supabase project, region per jurisdiction) — see
  [`docs/deploy.md`](deploy.md).
