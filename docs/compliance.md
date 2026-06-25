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

## Raw-payload archival (Storage)
- The `raw-payloads` Storage bucket is provisioned in code (`migrations/0015_storage_retention.sql`)
  as a **private, service-role-only** bucket. Raw platform payloads contain **un-hashed** commenter
  handles, so — to honor minimization — the pipeline **does not archive raw payloads by default**.
  The relational store only ever holds keyed-hashed IDs (`shared/hash.ts`).
- If raw-payload archival is later enabled for a deployment, it is governed by the **same 30-day
  retention** as `comment.body`: `retention-purge` sweeps and deletes bucket objects older than 30
  days each day (`functions/retention-purge`). Any archiver MUST write under the private bucket only.

## Residency
- The Supabase project MUST be created in an **India region** (e.g. `ap-south-1`). Verified at
  provisioning (`docs/deploy.md` §1). No personal data leaves India at rest.
- **External processing posture (LLM + embeddings)**: comment text is sent to OpenRouter→Gemini for
  classification and to the Gemini embedding endpoint. Posture and required confirmations:
  - **Minimization in transit**: only the comment **body** is sent — never the commenter hash,
    account, cadre, or any join key. The provider cannot reconstruct a per-citizen profile.
  - **Region**: prefer an India-region inference path where the provider offers one; otherwise the
    transfer is limited to anonymized comment text under the provider's DPA.
  - **Required before production with real data** (external sign-off — owner: **party DPO + vendor**):
    accept OpenRouter's and Google's data-processing addendums (DPA), confirm no-training / retention
    terms on submitted content, and record the processing region. Tracked in "External sign-offs".

## Data Principal rights — grievance & erasure (DPDP)
DPDP grants Data Principals rights of grievance and erasure. How each is served here:
- **Grievance contact**: the deployment publishes a **Grievance Officer** contact (name + email) in
  the party's privacy notice. Owner: **party** (per-deployment; not code).
- **Cadre (account owner) erasure**: self-service — disconnect in the dashboard (`account-revoke`).
  Ingestion stops immediately; all of that account's posts/comments are purged on the next
  `retention-purge` run, and narratives/alerts recompute so the data stops driving signals at once
  (`recompute_after_revoke`). This is the primary, automated erasure path.
- **Commenter erasure**: commenter identities are **not stored** — only a non-reversible keyed hash
  (`shared/hash.ts`). Raw comment text is auto-deleted at 30 days. A commenter erasure request is
  therefore satisfied by (a) the standing 30-day raw-text purge, and (b) on request, deleting the
  specific account's comment rows whose hash matches a handle the requester supplies (the requester
  proves the handle; we re-hash it with the same key to locate rows). No identity index is retained.
- **Audit of erasure**: `purge_expired_data` returns counts (`raw_text_purged`,
  `revoked_posts_deleted`, `raw_payloads_purged`) logged per run for accountability.

## Auditability
- OpenRouter retains a request log of model calls; Edge Functions emit structured logs (no
  secrets, no raw handles). Daily `retention-purge` output is logged as the deletion record.

## Retention windows
- **Raw comment text**: 30 days (FR-009), enforced by `purge_expired_data`.
- **Raw-payload Storage objects** (if archival enabled): 30 days, enforced by `retention-purge`.
- **Anonymized derivatives** (hashed IDs, narratives, trends, metrics): retained for the engagement
  (no fixed TTL) — they carry no identity.
- **OAuth state**: ~1 hour. **Revoked-account content**: purged on the next daily run.
- **Review owner**: **party legal** signs off these windows for the specific deployment before
  production (external; the 30-day defaults are the design baseline, configurable if legal requires).

## External sign-offs (cannot be closed in code — owner + status)
These remain genuinely external. They are tracked, not codeable:
- [ ] **LLM/embedding provider DPA** accepted & processing region recorded — owner: party DPO + vendor.
- [ ] **Grievance Officer** named and published in the privacy notice — owner: party.
- [ ] **Legal review** of retention windows for this deployment — owner: party legal.
- [ ] **YouTube Data API quota audit** approved (Principle VII) — owner: party + Google;
  see `docs/quota-audit.md`. Code-side gate already enforced (`YT_INGEST_ENABLED`).
