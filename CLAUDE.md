<!-- SPECKIT START -->
## Active Plan

Current feature: **Opposition Narrative Intelligence** (`001-opposition-intel`).
Read the implementation plan for tech stack, structure, and constraints:
`specs/001-opposition-intel/plan.md`

Supporting artifacts: `specs/001-opposition-intel/spec.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`, `tasks.md`.

Stack: Supabase (Postgres + pgvector, Auth/RLS, Realtime, Storage, pgmq, pg_cron, Edge Functions),
OpenRouter → Gemini 2.5 Flash/Flash-Lite, Gemini embeddings (768-dim). **Shared-schema
multi-tenant** (tenant_id + RLS). Ingestion is **public-data scraping** distributed across each
tenant's volunteer **MV3 browser-extension node network** (`extension/`); a **media-worker**
container (`backend/media-worker/`) does OCR/ASR transcribe-then-discard. Launch jurisdiction:
India / DPDP. Governing principles: `.specify/memory/constitution.md`.

Non-negotiables (Principles I–III): tenant isolation by RLS; public-data-only, logged-out capture
(never log in); comment authors HMAC-hashed at ingest, raw media never warehoused.
<!-- SPECKIT END -->
