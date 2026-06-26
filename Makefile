# OpenPolitics — local dev orchestration.
# The whole stack (Postgres, Auth+MailHog, REST, Realtime, Storage, Kong, Edge Functions, mock, web)
# runs as ONE self-hosted Docker Compose stack — no Supabase CLI needed. See docs/local-dev.md.
# Migrations are applied by the one-shot `migrate` compose service (backend/docker/migrate.sh).

SUPABASE_URL ?= http://localhost:54321
FN ?= $(SUPABASE_URL)/functions/v1
DB_URL ?= postgresql://postgres:postgres@localhost:54322/postgres
SERVICE_ROLE_KEY ?= eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU

# Pipeline functions, run in dependency order (mirrors the pg_cron schedule).
PIPELINE := enrich detect-narratives coordination-detect assign-work reconcile

.PHONY: help up down migrate seed pipeline test fmt logs ps reset psql clean

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## Start the whole stack (applies migrations + seeds on first run)
	@test -f .env.local || cp .env.local.example .env.local
	docker compose up -d
	@echo ""
	@echo "✓ Stack up.  War-room: http://localhost:5173  ·  Mail: http://localhost:8025  ·  API: $(SUPABASE_URL)"

down: ## Stop the stack (keeps data)
	docker compose down

migrate: ## Apply backend/supabase/migrations 0001..0007 (idempotent; via the migrate service)
	SEED=false docker compose run --rm migrate

seed: ## (Re-)seed demo_tenant.sql — two tenants, nodes, captured posts, a coordination burst
	SEED=true docker compose run --rm migrate

pipeline: ## Run enrich → detect-narratives → coordination-detect → assign-work → reconcile (in order)
	@for fn in $(PIPELINE); do \
	  echo "→ $$fn"; \
	  curl -sS -X POST "$(FN)/$$fn" \
	    -H "Authorization: Bearer $(SERVICE_ROLE_KEY)" \
	    -H "Content-Type: application/json" -d '{}' ; echo ; \
	done

test: ## Run DB-backed Deno + pgTAP tests against the stack (RLS isolation, reconciliation, detection)
	cd backend/supabase && DATABASE_URL="$(DB_URL)" deno test --allow-env --allow-net --allow-read tests/

fmt: ## Format Edge Function / shared / test code
	cd backend/supabase && deno fmt functions/ shared/ tests/ mocks/

# --- convenience -------------------------------------------------------------------------------
logs: ## Tail all logs (use `make logs SVC=functions` for one service)
	docker compose logs -f $(SVC)

ps: ## Show service status
	docker compose ps

reset: ## Wipe data + recreate the whole stack (re-migrates + re-seeds)
	docker compose down -v
	docker compose up -d

psql: ## Open a psql shell on the database
	docker compose exec db psql "$(DB_URL)"

clean: ## Stop everything and wipe all data + volumes
	docker compose down -v --remove-orphans
