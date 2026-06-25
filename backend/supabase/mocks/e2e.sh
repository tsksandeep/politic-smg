#!/usr/bin/env bash
# Full local end-to-end run against the mock external APIs (no real credentials).
# Starts the mock server + edge functions (mock env), runs the e2e test, tears everything down.
# Assumes the Supabase stack is already running (`make start`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)" # repo root
SUPA_DIR="$ROOT/backend/supabase"
ENV_FILE="$ROOT/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — run: cp .env.local.example .env.local" >&2
  exit 1
fi

cd "$ROOT/backend"
if ! supabase status >/dev/null 2>&1; then
  echo "Supabase stack not running — run 'make start' first." >&2
  exit 1
fi

# Export local connection details (API_URL, SERVICE_ROLE_KEY, ...) for the test.
eval "$(supabase status -o env | sed 's/^/export /')"
export SUPABASE_URL="${API_URL}"
export FUNCTIONS_URL="${API_URL}/functions/v1"

cleanup() {
  # Kill by pattern (covers the CLI and its children); also the captured PIDs as a fallback.
  pkill -f "mocks/server.ts" >/dev/null 2>&1 || true
  pkill -f "functions serve" >/dev/null 2>&1 || true
  kill "${MOCK_PID:-}" "${FUNC_PID:-}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Both run detached with output to log files — never to this script's stdout, or a consumer
# piping our output (e.g. `make e2e | tail`) would hang waiting for EOF on a long-lived process.
echo "→ starting mock external-API server (logs: /tmp/politic-mock.log)"
( cd "$SUPA_DIR" && exec deno run --allow-net --allow-env mocks/server.ts ) >/tmp/politic-mock.log 2>&1 &
MOCK_PID=$!

echo "→ serving edge functions with mock env (logs: /tmp/politic-functions.log)"
( cd "$ROOT/backend" && exec supabase functions serve --env-file "$ENV_FILE" --no-verify-jwt ) >/tmp/politic-functions.log 2>&1 &
FUNC_PID=$!

echo "→ waiting for mock (localhost:9100)…"
for _ in $(seq 1 30); do curl -sf "http://localhost:9100/youtube/v3/channels?mine=true" >/dev/null 2>&1 && break; sleep 1; done

echo "→ waiting for edge functions…"
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$FUNCTIONS_URL/oauth-start" || echo 000)
  [ "$code" != "000" ] && break
  sleep 1
done

echo "→ running e2e test"
cd "$SUPA_DIR"
deno test --allow-env --allow-net --allow-read tests/e2e_local_test.ts
