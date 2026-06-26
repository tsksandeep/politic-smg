#!/usr/bin/env bash
# tests/run.sh — run the whole OpenPolitics backend test suite against the LOCAL Supabase stack.
#
# Prerequisites (one-time / per-session):
#   1. supabase start                 # boots local Postgres on 54322, auth schema, authenticated role
#   2. supabase db reset              # applies migrations 0001..0007 (schema, vector, RLS, queues,
#                                     #   cron, views, detection) to a clean DB
#   3. export COMMENTER_HASH_KEY=test-key   # used by edge-function code (not by these SQL tests)
#
# The tests talk straight to Postgres (deno-postgres). Override the connection via env if needed:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE  (defaults: localhost 54322 postgres postgres postgres)
#
# Usage:  ./run.sh            # run all tests
#         ./run.sh -- check   # type-check only (no DB needed)
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--" && "${2:-}" == "check" ]]; then
  echo "==> deno check (type-correctness only, no DB required)"
  exec deno check ./*_test.ts helpers.ts
fi

: "${PGHOST:=localhost}"; : "${PGPORT:=54322}"
echo "==> Running backend test suite against ${PGHOST}:${PGPORT}"
echo "    (ensure 'supabase start' + 'supabase db reset' have been run)"

# --allow-net : Postgres TCP + deno.land module download.  --allow-env : PG* / COMMENTER_HASH_KEY.
exec deno test --allow-net --allow-env \
  tenant_isolation_test.ts \
  rls_roles_test.ts \
  detection_test.ts \
  coordination_test.ts \
  reconcile_trust_test.ts \
  retention_test.ts \
  enrich_queue_test.ts
