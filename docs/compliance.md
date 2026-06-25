# Compliance — DPDP & Data Residency (T046)

Maps the build to constitution Principle III and India's DPDP Act (substantive provisions
enforceable from May 2027). Posture: **minimize & anonymize**.

## Lawful basis
- **Cadre data**: explicit OAuth consent per connected account. Revocation honored immediately
  (ingestion stops; data purged on schedule). See `oauth-*`, `account-revoke`, `purge_expired_data`.
- **Commenter data**: processed in aggregate for the legitimate purpose of detecting attacks on
  the party's own posts. No per-citizen profiles are built or exposed.

## Minimization & anonymization
- Commenter handles are **hashed (keyed HMAC-SHA256) before storage** — raw handles are never
  persisted (`shared/hash.ts`; proven by `tests/anonymization_test.ts`).
- Detection operates on **patterns** (hashed IDs, timing, text similarity), not identities.
- Alert detail and all APIs **never** return commenter identity (contract test `warroom_api_test.ts`).

## Retention & deletion
- Raw comment text (`comment.body`) is deleted **30 days** after ingestion; anonymized
  derivatives (hashed IDs, narratives, trends) may be retained (`purge_expired_data`, daily `pg_cron`).
- Revoked accounts: all content purged on the scheduled run.
- **Launch gate**: `retention-purge` (T045) MUST be deployed + scheduled before real data flows.

## Residency
- The Supabase project MUST be created in an **India region** (e.g. `ap-south-1`). Verified at
  provisioning (`docs/deploy.md` §1). No personal data leaves India at rest.
- External processing: comment text is sent to OpenRouter→Gemini for classification and to the
  Gemini embedding endpoint. **Open item**: confirm acceptable processing-region / DPA terms for
  these providers, or restrict to in-region inference, before production with real data.

## Auditability
- OpenRouter retains a request log of model calls; Edge Functions emit structured logs (no
  secrets, no raw handles).

## Open items before production
- [ ] Confirm LLM/embedding provider data-processing terms & region acceptability.
- [ ] Document the Data Principal grievance/erasure path (DPDP requirement).
- [ ] Legal review of retention windows for the specific deployment.
