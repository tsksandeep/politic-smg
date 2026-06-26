# Backend test suite — OpenPolitics

Real, runnable tests for the Opposition Narrative Intelligence backend. They run against the **local
Supabase Postgres** (port `54322`) after migrations `0001..0007` are applied. Tests talk directly to
Postgres via [`deno-postgres`](https://deno.land/x/postgres) because the headline property — **tenant
isolation under RLS** (Principle I / SC-001) — is enforced per database role + JWT claim, and a direct
connection lets us *become* a tenant's signed-in user (`set role authenticated` + the
`request.jwt.claims` GUC that `auth.uid()` reads). The same connection runs the `security definer`
detection / coordination / reconcile functions as the service-role / cron context.

## Run

```bash
# one-time per session
supabase start                       # local Postgres on 54322 (+ auth schema, authenticated role)
supabase db reset                    # apply migrations 0001..0007 to a clean DB
export COMMENTER_HASH_KEY=test-key   # for edge-function code; SQL tests don't need it

# all tests
cd backend/supabase/tests
./run.sh
# or directly:
deno test --allow-net --allow-env

# a single file
deno test --allow-net --allow-env tenant_isolation_test.ts

# type-check only (no DB)
./run.sh -- check        # == deno check *_test.ts helpers.ts
```

Connection is overridable via `PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE`
(defaults `localhost 54322 postgres postgres postgres`).

## Files

| File | Covers |
|------|--------|
| `helpers.ts` | DB connection, deterministic 768-dim `vec()`, tenant/user fixtures, `withUser()` (acts as a staffer through RLS) |
| `tenant_isolation_test.ts` | **THE property test** — A cannot read / mutate / enumerate / forge B across all 10 tenant tables; positive control proves A still sees its own (SC-001) |
| `rls_roles_test.ts` | Analyst = read boards + triage only; Admin = config writes (detection_settings / tracked_account / node / tenant_user) (FR-016) |
| `detection_test.ts` | `run_detection()` clusters a hostile set, computes metrics/lifecycle/observation, raises an emerging alert; a benign set raises none (FR-009/010/012, SC-003) |
| `coordination_test.ts` | `detect_coordination()` on a shared-audio + identical-hashtag burst raises signals + a `coordinated_attack` alert; an isolated post does not (FR-011, SC-006) |
| `reconcile_trust_test.ts` | `reconcile_submissions()` rewards agreement, flags the divergent outlier, decays + quarantines a node below the 0.2 trust floor (Principle VII, FR-014) |
| `retention_test.ts` | Raw text (`caption`/`body`) + `media_url` older than 30d cleared; hashes/embeddings/derived rows persist (Principle III, FR-018, SC-005) |
| `enrich_queue_test.ts` | pgmq `enqueue_enrich`/`claim_jobs`/`complete_job`/`fail_job` + poison→DLQ archive + `reconcile_enrich_queue` gap-fill (0004) |

## Notes / assumptions

- **Fixtures are self-contained** — each test mints its own tenants with random UUIDs; nothing depends
  on the demo seed file. Function tests (`run_detection` etc.) iterate all active tenants but every
  assertion is scoped to the test's own tenant ids, so cross-test leftovers are harmless.
- **`retention_test.ts` replicates the purge SQL inline** because the `retention-purge` routine
  referenced by `0005_cron.sql` is not yet in the migrations. When it lands, replace the
  `RETENTION_PURGE_SQL` block with `select retention_purge($tenant)` — the assertions are the contract.
- **Relies on Supabase's default grants** (`anon`/`authenticated`/`service_role` get table privileges),
  so RLS — not missing GRANTs — is what gates cross-tenant access. This is the stock local Supabase
  setup.
