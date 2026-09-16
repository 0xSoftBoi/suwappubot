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

### python-worker memory: bound it in-process, don't hunt it cold (2026-09)
- **What**: `bot/services/memory_guard.py` samples RSS every 15s. Above
  `MEMORY_GUARD_SOFT_GB` (3) it arms `tracemalloc` and logs the top allocation
  sites, live-task histogram and gc type histogram; above
  `MEMORY_GUARD_HARD_GB` (6) it logs the same and `os._exit(137)` so Railway's
  `ON_FAILURE` policy restarts it. `railway.python-worker.json` also carries
  `deploy.limitOverride.containers.memoryBytes` (8 GB) as the platform-side
  ceiling, and `api/Dockerfile.railway` sets `MALLOC_ARENA_MAX=2`.
- **Why**: the worker ballooned 2 GB → 27–31 GB on 2026-08-22 and again
  2026-09-07 ~09:39Z, then vanished from the logs with no traceback — a
  platform SIGKILL at the 32 GB plan ceiling. Two weeks of static analysis
  (cost audit F2) found nothing because a SIGKILL leaves no evidence; the
  only way to learn the cause is to have the process report *while* it is
  climbing. Railway bills RAM per minute, so a 6 GB self-restart is ~5x
  cheaper per incident than the kill it replaces, and `ON_FAILURE` only
  restarts on a nonzero exit — a graceful SIGTERM exits 0 and would stay down.
- **Consequence if ignored**: every recurrence costs a silent multi-GB-hour,
  stops `fee_sweeper`/`order_service`/`tx_poller` until the retry cap is hit,
  and teaches us nothing. When the soft report fires, read it and fix the
  loop it names; do not raise the thresholds to make it quiet.

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

---
*Add new entries via PR. Keep each entry under ~8 lines.*

### NFT collection numbers come from chain-native ground data, not instinct
- **What**: Suwappu Positions was renumbered 10,000 → 4,444 with two-tier
  $19/$119 pricing and a 555-card on-chain-stamped Founders' Gold edition,
  against verified Robinhood Chain data (Blockscout top-50 by holders +
  cited sale economics for every major 4663 collection). Free mints there
  buy distribution, never floor; premium tiers at ~12% of units carry ~50%
  of revenue (Spritehood); durable floors only come from utility inside the
  token (StonkBrokers, Gremlin Cartel). Evidence and numbers:
  `docs/research/robinhood-chain-nft-*.md`, rationale in
  `nft/position-cards/README.md` and config comments.
- **Also**: an SVG `<rect filter=...>` with no fill defaults to black and
  cairosvg/librsvg (marketplace indexers) drop the filter — the whole
  collection rasterized as black rectangles until the art-director pass
  caught it. Always rasterize through cairosvg before shipping card art.

### Prose surfaces follow one writing standard, linted
- **What**: Every prose surface (docs, research posts, showcase copy, README,
  bot strings) follows `docs/WRITING.md`: short declarative sentences, claim
  then limit in two sentences, no em-dashes or parentheticals as glue, numbers
  out of prose, one pull quote per long piece, a limits section in body text.
  `scripts/copy_lint.py` enforces the mechanical rules, advisory, in the docs
  verify lane. Evidence: `docs/design/reference-breakdown-kamino-letter.md`.
- **Why**: our research openings ran 35 to 50 word sentences with stacked
  hedges, and a skimmer could not find the one sentence to remember.

### Customer-facing numbers are re-derived from source and gated by a check
- **What**: Positions launch copy advertised 10,000 cards while citing the
  contract constant that reads 4,444. It quoted a Founder wallet cap of 3
  against a configured cap of 1. It promised a 40% Enterprise fee discount that
  `fee_service.py:266` refuses to grant. All three carried a source citation.
  `scripts/check_positions_numbers.py` now re-derives every one of those numbers
  from `contracts/SuwappuPositions.sol` and `nft/position-cards/config.json` and
  fails `scripts/verify.sh docs` on disagreement. Verified to go red on both the
  supply revert and the Enterprise claim before being trusted.
- **Why**: a citation makes a reader stop checking, so a cited number that drifts
  outlives the thing it was copied from. Rule in `docs/WRITING.md` §5.

### The docs markdown renderer is hand-written, so features must be verified
- **What**: `showcase/src/app/docs/[section]/[slug]/markdown.ts` had no italics
  rule, so every `*deck line*` on every research post and doc page rendered
  literal asterisks in production. Added one that runs after bold and after both
  code paths, with code regions masked so no asterisk inside a fence or a code
  span is consumed.
- **Also**: the first attempt used raw NUL bytes as mask sentinels, which made
  the source a binary file to grep and silently broke the restore pass. Use a
  printable sentinel. Before relying on any markdown feature here, render the
  page and look at it.

### `gitbook/` is the deployed docs tree; `docs/` is not
- **What**: A first pass at applying the writing standard rewrote
  `docs/quickstart.md`, `docs/features/*` and `docs/agent-clients.md`, none of
  which reach a customer. `showcase/scripts/regen-docs.mjs` builds the live docs
  site from `gitbook/` (61 files, ~51k words) into
  `showcase/src/data/docs.json`. That tree was never linted or touched.
  `scripts/verify.sh docs` now lints `gitbook/` first, and `docs/WRITING.md` §9
  names which tree ships.
- **Why**: "docs" in this repo means two different things. The one that is
  published is the one without the obvious name.

### `showcase/src/data/docs.json` is generated but NOT regenerated by the build
- **What**: the live docs site reads `showcase/src/data/docs.json` and
  `showcase/public/llms*.txt`, which `regen-docs.mjs` builds from `gitbook/`.
  That script is **not** in showcase's `prebuild` (which runs
  `build-content.ts` and `gen-llms.mjs` only), so the site serves whatever
  `docs.json` is committed. Editing `gitbook/` without running
  `bun run docs:generate` ships the change as source-only.
- **Why it bit us**: a full prose rewrite of all 61 gitbook files nearly
  shipped with a stale `docs.json`, which would have left every customer
  reading the old text while the repo looked correct.
- **Guard**: `scripts/check_generated_docs.sh`, in the `docs` verify lane,
  regenerates and fails if the committed artifacts differ. Verified to fire on
  an un-regenerated gitbook edit.

### A MarkdownV2 message with unescaped punctuation fails only at send time
- **What**: Telegram rejects a `parse_mode="MarkdownV2"` message whose reserved
  punctuation is not backslash-escaped, with a 400 at send time. CI performs no
  real send, so the user simply never receives the message.
- **Why it matters for copy**: legacy `Markdown` (576 call sites here) does not
  require `.` to be escaped; MarkdownV2 (9 sites) does. Rewriting an em-dash to
  a period is safe in one and breaks the other, so any prose edit to bot strings
  has to be parse-mode aware.
- **Guard**: `scripts/check_markdown_escapes.py` in the `python` verify lane. It
  checks only punctuation that is always reserved, and skips `*`, `_` and any
  literal containing a backtick, because those are formatting delimiters and
  concatenated code spans cannot be resolved from a single literal. Precision
  over recall: an earlier version flagged bold markers and `callback_data` and
  would have been ignored within a day.

### Most user-facing copy is in code, where the Markdown linter cannot see it
- **What**: `copy_lint.py` reads Markdown and JSON. Errors, empty states,
  warnings and button captions live in Python handler strings and JSX text
  nodes. A clean `copy_lint` run proves nothing about them.
  `scripts/check_app_copy.py` covers bot, webapp, terminal, extension and
  showcase, and runs `--strict` in the docs verify lane. All five are at zero.
- **Why it matters**: a Telegram user reads the bot's strings thousands of times
  more often than anyone reads the README.
- **Precision is the whole game.** The scanner skips comments, log calls, dev
  warnings, tests, stories, SVG path data, TypeScript generics and minified
  snippets. It blanks comments while keeping their newlines, so reported line
  numbers are correct. It does NOT treat a semicolon as a code marker: that
  false negative hid a real empty state reading "lands; your swaps".
- **Companion guards**: `check_markdown_escapes.py` for the Telegram parse-mode
  hazard, and `check_ts_copy_only.py` to prove a TypeScript rewrite touched no
  code when the workspace cannot be built.

### The Discord integration is dead code: the `bot.platforms` package is absent
- **What**: `api/main.py:333` imports `bot.platforms.discord_bot` and
  `bot/services/discord_alerts.py:18` imports `bot.platforms.discord_embeds`.
  Neither module exists. The `bot.platforms` package is absent from the working
  tree, from the index, and from `origin/main`.
- **Not a boot risk, and traced to be sure**: the api import sits inside a
  `try/except` that only runs when `settings.discord_bot_token` is set, so
  `discord_bot` is always `None`. The alerts service is then imported only
  `if discord_bot:` and wrapped in `_track_degraded`, which never lets an
  optional service block startup. Setting the token gets a warning and no
  Discord, never a crash.
- **Consequence**: the feature is advertised by a setting nobody can use. Either
  land the `bot.platforms` package or remove the setting and the two call sites.
- **Found by**: `scripts/check_import_graph.py`, now in the `python` verify
  lane. It resolves every intra-repo import without needing third-party packages
  installed, which is the gap behind the standing "CI green does not mean the
  bot boots" rule. Both gaps are listed in the script with a date and a reason,
  so it fails on anything new.
