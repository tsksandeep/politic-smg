# Contracts: Rapid-Response Narrative Alerting

Interface contracts for the feature. Three surfaces:

1. **Cadre onboarding** — consent OAuth flow (Edge Functions).
2. **War-room API** — board, alert detail, triage, admin settings (PostgREST + Edge Functions,
   behind Supabase Auth + RLS).
3. **Platform webhooks / ingestion** — Instagram comment webhook + YouTube polling job (internal).

All API access requires an authenticated internal user. Role enforcement is at the database
layer (RLS): `analyst` (read board, triage alerts) and `admin` (+ users, settings, accounts).
Every response carrying a probabilistic value MUST include its confidence/estimate field
(constitution Principle V).

See [`onboarding.md`](./onboarding.md), [`warroom-api.md`](./warroom-api.md),
[`ingestion.md`](./ingestion.md).
