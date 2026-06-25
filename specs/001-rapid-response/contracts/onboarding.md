# Contract: Cadre Consent Onboarding

Implements User Story 2 (FR-010, FR-010a, FR-001, FR-011). All endpoints are Edge Functions.
Consent is brokered by **Nango** (R9): the SPA runs the Nango frontend SDK against a
server-issued connect session, and the app records only the resulting connection handle —
tokens are stored and auto-refreshed by Nango, never by this app (Principle III).

## POST /oauth-start
Open a Nango connect session for one platform.
- **Auth**: authenticated cadre/admin session (JWT).
- **Body**: `{ "cadre_id": uuid, "platform": "instagram" | "youtube" }`
- **200**: `{ "connect_session_token": string, "connect_link": string, "provider_config_key": string }`
  — the SPA hands `connect_session_token` to the Nango frontend SDK, which renders the consent UI
  and runs the OAuth dance.
- **Errors**: `400` `unsupported_platform` / `missing_cadre`; `502` `nango_error`.

## POST /oauth-callback
Record a completed Nango connection. Called by the SPA after the Nango Connect UI fires its
`connect` event (which yields the `connection_id`). Public (`verify_jwt = false`).
- **Body**: `{ "cadre_id": uuid, "platform": "instagram" | "youtube", "connection_id": string }`
- **Behavior**: read a fresh token from Nango; resolve the **supported** platform account id
  (IG Business account / YT channel) — a personal IG account has no business account → unsupported;
  upsert `connected_account` with `consent_status = connected` and its `nango_connection_id`;
  fire-and-forget the 30-day backfill.
- **200**: `{ "connected_account_id": uuid, "platform": string, "backfill": "queued" }`
- **422**: `unsupported_account_type` (e.g., personal IG) → **no data is collected** (AS 2.3).
- **Errors**: `400` `missing_params`; `502` `resolve_failed`; `500` `account_error`.

## POST /account-revoke
Disconnect an account.
- **Auth**: **admin only** (RLS role check).
- **Body**: `{ "account_id": uuid }`
- **Behavior**: set `consent_status = revoked`, `revoked_at = now()`; stop ingestion immediately;
  delete the Nango connection (best-effort); call `recompute_after_revoke()` so the account's data
  drops out of active narratives/alerts at once; physical purge runs on the scheduled
  retention-purge (FR-010, edge case "consent revoked mid-incident").
- **200**: revoked account row.

## GET /accounts
List connected accounts (RLS: staff).
- **200**: `[{ "id", "cadre_id", "platform", "consent_status", "connected_at", "revoked_at",
  "token_expires_at", "backfill_done" }]` — never returns a token or connection secret.

### Acceptance mapping
- Connect → account ingested: AS 2.1
- Revoke → ingestion stops + purge: AS 2.2
- Unsupported account type → guided, no collection: AS 2.3
