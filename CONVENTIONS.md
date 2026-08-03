# Conventions

Day-to-day rules for humans and agents working in this repo. Boundaries and standing
decisions live in `ARCHITECTURE.md`; agent-specific policy in `AGENTS.md`. When a rule
here conflicts with observed code, the rule wins going forward — fix the code, don't
fork the convention.

## Toolchain

- **`bun`**, never `npm`/`npx`/`tsc`, for all TypeScript work. `tsc` hangs in this repo;
  type-check with `bun run check` (incrementally on large diffs).
- Python is formatted with **black, line length 100** (`black --line-length=100 bot/ api/
  tests/`). CI blocks on it. flake8 runs advisory-only, by choice.
- api-ts lints with Biome (`api-ts/biome.json`).
- GitHub operations use `gh` locally; sessions without `gh` use the GitHub MCP tools.
- Component-specific rules live in `.claude/rules/` (api-ts, webapp, bot, showcase).

## Git

- `git merge` / `git pull --no-rebase` only — **never rebase** (worktrees are common
  here and rebasing them corrupts state).
- No `Co-Authored-By` lines in commit messages.
- One coherent change per commit: the code, its tests, its migration, and any generated
  artifacts (`.env.schema`, `openapi-agent.json`) travel together. Don't mix unrelated
  formatting or dependency bumps into a functional commit.
- Imperative, conventional-style summaries (`feat(bot): …`, `fix(api-ts): …`).
- Before any push/merge, run the pre-flight checklist in `CLAUDE.md` (build artifacts,
  locks, worktree, divergence, uncommitted work).

## Code

- **Async/sync consistency**: verify the whole call chain before committing. A `def`
  containing `await` fails at import time — which CI does not catch (see Testing).
- **Migrations are additive and idempotent, always.** No destructive DDL in
  `_ensure_schema()`. Both ORMs (SQLAlchemy + Drizzle) must be updated for any schema
  change.
- **Effect-TS discipline** (api-ts): don't mix raw Promises into Effect pipelines — wrap
  with `Effect.tryPromise()`. Services follow `Context.Tag` + `Layer` + `ManagedRuntime`.
- **Shared types** (`packages/shared/`) affect api-ts, webapp, and mobile at once —
  check all three consumers.
- New env vars must be added to the settings schema (`bot/config/settings.py` or
  `api-ts/src/config/EnvService.ts`), then regenerate the contract:
  `python3 scripts/check_env_schema.py --write`. CI fails on drift.
- Never log or print secret values. Diagnostics report SET/UNSET (see
  `scripts/doctor.py` for the pattern). Never leak stack traces, SQL, or provider
  payloads to API clients.

## Naming

- Python: `snake_case` modules/functions, `PascalCase` classes; Telegram handlers live in
  `bot/handlers/<feature>.py`, business logic in `bot/services/`.
- TypeScript: `camelCase` functions, `PascalCase` components/types, route files
  `api-ts/src/routes/<feature>.ts`, webapp pages `webapp/src/pages/<Feature>.tsx`.
- Env vars `UPPER_SNAKE_CASE`; booleans read as predicates (`USE_WEBHOOK`, `*_ENABLED`).

## Testing and evidence

- pytest for Python (`pytest tests/ --cov=bot --cov=api`), vitest for webapp
  (`npm run test`, `test:integration`, `test:all`).
- New behavior and bug fixes start with a test that fails for the intended reason.
  A regression test must fail if the specific bug returns. Deleting or skipping a
  failing test to get green is forbidden.
- **CI green ≠ the bot boots.** CI does not exercise `bot/main.py`'s import chain.
  After deploys, verify with `python3 scripts/status.py` and check Railway logs for
  import errors.
- **Evidence doctrine**: a claim of done-ness must cite an observed command exit or a
  live-URL check — not README text, not CI status alone, not "the code looks right".
  `bash scripts/verify.sh` is the aggregate gate; a feature is "live" only after a real
  end-to-end exercise (actual message, actual small swap, actual record fetched). If
  live verification is blocked, say "code-complete, not functionally verified — needs X".
- Give test suites generous timeouts (≥10 min); slow CI is usually runner contention,
  not a hang.

## Generated artifacts (never hand-edit)

| Artifact | Regenerate with | Drift gate |
|----------|-----------------|-----------|
| `.env.schema` | `python3 scripts/check_env_schema.py --write` | `scripts/verify.sh` / CI |
| `api-ts/openapi-agent.json` | `bun run openapi:gen` (api-ts) | `bun run openapi:check` |

## Scope discipline

Preserve the product vision: if an engineering constraint forces a smaller design,
surface the trade-off explicitly instead of quietly shipping the reduced version.
Reason from recently committed code, not from design docs — docs drift.
