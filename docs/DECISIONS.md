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
  agent / `/migrations` skill).

## Security & Wallets

### Envelope encryption via KMS is the default
- **What**: Wallet keys use `kms_aesgcm_v2` (KMS envelope encryption); legacy
  `legacy_fernet_v1` blobs auto-migrate on touch. See `docs/KMS_AWS_MIGRATION.md`.
- **Consequence**: Any change touching key material is MONEY-PATH and gets an
  adversarial review before merge.

## Engineering practice

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

---
*Add new entries via PR. Keep each entry under ~8 lines.*
