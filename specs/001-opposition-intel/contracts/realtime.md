# Contract: War-room Realtime (coordinator ⇄ war-room SPA)

The war-room SPA subscribes to Supabase Realtime for live updates, scoped to the signed-in user's
tenant by RLS (Principle I). Users authenticate with a Supabase JWT carrying a `tenant_id` claim;
`current_tenant()` resolves it and RLS filters every row.

## Channels / tables

- **`alert`** (postgres_changes, INSERT/UPDATE): new emerging-narrative and coordinated-attack
  alerts, and triage status changes, stream to the board live (FR-019). Filtered to the tenant by
  RLS — the SPA never receives another tenant's alerts.
- **`narrative`** (UPDATE): lifecycle_state / volume / growth changes refresh the narrative board.
- **`coordination_signal`** (INSERT): new inferred coordination events animate the coordination
  board.
- **`node_heartbeat`** (INSERT): drive the live node-coverage / scaling-law view and coverage-gap
  banner (FR-015).

## Read surfaces (PostgREST views, security_invoker = on)

`narrative_board`, `alert_board`, `amplifier_targets`, `coordination_board`, `node_coverage` — all
RLS-scoped to the caller's tenant. Every probabilistic field is returned already labelled or
accompanied by its confidence so the UI renders it as a signal, never a verdict (Principle V,
FR-013).

## Triage write surface

`alert-triage` Edge Function (user JWT, RLS): `acknowledge | assign | annotate | close` an alert.
Status changes propagate to other analysts of the same tenant via the `alert` Realtime channel.
`response_latency` is a generated column (`closed_at − detected_at`), not computed client-side.
