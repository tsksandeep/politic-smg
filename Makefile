# Politic-SMG — local dev orchestration.
# Backend stack: Supabase CLI (manages its own Docker Compose). Frontend: docker compose (web).
# See docs/local-dev.md. Run `make help` for targets.

SUPABASE := cd backend && supabase
DB_URL ?= postgresql://postgres:postgres@localhost:54322/postgres

.PHONY: help up down start stop env web web-logs functions functions-mock mock e2e migrate reset seed demo test fmt lint clean

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: start env web ## Start everything (Supabase + web). Then run `make functions` in another shell.
	@echo ""
	@echo "✓ Supabase + web up. Studio: http://localhost:54323  ·  App: http://localhost:5173"
	@echo "→ Now run 'make functions' in a separate terminal for hot-reloading Edge Functions."

start: ## Start the Supabase stack (Postgres, Auth, Realtime, Storage, Studio, Edge Runtime)
	$(SUPABASE) start

stop: ## Stop the Supabase stack (keeps data)
	$(SUPABASE) stop

env: ## Write root .env with the local anon key (for docker-compose web)
	@$(SUPABASE) status -o env 2>/dev/null | sed -n 's/^ANON_KEY=/SUPABASE_LOCAL_ANON_KEY=/p' > .env
	@echo "wrote .env (SUPABASE_LOCAL_ANON_KEY)"

web: ## Start the Vite frontend dev container (HMR)
	docker compose up -d web

web-logs: ## Tail the frontend container logs
	docker compose logs -f web

functions: ## Serve Edge Functions with hot reload (foreground). Needs .env.local (cp .env.local.example).
	$(SUPABASE) functions serve --env-file ../.env.local --no-verify-jwt

functions-mock: functions ## Alias: serve functions (with .env.local pointed at the mock APIs)

mock: ## Run the mock external-API server (Meta/Google/OpenRouter/Gemini) on :9100 (foreground)
	cd backend/supabase && deno run --allow-net --allow-env mocks/server.ts

e2e: ## Full local end-to-end run against mocks (starts mock + functions, runs the test, tears down)
	bash backend/supabase/mocks/e2e.sh

migrate: ## Apply new migrations to the running local db
	$(SUPABASE) migration up

reset: ## Recreate the local db and re-apply ALL migrations
	$(SUPABASE) db reset

seed: ## Load the two-sided board demo (favourable + anti-party + cadre coverage), no external APIs
	psql "$(DB_URL)" -f backend/supabase/seed/board_demo.sql

demo: seed ## Alias for seed — lights up the war-room board end-to-end
	@echo "✓ Demo burst seeded + detection run. Open http://localhost:5173/board"

test: ## Run the DB-backed Deno tests against the local stack
	cd backend/supabase && DATABASE_URL="$(DB_URL)" deno test --allow-env --allow-net --allow-read tests/

fmt: ## Format Edge Function / shared / test code
	cd backend/supabase && deno fmt functions/ shared/ tests/

lint: ## Lint Edge Function / shared / test code
	cd backend/supabase && deno lint functions/ shared/ tests/

down: ## Stop web + Supabase
	-docker compose down
	-$(SUPABASE) stop

clean: down ## Stop everything and reset local Supabase data
	$(SUPABASE) stop --no-backup
