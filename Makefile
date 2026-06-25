# Politic-SMG — local dev orchestration.
# The whole stack (Postgres, Auth+MailHog, REST, Realtime, Kong, Edge Functions, mock, web) runs
# as ONE self-hosted Docker Compose stack — no Supabase CLI needed. See docs/local-dev.md.

DB_URL ?= postgresql://postgres:postgres@localhost:54322/postgres
SUPABASE_URL ?= http://localhost:54321
SERVICE_ROLE_KEY ?= eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU

.PHONY: help up down restart logs ps reset seed mail psql user e2e fmt lint test clean

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## Start the whole stack (applies migrations + seeds + seeds realtime on first run)
	@test -f .env.local || cp .env.local.example .env.local
	docker compose up -d
	@echo ""
	@echo "✓ Stack up.  App: http://localhost:5173  ·  Mail: http://localhost:8025  ·  API: $(SUPABASE_URL)"
	@echo "→ Create a war-room user: 'make user EMAIL=you@party.test', then sign in from the landing page."

down: ## Stop the stack (keeps data)
	docker compose down

restart: ## Restart all services
	docker compose restart

logs: ## Tail all logs (use `make logs SVC=functions` for one service)
	docker compose logs -f $(SVC)

ps: ## Show service status
	docker compose ps

reset: ## Wipe data + recreate the whole stack from scratch (re-migrates + re-seeds)
	docker compose down -v
	docker compose up -d

seed: ## Re-run the demo seed (only seeds a fresh DB; no-op if cadres already exist)
	SEED=true docker compose run --rm migrate

mail: ## Open the MailHog inbox (captures magic-link emails)
	@open http://localhost:8025 2>/dev/null || echo "MailHog UI: http://localhost:8025"

psql: ## Open a psql shell on the database
	docker compose exec db psql "postgresql://postgres:postgres@localhost:5432/postgres"

EMAIL ?= warroom@politic.test
user: ## Provision a war-room user (Admin). Usage: make user EMAIL=you@party.test
	@curl -s -X POST "$(SUPABASE_URL)/auth/v1/admin/users" \
	  -H "apikey: $(SERVICE_ROLE_KEY)" -H "Authorization: Bearer $(SERVICE_ROLE_KEY)" \
	  -H "Content-Type: application/json" -d '{"email":"$(EMAIL)","email_confirm":true}' >/dev/null
	@curl -s "$(SUPABASE_URL)/rest/v1/app_user?select=id" -H "apikey: $(SERVICE_ROLE_KEY)" -H "Authorization: Bearer $(SERVICE_ROLE_KEY)" >/dev/null
	@echo "✓ user $(EMAIL) created. Promote to admin in psql if needed:"
	@echo "  update app_user set role='admin' where id=(select id from auth.users where email='$(EMAIL)');"

e2e: ## Run the comprehensive backend e2e against the running stack (uses the real LLM if .env.local has a key)
	cd backend/supabase && \
	  FUNCTIONS_URL="$(SUPABASE_URL)/functions/v1" SUPABASE_URL="$(SUPABASE_URL)" \
	  SERVICE_ROLE_KEY="$(SERVICE_ROLE_KEY)" IG_APP_SECRET="mock-ig-secret" \
	  deno test --allow-env --allow-net --allow-read tests/e2e_local_test.ts

fmt: ## Format Edge Function / shared / test code
	cd backend/supabase && deno fmt functions/ shared/ tests/ mocks/

lint: ## Lint Edge Function / shared / test code
	cd backend/supabase && deno lint functions/ shared/ tests/ mocks/

test: ## Run DB-backed Deno tests against the stack
	cd backend/supabase && DATABASE_URL="$(DB_URL)" deno test --allow-env --allow-net --allow-read tests/

clean: ## Stop everything and wipe all data + volumes
	docker compose down -v --remove-orphans
