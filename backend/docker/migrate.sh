#!/usr/bin/env bash
# Applies the app's SQL migrations (and optionally the demo seed) to the self-hosted Postgres.
# One-shot compose service; IDEMPOTENT — tracks applied files in _app_migrations so re-running
# `docker compose up` on an existing volume is a no-op. Waits for gotrue to create auth.users
# (migration 0004 adds a trigger on it) before applying.
set -euo pipefail

DB="postgresql://postgres:postgres@db:5432/postgres"
export PGCONNECT_TIMEOUT=5

echo "[migrate] waiting for database…"
until psql "$DB" -c 'select 1' >/dev/null 2>&1; do sleep 1; done

echo "[migrate] waiting for auth.users (created by gotrue)…"
until [ "$(psql "$DB" -tAc "select to_regclass('auth.users') is not null")" = "t" ]; do sleep 2; done

psql "$DB" -v ON_ERROR_STOP=1 -c \
  "create table if not exists _app_migrations (filename text primary key, applied_at timestamptz default now());"

echo "[migrate] applying migrations…"
for f in $(ls /migrations/*.sql | sort); do
  base=$(basename "$f")
  if [ "$(psql "$DB" -tAc "select 1 from _app_migrations where filename='$base'")" = "1" ]; then
    echo "  • $base (already applied)"
    continue
  fi
  echo "  → $base"
  psql "$DB" -v ON_ERROR_STOP=1 -f "$f"
  psql "$DB" -v ON_ERROR_STOP=1 -c "insert into _app_migrations (filename) values ('$base');"
done

# Seed only a fresh DB (no cadres yet), and only when SEED=true.
if [ "${SEED:-false}" = "true" ] && [ -f /seed/board_demo.sql ]; then
  if [ "$(psql "$DB" -tAc "select count(*) from cadre")" = "0" ]; then
    echo "[migrate] seeding demo board…"
    psql "$DB" -v ON_ERROR_STOP=1 -f /seed/board_demo.sql || echo "[migrate] seed failed (non-fatal)"
  else
    echo "[migrate] cadres already present — skipping seed."
  fi
fi

echo "[migrate] done."
