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

### The card is drawn by the contract, not fetched from us (2026-08)
- **What**: `SuwappuPositions` and `SuwappuMembership` now render their own SVG
  and metadata on-chain (`contracts/art/`), behind a swappable renderer address
  that falls back to the base URI when unset. No IPFS, no render server, no
  pinning bill.
- **Why**: the collection's claim is that a card is bound to a live oracle price
  with nothing in between. A renderer behind a domain makes that false the first
  time the domain lapses; a pinned JPEG makes it false immediately.
- **Consequence if ignored**: a "live" card that is actually a cached image of a
  price from mint day, and a collection whose art dies with the hosting bill.
- **Gotchas paid for here**: (1) the ticker is `symbol()` on someone else's
  ERC-20 — escape it or it is markup injection into your own SVG, and decode the
  bytes32 shape too or real tokens render as `#12`; (2) emitting one path per
  guilloche pass cost ~4x the SVG and millions of gas for a byte-identical
  picture — cut the figure once and re-chuck it with `<use>`/`scale`/`rotate`;
  (3) a `<pattern>` pitch under ~1 display pixel is the same as no grain at all;
  (4) money at two decimals printed `$0.04` for both entry and mark on
  sub-dollar tickers and read as a bug — four decimals under $1.

### A contract can only be the artwork if the artwork is the contract (2026-08)
- **What**: `contracts/art/SuwappuCodex.sol` draws a portrait of deployed
  bytecode — its own via `selfPortrait()`, or any address's — read out of the
  state trie at call time. Position cards now also carry `STRUCK BY <codehash8>`,
  the mark of the renderer that drew them.
- **Why**: "the contract is art" is decoration unless the thing being looked at
  is the machine. A portrait of the compilation cannot be faked or restated: it
  changes when the source changes, and anyone can check it with `eth_getCode`.
- **What it bought us, concretely**: the three renderers show ZERO storage writes
  and ZERO outward calls on their plates; `SuwappuPositions` is covered in both.
  A pure function and a custodian are now distinguishable across a room without
  reading either. `census(address)` exposes the same numbers for verification.
- **Gotchas paid for here**: (1) classify bytes by opcode table and
  `PUSH32 <32 x 0x55>` reports thirty-two SSTOREs in a contract with none — walk
  PUSH properly or the picture is noise with a false caption; (2) reduce a cell
  by simple majority and every cell of every contract is STACK or DATA, so the
  rare-and-consequential must be PROMOTED, not averaged away; (3) it is a linear
  sweep, so Solidity string constants living in the code section decode as
  phantom instructions — say so rather than claiming disassembly.
