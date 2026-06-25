# YouTube Data API Quota Audit — Release Gate (T006 / T047)

**Constitution Principle VII** makes this a **release precondition** for the YouTube ingestion
path. The default quota is **10,000 units/day** with **no paid-quota path** — the audit form is
the only way to raise it, and it can reject data-heavy use cases.

## Status
- [ ] Audit submitted (date: ____)
- [ ] Audit approved (date: ____, new quota: ____ units/day)

## Enforcement (in code — already done)
`ingest-youtube` is hard-gated: it returns `{disabled:true, reason:"youtube_quota_audit_gate"}`
and does nothing unless the env var **`YT_INGEST_ENABLED=true`**. Production MUST leave this
unset until the audit is approved. This makes the contingency impossible to bypass by accident
(the pg_cron schedule can fire, but the function self-disables).

Once the gate opens, the path is functional end-to-end: `ingest-youtube` reads a fresh access
token from **Nango** per run via the channel's `nango_connection_id` (`shared/nango.ts`
`getAccessToken`) — Nango owns storage + auto-refresh, so there is no manual token handling. The
`YT_ACCESS_TOKEN_OVERRIDE` env var remains only as a local-test escape hatch and is empty in prod.

## How to submit the audit (human action — requires your GCP project)
1. In Google Cloud Console, ensure the **YouTube Data API v3** is enabled on the project.
2. Open the YouTube API Services **compliance & quota-extension audit**:
   https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
3. Complete the linked audit form, describing the use case (read-only comment monitoring on
   *consented* channels for a single political party) and the requested daily quota.
4. Record the dates/quota above; once approved, set `YT_INGEST_ENABLED=true` (T047).

## Why it's needed
At ~1k–10k connected channels, polling recent uploads + comments exceeds 10k units/day even
with quota-efficient reads (comment reads = 1 unit; `search` = 100 units and is **avoided** by
reading each channel's uploads playlist).

## Contingency (Instagram-first)
If the audit is pending, ship the wedge **Instagram-first**: the IG comment webhook path
(`ig-webhook`) needs no Google audit. Enable `ingest-youtube` in production only after approval.

## Gate closure (T047)
Do not enable `ingest-youtube` in any production deployment until "Audit approved" above is
checked and the new quota is recorded.
