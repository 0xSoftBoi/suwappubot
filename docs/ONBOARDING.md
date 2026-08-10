# Contributor Onboarding

Get from clone to a running component and a green verification pass. For what
the system *is*, read `docs/architecture/OVERVIEW.md`; for why things are the
way they are, read `docs/DECISIONS.md`.

## First 30 minutes

1. Clone the repo. Copy `.env.schema` → `.env` and fill in the minimum:
   - **Python bot**: `TELEGRAM_BOT_TOKEN`, `ENCRYPTION_KEY` (the only two with
     no default — see `bot/config/settings.py`). `DATABASE_URL` defaults to
     local SQLite.
   - **api-ts**: in dev mode only `DATABASE_URL` and `TELEGRAM_BOT_TOKEN` are
     needed; prod additionally requires `JWT_SECRET` and `ADMIN_API_KEY`
     (`api-ts/src/config/EnvService.ts`).
   - **webapp**: `VITE_API_URL=http://localhost:8000` (`webapp/.env.example`).
   - The full env catalog lives in `.env.schema`; `scripts/check_env_schema.py`
     keeps it in sync with both settings modules.
2. Run `bash scripts/verify.sh` — this is the repo's entry gate and the same
   check used before every deploy claim.

## Running each component

| Component | Setup & dev server | Tests |
|-----------|--------------------|-------|
| Python bot + API (`bot/`, `api/`) | `pip install -r requirements.txt` then `uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload` | `pytest tests/` (161 test files, 20% coverage floor in CI) |
| api-ts (`api-ts/`) | `bun install && bun run dev` | `bun run test` (56 files); type-check with `bun run check` |
| webapp (`webapp/`) | `npm ci && npm run dev` | `npm run test -- --run` (integration tests hit live dev API — excluded from CI) |
| mobile (`mobile/`) | `bun install && bun run ios` | `bun run check` (type-check only; no unit tests yet) |
| showcase (`showcase/`) | `bun install && bun run dev` | `bun run test:docs` (Playwright docs QA) |

Tooling rule: **use `bun`, never bare `tsc`/`npm`/`npx` in TS components**
(webapp is the npm exception). Full-project `tsc` hangs in this repo.

## What CI will hold you to

`.github/workflows/test.yml` runs on every PR — the blocking jobs:

- **Python**: `black --check --line-length=100 bot/ api/ tests/`, flake8,
  pytest with a 20% coverage floor, env-schema drift check. Run black locally
  before pushing or CI fails on style alone.
- **TypeScript**: `bun run check`, OpenAPI + MCP schema drift, tests, prod build.
- **Contract jobs**: showcase stats/i18n drift, docs.json regeneration,
  Python↔Drizzle migration idempotency against Postgres, SDK install/import.
- **dependency-scan**: pip-audit / bun audit / npm audit — high or critical
  findings fail the build (exceptions: `docs/security/dependency-exceptions.md`).

Caveat every contributor learns eventually: **CI green does not prove the bot
boots** — the test job never imports `bot/main.py`'s startup chain. After a
deploy, run `python3 scripts/status.py`.

## The scripts/ toolbox

The most-used of the ~27 scripts:

- `verify.sh [all|python|api|agent|env|health|onchain]` — syntax/type/drift lanes
- `status.py [--env dev]` — deploy state + health + logs + CI for all services
- `doctor.py` — local diagnostics (env, deps, DB, imports)
- `preflight_deploy.sh` / `self_heal_deploy.sh` — deploy safety + remediation
- `verify_onchain_constants.py` — audits bridge/chain constants against live
  RPCs (~8 calls; can be flaky)
- `backup-to-r2.sh` — DB backups to Cloudflare R2

## Working conventions

- Deploys go to **Railway** (`main` → prod, `dev` → dev). See
  `docs/deployment/railway.md` and `docs/deployment/monitoring.md`.
- DB schema changes are runtime migrations in `database/db.py`
  (`_ensure_schema()`) **and** the Drizzle schema — both stacks share one DB.
  See `docs/development/migrations.md`.
- Anything touching swaps, wallets/keys, fees, or billing is money-path: tag it
  `MONEY-PATH` in the PR and expect an adversarial review.
- No `Co-Authored-By` lines in commits; never `git rebase` in this repo.

Full rule set: root [`CONVENTIONS.md`](../CONVENTIONS.md) (day-to-day rules)
and [`ARCHITECTURE.md`](../ARCHITECTURE.md) (boundaries and standing
decisions). Per-component rules: `bot/CLAUDE.md`, `api-ts/CLAUDE.md`,
`webapp/CLAUDE.md`.
