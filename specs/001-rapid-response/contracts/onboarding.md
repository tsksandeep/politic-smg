# Contract: Cadre Consent Onboarding

Implements User Story 2 (FR-010, FR-010a, FR-001, FR-011). All endpoints are Edge Functions.

## POST /oauth-start
Begin a consent flow for one platform.
- **Auth**: authenticated cadre/admin session.
- **Body**: `{ "cadre_id": uuid, "platform": "instagram" | "youtube" }`
- **200**: `{ "authorize_url": string, "state": string }` — client redirects to platform consent.
- **Errors**: `400` unsupported platform; `401` unauthenticated.

## GET /oauth-callback
Handle the platform redirect after the cadre authorizes.
- **Query**: `code`, `state` (platform-issued).
- **Behavior**: exchange `code` for tokens; store token in Supabase Vault; create
  `connected_account` with `consent_status = connected`; enqueue 30-day backfill job.
- **200**: `{ "connected_account_id": uuid, "platform": string, "backfill": "queued" }`
- **422**: account type unsupported (e.g., personal IG) → `{ "error": "unsupported_account_type",
  "guidance": string }` and **no data is collected** (FR Acceptance 2.3).

## POST /accounts/{id}/revoke
Disconnect an account.
- **Auth**: the owning cadre or an admin.
- **Behavior**: set `consent_status = revoked`, `revoked_at = now()`; stop ingestion immediately;
  schedule purge of that account's posts/comments/raw payloads (FR-010).
- **200**: `{ "status": "revoked", "purge": "scheduled" }`

## GET /accounts
List the caller's connected accounts (admin: all).
- **200**: `[{ "id", "platform", "consent_status", "connected_at", "token_expires_at",
  "backfill_done" }]`

### Acceptance mapping
- Connect → account ingested: AS 2.1
- Revoke → ingestion stops + purge: AS 2.2
- Unsupported account type → guided, no collection: AS 2.3
