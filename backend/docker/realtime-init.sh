#!/bin/sh
# Seeds the Realtime "realtime" tenant via its management API (idempotent). Self-hosted Realtime
# needs a tenant row before it will accept websocket subscriptions; the encrypted settings are
# created through the API (not raw SQL). Runs once per `docker compose up`, before the web app.
set -eu

SVC="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
API="http://realtime:4000/api"

echo "[realtime-init] waiting for realtime API…"
until curl -s -o /dev/null "$API/tenants/realtime" -H "Authorization: Bearer $SVC"; do sleep 2; done

echo "[realtime-init] seeding tenant 'realtime'…"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/tenants" \
  -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" \
  -d '{"tenant":{"name":"realtime","external_id":"realtime","jwt_secret":"super-secret-jwt-token-with-at-least-32-characters-long","extensions":[{"type":"postgres_cdc_rls","settings":{"db_name":"postgres","db_host":"db","db_user":"supabase_admin","db_password":"postgres","db_port":"5432","region":"us-east-1","poll_interval_ms":100,"poll_max_record_bytes":1048576,"ssl_enforced":false}}]}}')
echo "[realtime-init] tenant POST -> HTTP $code"
echo "[realtime-init] done."
