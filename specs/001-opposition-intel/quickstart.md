# Quickstart: Opposition Narrative Intelligence (local)

Bring up the full stack locally and exercise the pipeline end-to-end with a no-network demo seed —
no live scraping, no external LLM keys required (point the LLM/embeddings at a local OpenAI-compatible
server, or use the seeded vectors).

## Prerequisites

- Docker + Docker Compose
- Supabase CLI
- Deno (for Edge Functions / tests)
- Node 20+ (war-room + extension build)
- Python 3.13 (media worker / scraper reference)

## 1. Backend up

```bash
make up                 # docker-compose: Postgres, Auth, Realtime, Storage, edge runtime
make migrate            # apply backend/supabase/migrations in order (multi-tenant schema + RLS)
make seed               # backend/supabase/seed/demo_tenant.sql — two tenants, nodes, captured posts
```

Environment (`.env.local`, see `.env.local.example`):
- `COMMENTER_HASH_KEY` — HMAC key for author hashing (required).
- `OPENROUTER_*` / `EMBEDDINGS_*` — point at hosted Gemini or a local OpenAI-compatible server.
- `NODE_ENROLMENT_SECRET` — signs tenant enrolment codes.

## 2. Register a node and lease work (simulated)

```bash
# Admin issues an enrolment code for tenant A (see make seed output), then:
curl -sX POST $FN/node-register -d '{"enrolment_code":"<code>","label":"laptop-1"}'
#   → { node_id, node_token, rate }

curl -sX POST $FN/work-lease -H "Authorization: Bearer <node_token>" -d '{"max_items":5}'
#   → tenant-A assignments only

curl -sX POST $FN/submit -H "Authorization: Bearer <node_token>" -d @capture.json
curl -sX POST $FN/heartbeat -H "Authorization: Bearer <node_token>" \
     -d '{"ok_count":5,"error_count":0,"ip_status":"healthy"}'
```

## 3. Run the pipeline

```bash
make pipeline           # enrich → detect-narratives → coordination-detect → assign-work → reconcile
```

Or rely on the seeded pg_cron schedules. The demo seed includes a near-duplicate-caption +
shared-`audio_id` burst across several tenant-A accounts so coordination detection trips with a
labelled inferred signal.

## 4. War-room

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Sign in as a seeded tenant-A Analyst. You should see: the narrative board (labelled clusters +
lifecycle), a coordination card (inferred), the amplifier list, and the node-coverage view. Sign in
as the tenant-B user and confirm **none** of tenant A's data is visible (Principle I).

## 5. Verify the invariants

```bash
make test               # Deno + pgTAP: RLS tenant-isolation property, reconciliation/trust,
                        # detection, coordination, enrich queue, retention purge
```

Key assertions to eyeball:
- cross-tenant select/insert/update is denied at the DB layer (SC-001),
- no `comment.author_raw` and no `post.media_url` survive once enrichment + retention run (SC-005),
- a single isolated post does not raise a coordination signal; the burst does (SC-006).

## Media worker (optional locally)

```bash
cd backend/media-worker && docker compose up    # consumes media_jobs, writes media_transcript,
                                                # discards media bytes
```
