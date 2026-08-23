# Decision & Lessons Log

Institutional knowledge that is easy to lose: decisions we made, why, and the
incidents that taught us. Newest entries at the top of each section. When you
learn something the hard way, add it here — one short entry beats re-learning it.

Format: **What** / **Why** / **Consequence if ignored**.

Formal architecture choices (decisions with alternatives) live as ADRs in
[`docs/adr/`](adr/README.md); this file is for lessons, gotchas, and incident
learnings. The five foundational decisions below are also recorded as
ADRs 0001–0005.

## Deployment & Operations

### Railway: a service's source config is not a GitHub connection (2026-08)
- **What**: `serviceInstanceUpdate` writes `repo`/`branch` onto a service;
  `serviceConnect` performs the GitHub authorization and webhook handshake.
  They are separate mutations and only the second makes pushes deploy.
- **Why**: `showcase` in the dev environment showed
  `source: {repo, branch}` in its config and never built. The Railway MCP's
  `update-service` cannot change source, `railway-agent` has no `serviceConnect`
  tool (it says so when asked), `redeploy` explicitly cannot produce a first
  deployment, and `create-deployment` builds a *new* service. The dashboard's
  "Connect repo" is the only one-step path.
- **Also**: `serviceInstanceDeployV2` without a `commitSha` deploys "the commit
  currently associated with the service" — on a never-deployed service that is a
  well-formed no-op that reports success.
- **Consequence if ignored**: hours spent re-triggering a build that was never
  going to fire. Diagnose it by comparing against a sibling service on the same
  repo, branch and watch patterns: if the sibling builds and yours does not, the
  trigger is missing, not the config.

### Boot-time seeding must survive a schema that arrives late (2026-08)
- **What**: anything that writes to dual-owned tables (ADR 0003) at startup has
  to retry, not assume the schema exists.
- **Why**: the autopilot's agent bootstrap ran at boot, failed because
  `autopilot_agents` did not exist yet, and never tried again — leaving the
  environment permanently empty while the API served happily. The tables
  appeared about a minute later, created by the Python stack's
  `_ensure_schema()`, because that environment skips the boot-time drizzle sync.
- **Consequence if ignored**: a one-shot seed loses a race it does not know it
  is in, and the failure looks like "the feature is just empty".

### `NEXT_PUBLIC_*` must be a build arg, not only a runtime variable (2026-08)
- **What**: `showcase/Dockerfile` declares each `NEXT_PUBLIC_*` as an `ARG` and
  threads it into the build environment.
- **Why**: Next inlines these into the client bundle at build time. Setting one
  only as a platform service variable reaches server components at runtime and
  silently misses everything running in the browser.
- **Consequence if ignored**: a page that server-renders correctly and then
  polls the wrong origin forever — right on load, quietly stale after.

### Deploy target is Railway, not AWS
- **What**: All production services deploy to Railway. The `infra/` AWS CDK
  directory is legacy and unused for app deploys.
- **Why**: Migrated off AWS ECS; Railway won on iteration speed for this team.
- **Consequence**: Diagnosing a "prod" issue against AWS wastes hours on the
  wrong environment. Always state which environment you're inspecting first.

### `api.suwappu.bot` serves api-ts, not the Python bot
- **What**: The custom domain routes to the TypeScript API
  (returns `{"service":"suwappu-api-ts"}`). The Python bot has no custom
  domain in prod — use its `*.up.railway.app` host for health checks.
- **Consequence**: Curling `api.suwappu.bot/health` tells you nothing about
  whether the bot is alive. Multiple false "all clear" reports came from this.

### CI green does not mean the bot boots
- **What**: The "Tests & Quality Gates" job never exercises `bot/main.py`'s
  startup import chain. A bad import passes CI, then crashes the bot on deploy.
- **Consequence**: After every deploy run `python3 scripts/status.py` and check
  Railway logs for `ImportError|ModuleNotFound`. The `/ship` skill automates this.

### Polling mode means exactly one bot instance
- **What**: With `USE_WEBHOOK=false` (default) the bot polls Telegram; two
  replicas produce duplicate message handling. Webhook mode is replica-safe.
- **Consequence**: Scaling the python service horizontally without switching to
  webhook mode double-fires every command, including swaps.

## Database

### No Alembic — runtime migrations only
- **What**: Schema changes live in `database/db.py` `_ensure_schema()` and must
  be additive + idempotent. TS side mirrors schema in Drizzle.
- **Why**: One process, zero migration tooling to operate; the DB is shared
  between the Python and TS stacks, so both schemas must stay in sync.
- **Consequence**: A destructive or non-idempotent migration breaks every boot,
  not just one deploy. Dual-ORM changes must touch both stacks (`db-migrate`
  agent, `docs/development/migrations.md`).

## Security & Wallets

### Envelope encryption via KMS is the default
- **What**: Wallet keys use `kms_aesgcm_v2` (KMS envelope encryption); legacy
  `legacy_fernet_v1` blobs auto-migrate on touch. See `docs/KMS_AWS_MIGRATION.md`.
- **Consequence**: Any change touching key material is MONEY-PATH and gets an
  adversarial review before merge.

## Engineering practice

### Public API shapes are mapped explicitly, never serialised ORM rows (2026-08)
- **What**: every field a route returns is written by a `toPublicX()` mapper in
  snake_case. Returning a Drizzle row, or an internal type like
  `OpenPositionSummary`, is not allowed even when the fields happen to look right.
- **Why**: the autopilot shipped twice with camelCase leaking onto the wire. The
  first time, a consumer read `gate_passed` as `undefined` and rendered **every
  fill as a refusal** — the dashboard looked plausible and was completely wrong.
  The second was the same bug in the positions route, found only because the UI
  was built. Neither was caught by types or tests: both sides compiled fine.
- **Consequence if ignored**: a silently wrong client, and column names become
  API surface that breaks the moment the schema is renamed. Pin the casing with
  a test that iterates `Object.keys()` — that is what now catches it.

### A canonical form is a spec, and string encoding is part of it (2026-08)
- **What**: `sha256-canonical-v1` is keys sorted lexicographically, no
  whitespace, and **strings as raw UTF-8** — non-ASCII is not `\uXXXX`-escaped.
- **Why**: verifying a live autopilot commitment with an idiomatic Python
  checker returned MISMATCH on honest data, because `json.dumps` escapes
  non-ASCII by default and every generated thesis contains an em dash. Go's
  `encoding/json` escapes HTML characters for the same class of reason.
- **Consequence if ignored**: for anything published as verifiable, a
  library default silently produces the exact signal of a forgery. Publish the
  pre-image alongside the hash so a mismatch is a diff, not an accusation.

### A paper record must be pessimistic by construction (2026-08)
- **What**: simulated fills are directional (buys above mid, sells below), are
  booked at the fill the executor returned rather than the mid it saw, and pay a
  per-side fee. An instant round trip at an unchanged price must lose money.
- **Why**: the autopilot's paper book had all three wrong at once, each biased
  upward — sells modelled with `1 + impact`, exits marked at the mid, no fees.
- **Consequence if ignored**: the P&L you show people is manufactured, and the
  error is invisible because every individual number looks reasonable. Test the
  invariant ("a round trip loses"), not the arithmetic.

### Shared TS types live in `packages/sdk`, not `packages/shared` (2026-08)
- **What**: the old `packages/shared` directory was removed; the shared-type home for api-ts,
  webapp, and mobile is `packages/sdk/src/types.ts` (`@suwappu/sdk`). Several
  docs (incl. CLAUDE.md) cited the dead path for months, and skills
  `/migrations`, `/new-handler`, `/new-route`, `/new-page`, `/new-test` were
  deleted while docs kept recommending them.
- **Consequence**: this is exactly the drift class `scripts/check_docs_drift.py`
  (the `docs` lane of `verify.sh`) now catches — when renaming or deleting a
  path or skill, sweep the canonical docs in the same PR.

### `tsc` hangs in this repo — use `bun`
- **What**: Full-project `tsc` times out. Use `bun run check` (incremental) and
  `bun` for all JS tooling.

### Async/sync mismatches crash at import time
- **What**: A `def` containing `await` fails when the module loads — i.e. at
  bot boot, in prod, not at call time. Check the whole call chain.

### Docs drift; code is ground truth
- **What**: Design/tokenomics docs and the Anchor program lag the shipped code.
  When a doc and `git log` disagree, the code wins.
- **Consequence**: Reasoning from a stale doc has shipped wrong fee math before.
  Verify claims against current source.

### Verification standard
- **What**: "Done" requires `bash scripts/verify.sh` passing and, for deploys,
  a live check on the deployed URL. Parse/boot/CI prove code *loads*, not that
  a feature *works* — integrations need one real end-to-end exercise.

### A new column must be deployed before the code that reads it
- **What**: Under the dual-owned schema (ADR 0003) the additive `ALTER` lives in
  Python's `_ensure_schema()`, which runs on **python-api boot**. api-ts builds
  with Railpack and deploys minutes sooner than python-api's Docker build.
- **Consequence**: Merging a Drizzle read of a new column together with its
  Python `ALTER` puts api-ts in production reading a column that does not exist
  yet. `/v1/autopilot/:slug/positions` 500'd on dev for exactly this window.
- **Instead**: Ship the column first (schema-only commit, let python-api boot),
  then ship the code that selects it. If they must go together, expect a 500
  window and watch python-api's boot, not api-ts's health check.

### A readiness poll must not match its own failure message
- **What**: Polled for `max_hold_minutes` in the response body to confirm a
  deploy. The 500's error text names the missing column, so the check passed on
  the failure it was meant to catch. An earlier poll in the same session used
  `/health`, which the *old* deployment also serves.
- **Instead**: Assert on a success-only signal — `"success": true`, an HTTP 200
  on a route that did not previously exist, a changed build fingerprint. Ask of
  every readiness check: would this still pass if the deploy were broken?

### A green deploy does not mean the migration ran
- **What**: `_create_autopilot_tables()` returns early when the tables already
  exist — it is create-if-absent, not ensure-schema. An additive `ALTER` placed
  after that return is unreachable on every database that already has the
  tables. python-api deployed SUCCESS having executed nothing.
- **Consequence**: dev 500'd indefinitely, not for a deploy window. "It will
  self-heal once the other service boots" was asserted from reading the code
  and was wrong for two turns.
- **Instead**: Additive columns go **before** any early return, in the declared
  `_AUTOPILOT_ADDITIVE_COLUMNS` map. Prove a migration by running it against a
  database in the pre-migration state, not by reading it.

---
*Add new entries via PR. Keep each entry under ~8 lines.*
