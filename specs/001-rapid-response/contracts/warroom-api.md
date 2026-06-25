# Contract: War-Room API

Implements User Story 1 (board + alert detail) and User Story 3 (triage). Served via PostgREST
over RLS-protected views plus Edge Functions. Realtime channel pushes live updates (FR-006).

## GET /alerts  (board)
List active alerts for the live board.
- **Auth**: analyst or admin.
- **Query**: `status` (default `open,acknowledged`), `since`, `limit`.
- **200**: array of:
  ```json
  {
    "id": "uuid",
    "status": "open|acknowledged|closed",
    "narrative": {
      "theme_summary": "string",
      "volume": 0,
      "growth_rate": 0.0,
      "confidence": 0.0,            // 0–1, REQUIRED label (Principle V)
      "coordination_score": 0.0     // 0–1
    },
    "affected_scope": { "cadres": 0, "posts": 0 },
    "detected_at": "timestamptz",
    "assignee_user_id": "uuid|null",
    "data_fresh_as_of": "timestamptz"   // FR-015 freshness
  }
  ```

## Realtime channel `alerts`
- Subscribe to inserts/updates on the alerts view (Supabase Realtime).
- Delivers new/changed alerts to the board without manual refresh (FR-006, AS 1.1).

## GET /alerts/{id}  (detail)
- **200**: board fields **plus**:
  ```json
  {
    "example_comments": [
      { "body": "string", "sentiment": "hostile", "sentiment_confidence": 0.0,
        "language": "ta|en|mixed" }   // commenter identity NEVER included (FR-008)
    ],
    "classification_note": "string",
    "labels": { "is_signal_not_verdict": true }   // honest-signal marker (Principle V, AS 1.2/1.4)
  }
  ```
- Example comments are anonymized; no commenter handle/id is ever returned.

## PATCH /alerts/{id}  (triage — US3)
- **Auth**: analyst or admin.
- **Body**: `{ "status": "acknowledged|closed", "assignee_user_id": "uuid|null",
  "response_note": "string|null" }`
- **Behavior**: update status/assignee/note; set `acknowledged_at`/`closed_at`; on close,
  compute `response_latency` (FR-014, SC-006). Change broadcast live (AS 3.1).
- **200**: updated alert.

## GET /detection-settings  ·  PUT /detection-settings  (admin only)
- **Auth**: **admin only** (RLS denies analyst).
- **PUT body**: `{ "min_volume", "min_growth_rate", "coordination_window",
  "coordination_min_accounts" }` (FR-005, clarify: admin-tunable).
- **403** for analyst role.

### Acceptance mapping
- Alert on hostile burst with theme/scope/volume/growth: AS 1.1
- Detail shows anonymized examples + confidence + coordination, labeled signal: AS 1.2/1.4
- Normal surge → no alert: AS 1.3 (enforced upstream by detection, surfaced as absence)
- Acknowledge/assign live: AS 3.1
- Close + log response → latency recorded: AS 3.2
