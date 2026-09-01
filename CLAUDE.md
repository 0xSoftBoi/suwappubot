# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow
- **IMPLEMENT, don't plan.** When asked to fix or build something, DO the work. If you need to explore first, limit exploration to 5 minutes then start building. Only produce a plan document if explicitly asked for one.
- If blocked, say so explicitly — don't fill the response with exploration as a substitute for implementation.

## Response Length

- Keep each assistant turn under **~400 output tokens**. Prefer many short turns over one long turn.
- For long reports, audits, or plans: `Write` them to a file and reply with the path + a 3-bullet summary. Never inline a whole document in a turn.
- Write deliverables to disk **as they are produced**, not at the end. An interrupted session should cost a turn, not the whole run.

## Git Conventions

- **IMPORTANT**: Do NOT add "Co-Authored-By" lines to commit messages.
- **Journal-only commits** (`harness(journal): ...`) must end the subject with `[skip ci]`. The test workflow has no path filters and cancels superseded PR runs, so a plain journal push cancels the in-flight CI run you're waiting on. Never put `[skip ci]` on a commit that touches code.

## Git Operations

**Before any git push, rebase, or merge**, run this mandatory pre-flight sequence. Do NOT skip steps. Only proceed after reporting all findings. If any issue is found, fix it first and re-run.

### Pre-flight checklist (run every time):
1. **Build artifacts**: Check for `.next/`, `node_modules/`, `dist/` in tracked files. If found, add to `.gitignore` and unstage before proceeding.
2. **Lock files**: Run `ls .git/*.lock 2>/dev/null` — if stale lock files exist, investigate what holds them (don't just delete).
3. **Worktree check**: Run `git rev-parse --git-common-dir` — if in a worktree, **NEVER rebase**. Always use `git merge` or `git pull --no-rebase`.
4. **Divergence check**: Compare `git rev-parse HEAD` vs `git rev-parse @{u}` to detect local/remote divergence. Recommend merge (not force-push) unless user explicitly approves.
5. **Uncommitted work**: Run `git status` and `git stash list` to surface any uncommitted changes or stashed work. Report before proceeding.

### PR merge policy
When asked to "merge all PRs": check CI on **every** open PR, merge the green ones, then actively **fix** the failing ones (including Dependabot) rather than reporting them as blocked. Only stop and ask if the fix needs a product decision or a secret you don't have. Report per-PR: merged / fixed-then-merged / blocked-with-reason.

### Additional rules:
- **NEVER use `git rebase`**. Always use `git merge` or `git pull --no-rebase`.
- **If any git operation fails twice, STOP and ask the user** — do NOT attempt dozens of recovery steps.
- Use `HUSKY=0` prefix for all git commits and pushes in worktrees to avoid hook hangs.

## Build Tools
- **Always use `bun`** instead of `tsc`, `npm`, or `npx`. The `tsc` command times out in this project.
- **Use `gh`** (GitHub CLI) for all GitHub operations.
- Component-specific rules are in per-directory files: `bot/CLAUDE.md`, `api-ts/CLAUDE.md`, `webapp/CLAUDE.md`. Repo-wide policy: `AGENTS.md` → `ARCHITECTURE.md` → `CONVENTIONS.md`.

## Project Overview

Suwappu is a cross-chain DEX bot and liquidity infrastructure for swapping tokens across 7+ chains.

- **Python Monolith** (`api/` + `bot/`): FastAPI service running Telegram bot + legacy API
- **TypeScript API** (`api-ts/`): Hono + Effect-TS API for agents and webapp
- **Webapp** (`webapp/`): React + Vite Telegram Mini App
- **Mobile** (`mobile/`): Expo iOS app
- **Showcase** (`showcase/`): Next.js homepage

Deploys to Railway. See `docs/deployment/` — and `docs/deployment/monitoring.md` for how we find out something is broken (which layer catches what, and what each one is blind to).

**Institutional knowledge — read before re-deriving anything**: `docs/README.md` (index of all docs, with staleness flags), `docs/architecture/OVERVIEW.md` (services, background tasks, request flows, data layer), `docs/ONBOARDING.md` (setup/env/test/CI facts), `docs/DECISIONS.md` (why things are the way they are — append new hard-won lessons there, not only here).

## Commands

### Python Bot + API
```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload  # Run monolith
pytest tests/                                               # Run tests
pytest tests/ --cov=bot --cov=api                           # Tests + coverage
pytest tests/test_wallet.py::test_create_wallet -v          # Single test
docker-compose -f docker-compose.local.yml up               # Local (polling)
docker-compose up                                           # Production (webhook)
```

### TypeScript API (api-ts)
```bash
cd api-ts
bun install && bun run dev       # Hot reload dev server
bun run build                    # Build for production
bun run check                    # TypeScript type checking
bun run db:generate              # Generate Drizzle migration files
bun run db:push                  # Push schema changes to database
bun run db:studio                # Open Drizzle Studio GUI
```

### Webapp (Telegram Mini App)
```bash
cd webapp
npm install && npm run dev       # Vite dev server
npm run build                    # Build for production
npm run test                     # Unit tests
npm run test:integration         # Integration tests
npm run test:all                 # All tests
```

### Mobile (Expo iOS)
```bash
cd mobile && bun install && bun run ios
```

## Architecture Gotchas

**Polling vs Webhook** (Python Bot):
- `USE_WEBHOOK=false` (default): Bot polls Telegram. **Single instance only** — multiple replicas = duplicate messages.
- `USE_WEBHOOK=true`: Telegram pushes updates. Safe for multiple replicas.

**No Alembic**: Runtime migrations in `database/db.py` via `_ensure_schema()`. All migrations are additive + idempotent. See `docs/development/migrations.md`.

**Wallet Encryption**: Default `kms_aesgcm_v2` (envelope encryption with KMS). Legacy `legacy_fernet_v1` auto-migrates to v2.

**Settings**: Python in `bot/config/settings.py` (pydantic-settings), TypeScript in `api-ts/src/config/EnvService.ts` (Effect Layer).

**Shared Types**: `packages/sdk/src/types.ts` (`@suwappu/sdk`) holds the TypeScript types shared by api-ts, webapp, and mobile. Changes affect all three.

**Background Services**: Started in `api/main.py` lifespan — `fee_sweeper`, `alert_service`, `order_service`, `tx_poller`, `health_monitor`, `launch_detector`. These are async tasks, not separate processes.

**Effect-TS** (api-ts): Uses `Context.Tag` + `Layer` + `ManagedRuntime`. Don't mix raw Promises with Effect pipelines — use `Effect.tryPromise()` to wrap async code.

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `api/` | Python FastAPI endpoints, webhook handlers |
| `api-ts/` | TypeScript API (Hono + Effect-TS + Drizzle ORM) |
| `bot/handlers/` | Telegram command handlers (start, swap, wallet, etc.) |
| `bot/services/` | Business logic — swap engines, wallet management, alerts |
| `bot/models/` | SQLAlchemy models |
| `bot/config/` | Settings, token configs, chain configs |
| `bot/utils/` | Encryption, rate limiting, formatters, caching |
| `database/` | DB init, runtime schema migrations (`_ensure_schema()`) |
| `packages/sdk/` | Client SDK + shared TypeScript types (`packages/sdk/src/types.ts`) across api-ts, webapp, mobile |
| `webapp/` | React + Vite Telegram Mini App |
| `mobile/` | Expo iOS app |
| `infra/` | AWS CDK infrastructure definitions |

## Code Changes

- **Verify imports match the target environment** (prod vs dev, Docker vs local) before deploying. Module paths differ between EC2 (bare checkout) and Docker (copied subset).
- **Check async/sync consistency** across the call chain before committing. A `def` that uses `await` will crash at import time, not at call time.
- **Run TS type-checks incrementally** (`bun run check`), not on the full project, to avoid timeouts. The `tsc` command hangs in this repo.
- **Test Python files parse** before deploying: `python3 -c "import ast; ast.parse(open('file.py').read())"`.

## Deployment

**Deploy target is Railway, NOT AWS ECS.** Production sites are live on Railway. Before diagnosing any deploy/health failure, first state which environment you're inspecting (prod URL, Railway service, or local dev) and confirm the deploy target. Do NOT propose fixes until that's confirmed — a live-production symptom is not a local-dev bug. (The `infra/` AWS CDK dir is legacy/unused for app deploys.)

**Environments**:
- **Production**: `main` branch → Railway (see `docs/deployment/railway.md`)
- **Development**: `dev` branch → Railway dev project

**Pre-deploy checklist**:
1. All changed Python files parse (`python3 -c "import ast; ..."`)
2. API URLs point to production not dev
3. All env vars referenced in code exist in deployment config
4. `bash scripts/verify.sh` passes

**Deploy methods**:
- `/deploy` skill for manual deployments (preferred)
- Railway dashboard for manual triggers and environment management
- GitHub Actions auto-deploys on push to `main`/`dev` (currently broken — billing)

```bash
python3 scripts/status.py                  # ALL services: deploy state + health + logs + CI
python3 scripts/status.py --env dev

# Single-endpoint checks. NOTE: api.suwappu.bot serves the **api-ts** service,
# NOT python-api (it returns {"service":"suwappu-api-ts"}). The Python bot has no
# custom domain in prod — use its railway.app host for the deep readiness payload.
curl https://api.suwappu.bot/health                              # api-ts (prod)
curl https://python-api-production-8526.up.railway.app/health    # python bot (prod)
curl https://devapi.suwappu.bot/health                           # api-ts (dev)
```

## API & Bot Reference

**Bot commands**: `/start`, `/s` (swap), `/w` (wallet), `/b` (balance), `/p` (portfolio), `/a` (alerts), `/o` (orders), `/snipe`, `/ref`, `/xp`. Admin: `/st`, `/hw`, `/fee`, `/m`.

**TypeScript API routes**: See `api-ts/src/routes/` — agent routes (`/v1/agent/*`), webapp routes (`/webapp/*`), swap routes, A2A protocol.

**Python API routes**: `GET /health`, `POST /telegram/webhook`, `POST /webhook` (WhatsApp).

## Verification

**RULE: Do NOT claim a deployment or change is done without running `scripts/verify.sh` first.** If you make a claim, you must have verified it.

```bash
bash scripts/verify.sh        # Run all checks
bash scripts/verify.sh api    # Run only api-ts checks
bash scripts/verify.sh agent  # Run only agent card/registry checks
```

## Standing rules (hard-won — follow these)

1. **CI green ≠ the bot boots.** The "Tests & Quality Gates" job does not exercise `bot/main.py`'s startup import chain, so a bad import passes CI and then crashes the bot. After every deploy, verify with `python3 scripts/status.py` (checks the Railway control plane, deep health, and scans logs for import errors in one shot) **and** `railway logs --service python-api | grep -iE "ImportError|ModuleNotFound|cannot import"` is empty. Do NOT use `curl https://api.suwappu.bot/health` for this — that domain serves api-ts, not the bot. The `/ship` skill does this.
2. **Don't call an integration "live" without a real end-to-end test.** Parse/boot/CI prove the code *loads*, not that the feature *works*. Send the actual message, do the actual (testnet/small) swap, fetch a real record through the new path. Use the `verify` / `run` skills. If a live test is genuinely blocked, say "code-complete, not functionally verified — needs X," not "live."
3. **For implementation, prefer `Explore` agents + direct edits over the `Workflow` tool.** Workflow schema-agents drop `StructuredOutput` on most runs → later phases skip and the work needs full hand-finishing (salvage ladder: parse → boot-import gate → dead-button audit → money-path review). Use `Workflow` only for read-only research fan-out.
4. **Model tiers & the conductor:** The main loop runs **Sonnet** and acts as the *conductor* — it plans, routes, and synthesizes; it does **not** grind. Opus runs **only** at the quality gates (`money-path-reviewer`, `security-auditor`, `suwappu-lead` for heavy architecture). Haiku does mechanical recon (`scout`, `Explore`). See **Conductor protocol** below. (Escape hatch: `/model opus` for a genuinely hard-architecture session.)
5. **Reuse before building:** use the repo skills (`/ship`, `/deploy`, `/status`, `/audit`, `/bugclass`; see `.claude/commands/`) and `docs/development/migrations.md` for schema changes and the **Blockscout MCP** for on-chain checks (router contracts, real tx) rather than hand-rolling.
6. **Pre-merge formatting:** CI runs `black --check --line-length=100 bot/ api/ tests/`. Run black on changed Python before pushing or CI fails on style.

## Conductor protocol (how the main loop works)

The main loop is the **conductor**, not a worker. Measured baseline (46 sessions): 97% of output came from the main loop and only **3% of file-touching actions were delegated** — that is the habit we are fixing.

**Default to delegation.** Any multi-step search, audit, feature edit, test run, or verbose command goes to a specialist. The conductor's own job is: understand → decompose → route → synthesize → decide. Do trivial single edits and final synthesis yourself; push everything else down.

**Routing table:**

| Work | Send to | Model |
|------|---------|-------|
| "where is X / does Y exist / audit all Z", registration & parse/boot gates, dead-button audits | `scout` | haiku |
| Broad fan-out file search (conclusion only) | `Explore` | haiku |
| Web / competitor / economics / design-critique / best-practice research | `researcher` | sonnet |
| Python bot/api/db feature work | `bot-dev` | sonnet |
| TypeScript api-ts feature work | `api-ts-dev` | sonnet |
| Webapp (Telegram Mini App) feature work | `webapp-dev` | sonnet |
| Showcase site / marketing / visual polish | `showcase-dev` | sonnet |
| **Visual quality gate for anything people look at** — NFT/generative output, card renderers, visual systems. Renders and LOOKS; judges the 190px grid, not the hero shot | `art-director` | **opus** |
| Brand drift across surfaces, design-token single-sourcing, voice consistency | `brand-guardian` | sonnet |
| Positioning, launch narrative, mint/landing copy, distribution | `growth-marketing` | sonnet |
| Dual-ORM schema change | `db-migrate` | sonnet |
| New chain integration | `chain-support` | sonnet |
| SDK/package sync | `sdk-dev` | sonnet |
| Tests | `test-engineer` | sonnet |
| Swap/balance/RPC debugging | `swap-debug` | sonnet |
| Deploys / health / logs | `deploy-ops` | sonnet |
| Production incident | `incident-responder` | sonnet |
| General code-quality review | `reviewer` | sonnet |
| **Any diff a builder tagged `MONEY-PATH`** (swap exec, wallet/keys, KMS, billing/x402, fee math, seasons/points, withdrawals) | `money-path-reviewer` | **opus** |
| Security posture / OWASP / secret scan | `security-auditor` | **opus** |
| Genuinely large multi-service architecture needing a second Opus brain | `suwappu-lead` | **opus** |

**Never use `general-purpose` for research** — it's an untiered catch-all that runs at the main-loop tier. Use `researcher` (sonnet) or `scout` (haiku) instead.

**Context discipline** (the 4.5B cache-read tokens come from 1,400–1,800-turn marathons):
- **One task ≈ one session.** `/clear` between unrelated tasks instead of letting context balloon.
- **Isolate verbose output** — test runs, log tails, big greps, doc fetches go to a subagent so their output stays in *its* context, and only a tight summary returns to the conductor.

## Self-Improving Harness

This harness evolves itself from session evidence — see `docs/harness/self-improving.md`.
- Every session's Stop hook appends a friction record to `.claude/harness/journal/`.
- `/reflect` at end of task: capture corrections into `.claude/harness/lessons.md` (capped at 25, merge-or-evict).
- `/evolve` (one-shot, `/loop`, or weekly Routine): digest journal → one surgical patch to a harness artifact → `scripts/harness/harness_lint.py` must PASS → commit as `harness(evolve): ...`.
- No evidence → no change. A lesson re-edited 3+ times gets promoted to a hook/skill/permission instead of more prose.

## Custom Skills

- `/ship` — Branch → commit → PR → wait for CI green → merge → verify the bot boots
- `/deploy` — Deploy services to Railway (`prod|dev` × `python-api|python-worker|terminal|api-ts|showcase|all`)
- `/audit` — Attacker-minded security audit of scoped files; streams compact findings incrementally
- `/audit-fleet` — Parallel audit: one `security-auditor` per attack surface, findings streamed to `.audit/findings/*.jsonl`, then deduped/ranked/filed
- `/bugclass` — Treat one confirmed bug as a class: reproduce → fix → sweep both stacks → one commit per instance
- `/worktree-check` — Audit all worktrees for uncommitted/unpushed/stashed work at risk **before** any reset or cleanup

## Security Audits

- **Stream findings incrementally — never a single giant end-of-session JSON dump.** As you *confirm* each finding, append it to `findings.json` (or emit it) immediately. Spend/output limits repeatedly killed audits that batched everything for the end, losing the whole deliverable.
- Keep each finding compact: `severity`, `file:line`, exploit path, fix. Distinguish real bugs from false positives explicitly.
- End with a candid coverage QA note: what you scanned, what you skipped or refused, and why.
- Scope to specific candidate files up front rather than "audit everything."
- **Structured output goes FIRST.** When asked for JSON findings, emit/append the JSON object for each finding **before** any prose explanation, file-by-file. Never buffer the analysis and dump the JSON at the end — multiple audits (IDOR, 2FA bypass, fee overcharge) died at the spend limit with zero parseable output.
- Finding shape: `{file, line, severity, title, exploit_path, preconditions, confidence, false_positive_reasoning}`.

## CI / Testing

- **Do NOT cancel a CI run or long command assuming it hung.** GitHub Actions runner contention is common and slow suites are expected. The Bash tool caps ~2 min — that is a tool timeout, not a hung job. Wait and re-check `gh run watch` / poll status before concluding failure.
- Give slow test suites generous timeouts; an 18-test run taking minutes is normal, not a hang.
- **Always pass an explicit `timeout` of at least `600000` ms** to Bash for `pytest`, `npm test`/`bun test`, builds, and CI polling. Never cancel a GitHub Actions run for slowness — check whether the job is *queued* (runner contention) vs actually stuck, and wait at least 15 minutes before escalating.

## Live Verification

- **A fix is not complete until it is verified on the live deployed URL.** CI green and "deploy succeeded" are not evidence.
- After any deploy: load the production URL with the claude-in-chrome MCP, screenshot the affected view, and report the evidence. If the browser tool can't set the viewport, use the iframe workaround at the target width.
- If live verification is genuinely blocked, say "code-complete, not functionally verified — needs X." Never report "deployed" from CI status alone.

## Working Style / Scope

- **Reason from the actual recently-committed code, not from design/tokenomics docs or the Anchor program.** Docs drift; the working code is ground truth. When in doubt, `git log`/read the current source.
- **Preserve the original product vision.** Do NOT let engineering constraints silently shrink scope. If a constraint forces a smaller design, surface it explicitly and ask — don't quietly ship the reduced version.
