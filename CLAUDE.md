<!-- SPECKIT START -->
## Active Plan

Current feature: **Rapid-Response Narrative Alerting** (`001-rapid-response`).
Read the implementation plan for tech stack, structure, and constraints:
`specs/001-rapid-response/plan.md`

Supporting artifacts: `specs/001-rapid-response/spec.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`.

Stack: Supabase (Postgres + pgvector, Auth/RLS, Realtime, Storage, pgmq, pg_cron, Edge
Functions), OpenRouter → Gemini 2.5 Flash/Flash-Lite, single-tenant, India region.
Governing principles: `.specify/memory/constitution.md`.
<!-- SPECKIT END -->
