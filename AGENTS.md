# AGENTS.md — executable agent policy

Policy for AI agents (Claude Code and others) working in this repository. Precedence:
this file → `ARCHITECTURE.md` → `CONVENTIONS.md`. `CLAUDE.md` is the Claude-Code-specific
operational profile (conductor protocol, routing table, response-length rules) and is
kept authoritative for those details — this file is the tool-agnostic summary.

## Ground rules

1. **Implement, don't plan.** Bounded exploration, then build. Plans are deliverables
   only when explicitly requested.
2. **Evidence over assertion.** Done-ness claims cite command exits or live-URL checks.
   `bash scripts/verify.sh` aggregates the gates; `python3 scripts/status.py` checks
   what's actually running; `python3 scripts/doctor.py` probes the local toolchain and
   capability state without printing secrets.
3. **Money-path changes get adversarial review.** Anything touching swap execution,
   wallet/keys, KMS, billing/x402, fee math, points, or withdrawals is tagged
   `MONEY-PATH` and reviewed by the dedicated reviewer before merge.
4. **Never rebase; never add Co-Authored-By; black before push.** See `CONVENTIONS.md`.
5. **Generated artifacts are regenerated, not edited**: `.env.schema`,
   `api-ts/openapi-agent.json`.
6. **Secrets**: never print values (SET/UNSET only), never commit env files, never widen
   a secret's scope to make a test pass.

## Repo skills (reuse before building)

Scaffolding and workflows exist as skills — use them instead of hand-rolling:
`/new-handler` (Telegram command), `/new-route` (api-ts endpoint), `/new-page` (webapp),
`/new-test`, `/migrations` (dual-ORM schema change), `/ship` (branch→PR→CI→merge→boot
verify), `/deploy`, `/status`, `/audit`, `/bugclass`, `/worktree-check`.

## Where things live

| Task | Entry point |
|------|-------------|
| Telegram command | `bot/handlers/` + registration; logic in `bot/services/` |
| api-ts endpoint | `api-ts/src/routes/` (Hono + Effect-TS) |
| Schema change | Both `bot/models/` (SQLAlchemy) and api-ts Drizzle; additive+idempotent |
| Webapp page | `webapp/src/pages/` |
| Env var | `bot/config/settings.py` or `api-ts/src/config/EnvService.ts`, then regenerate `.env.schema` |
| Optional provider | Declare in `capabilities.yaml`; the manifest, not the code, is the truth source |

## Verification ladder (cheapest first)

1. Parse gate: `python3 -c "import ast; ast.parse(open('file.py').read())"`
2. Type gate: `bun run check` (api-ts, incremental)
3. Unit gates: `pytest tests/`, webapp `npm run test`
4. Aggregate: `bash scripts/verify.sh`
5. Boot gate: `python3 scripts/status.py` + Railway logs clean of import errors
6. Live gate: real end-to-end exercise of the changed path

CI green passes gates 1–4 only. A deploy claim requires 5; a "feature works" claim
requires 6.
