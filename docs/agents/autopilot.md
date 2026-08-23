# Autopilot — the autonomous trading agent

Autopilot is a trading agent that decides, commits, trades and publishes on its
own. It runs on the execution infrastructure we already had (multi-chain swap
routing, managed wallets, policy gates, token security) and adds the part that
was missing: a loop that forms a thesis, refuses or takes the trade against
explicit rules, and makes the whole thing checkable afterwards by someone who
does not trust us.

```
read → think → gate → seal → execute → journal → reveal
```

## Why the order matters

The thesis is hashed and written to the database **before** any execution
attempt, and only revealed afterwards. That single ordering is what separates
"the agent called this in advance" from "the agent wrote a story about a trade
it already made". Anyone can take a revealed decision, recompute
`sha256("sha256-canonical-v1|" + nonce + "|" + canonical_thesis)` and compare it
to the commitment that was published before the fill.

Refusals are published on the same terms as fills. A decision that fails a gate
is still sealed, still revealed, and still appears in the public feed with the
full verdict of every rule that ran. An agent that only shows you its trades is
showing you half the data.

## The stages

| Stage | Where | What happens |
|---|---|---|
| read | `services/autopilot/market.ts` | Screen two surfaces — DexScreener's boosted feed (re-read as real pair data) and a search over each chain's quote assets, which surfaces deep pairs nobody paid to promote. Deduped to the deepest pair per token. Mark open positions to market. |
| think | `services/autopilot/thesis.ts` | A `ThesisEngine` turns a candidate into an action, size, confidence, evidence and a committed exit plan. |
| gate | `services/autopilot/gates.ts` | Pure risk rules. Every rule runs (so the verdict is complete), and exits are never blocked by entry rules. |
| seal | `lib/seal.ts`, `autopilot/anchor.ts` | Canonical-JSON SHA-256 commitment with a blinding nonce, written before execution and — when anchoring is on — published on-chain as a memo before the trade. |
| execute | `services/autopilot/executor.ts` | Paper fill, or a live fill routed through our own agent API. |
| journal | `AutopilotService` | Append-only narrative log of every stage, including the failures. |
| reveal | `AutopilotService` | Thesis and nonce published, making the commitment checkable. |

## Thesis engines

`ThesisEngine` is an interface; `RulesThesisEngine` is the default. It scores
depth, turnover, momentum and pool age, and deliberately fades parabolas — a
token already up 200% on the hour scores near zero, because the trade there is
someone else's exit. Its output is fully reproducible from the candidate
snapshot, so a reader can re-derive the decision rather than take the narrative
on faith.

`LlmThesisEngine` puts Claude behind the same interface, with the split kept
explicit: **the model writes the argument, the code writes the trade.** It
receives measured facts and returns only judgement — direction, conviction,
reasoning, invalidation. Which token, which chain and how much are set from the
screened candidate and the caller's budget, so a model that hallucinated a
ticker or a $10,000 size could not express it through this interface. Its
structured output is re-validated on arrival: a malformed answer produces no
thesis rather than half of one, and an API failure degrades the agent to
"forms no theses", never to trading on a partial parse.

Every LLM thesis also publishes the deterministic scorer's breakdown in its
evidence, including whether the rules engine agreed — so a reader can see when
the narrative overrode the numbers. Cost is bounded by a free pre-screen, a
cached system prompt, low effort, and a per-cycle call cap.

An agent whose published `thesis_engine` is `llm` refuses to run without
`ANTHROPIC_API_KEY` rather than silently falling back and mislabelling the feed.

## The gate

Entries run every one of these; a single failure refuses the trade:

`chain_allowed`, `token_not_denied`, `max_position_size`, `positive_size`,
`no_duplicate_position`, `max_open_positions`, `max_portfolio_exposure`,
`sufficient_dry_powder`, `daily_spend_cap`, `daily_loss_halt`,
`token_cooldown`, `min_confidence`, `exit_plan_committed`,
`market_data_present`, `min_liquidity`, `max_pool_share`, `min_token_age`,
`security_scan_present`, `not_honeypot`, `max_buy_tax`, `max_sell_tax`,
`holder_concentration`, `lp_locked`.

Two design decisions worth knowing:

- **Unknown is refuse.** A missing security scan or unknown pool age fails the
  gate. An agent that buys because the safety check timed out is worse than one
  that sits still.
- **Exits run a thin gate.** Selling only checks that the position exists.
  Nothing about exposure, liquidity or daily caps may stand between the agent
  and the door — a risk system that can stop you selling is a bug.

Rules are per-agent (`autopilot_agents.rules`), merged over the compiled
defaults in `services/autopilot/types.ts`, and published on the agent's public
endpoint. `requireLpLocked` defaults to on, and is only satisfiable where lock
data is actually verifiable — leave it on for Solana and turn it off explicitly
(and visibly) for an EVM agent rather than pretending we checked.

## Execution

`PaperExecutor` is the default and simulates the fill from pool depth with
constant-product slippage. `ManagedExecutor` goes through our own public agent
API (`POST /v1/agent/quote` then `POST /v1/agent/swap/execute`) with the
autopilot's API key, so every existing money-path control — policy gate, spend
limits, approvals, fee handling, idempotency — applies unchanged. **The
autopilot owns no signing path of its own**, deliberately: it is a client of the
same API our external agents use.

The decision's commitment doubles as the `Idempotency-Key`, so a retried cycle
cannot double-fill a decision.

## Anchoring

`anchor.ts` writes `suwappu-autopilot:v1:<algo>:<commitment>` as calldata on a
zero-value self-send before the trade, so a block — not our database — witnesses
the ordering. The anchor key is deliberately separate from every trading and fee
key: it signs nothing but ~80 bytes of memo, so compromising it buys an attacker
the ability to publish junk and nothing else.

A failed anchor **blocks an entry** — the decision is marked failed, revealed and
never executed, because half-anchored history invites a claim the data cannot
support. It does **not** block an exit; nothing, including our own transparency
machinery, may stand between the agent and the door, and the unanchored exit is
journalled as such. Anchoring is off until `AUTOPILOT_ANCHOR_PRIVATE_KEY` is set.

## Public API

Everything under `/v1/autopilot` is unauthenticated — the transparency is the
product.

| Endpoint | Returns |
|---|---|
| `GET /v1/autopilot` | Every agent with live equity, deployed capital, P&L |
| `GET /v1/autopilot/:slug` | Agent detail: mode, rules, book, last 10 cycles |
| `GET /v1/autopilot/:slug/decisions` | Decision feed, refusals included |
| `GET /v1/autopilot/:slug/positions?status=open\|closed` | The book |
| `GET /v1/autopilot/:slug/journal` | Narrative log |
| `GET /v1/autopilot/decisions/:id` | One decision (nonce + thesis only once revealed) |
| `GET /v1/autopilot/decisions/:id/verify` | Recomputed commitment, plus instructions to redo the check yourself |

Admin control needs `X-Admin-Key`:

| Endpoint | Effect |
|---|---|
| `POST /admin/autopilot` | Create an agent (always paused; live mode needs `confirm_live: true`) |
| `POST /admin/autopilot/:slug/run` | Run one cycle now |
| `POST /admin/autopilot/:slug/status` | `active` / `paused` / `stopped` |
| `PATCH /admin/autopilot/:slug/rules` | Merge rule overrides |

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `AUTOPILOT_CYCLE_MINUTES` | `0` | Minutes between scheduled cycles. `0` disables the scheduler entirely. |
| `AUTOPILOT_ANCHOR_PRIVATE_KEY` | unset | Anchoring key. Unset = commitments are stored but not witnessed on-chain. |
| `AUTOPILOT_ANCHOR_CHAIN` | `base` | `base`, `arbitrum` or `optimism`. |
| `ANTHROPIC_API_KEY` | unset | Required for agents whose `thesis_engine` is `llm`. |
| `AUTOPILOT_LLM_MODEL` / `_EFFORT` / `_MAX_CALLS` | `claude-opus-5` / `low` / `8` | Model, reasoning depth, and the per-cycle call ceiling. |
| `AUTOPILOT_API_BASE_URL` | `https://api.suwappu.bot` | Where `ManagedExecutor` sends live quotes and executions. |
| `AUTOPILOT_AGENT_API_KEY` | unset | Agent API key for live execution. Without it, live mode refuses to run. |
| `INTERNAL_API_URL` / `INTERNAL_API_KEY` | — | Used for `POST /internal/token-security`. Without them, every entry fails `security_scan_present`. |

Three independent switches have to be thrown before real money moves: the
scheduler interval, the agent's `active` status, and `mode: "live"` with a
configured API key. That is intentional.

## Running one

```bash
# 1. Create it (paused, paper)
curl -X POST https://api.suwappu.bot/admin/autopilot \
  -H "X-Admin-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"slug":"suwappu-alpha","name":"Suwappu Alpha","chain":"base",
       "base_token":"USDC","starting_equity_usd":1000,
       "rules":{"maxPositionUsd":50,"requireLpLocked":false}}'

# 2. Activate and run a cycle by hand
curl -X POST .../admin/autopilot/suwappu-alpha/status -d '{"status":"active"}' ...
curl -X POST .../admin/autopilot/suwappu-alpha/run ...

# 3. Read what it did — and what it refused
curl https://api.suwappu.bot/v1/autopilot/suwappu-alpha/decisions | jq
curl https://api.suwappu.bot/v1/autopilot/decisions/1/verify | jq
```

Go live only after a paper agent has run long enough to show its refusals are
sane, then create a *separate* live agent with a funded managed wallet. Do not
flip a paper agent's mode: its equity history is paper history, and mixing the
two makes the published P&L a lie.

## The canonical form is a spec, not an implementation detail

Object keys sort lexicographically, no whitespace, and **strings are raw UTF-8
with only JSON-required escapes** — non-ASCII is *not* `\uXXXX`-escaped.

That last clause is load-bearing. Python's `json.dumps` escapes non-ASCII by
default and Go's `encoding/json` escapes HTML characters, so an idiomatic
verifier in either language computes a different digest from identical data —
and a single em dash in a thesis is enough to trigger it. Verifying a live
decision with a naive Python checker returned MISMATCH on honest data, which is
the worst failure a transparency claim can have: it is indistinguishable from a
forgery. Python needs `json.dumps(..., ensure_ascii=False)`; Go needs an Encoder
with `SetEscapeHTML(false)`.

`GET /v1/autopilot/decisions/:id/verify` therefore publishes `preimage` — the
exact byte string that was hashed — so a verifier whose digest differs can diff
the bytes instead of concluding the worst. `sha256(preimage)` must equal the
commitment, in any language, with no canonicalisation of your own.

## Dry run

`bun run scripts/autopilot-dryrun.ts` exercises read → think → gate → seal
against the live market, touching no database and executing nothing. It prints
every thesis, every refusal with the rule that caused it, and whether the seal
verifies. `--pairs snapshot.json` replays a saved DexScreener pair array
instead, which makes a run reproducible and works without outbound access to
the screener.

A representative run on a live snapshot: 15 candidates read, 1 thesis formed
(wrapped SOL on Base, turnover 5.03x on $876k depth, confidence 0.638, size
$63.75), refused at `security_scan_present` because `INTERNAL_API_KEY` was
unset. That refusal is the system working — the scan was unavailable, so the
trade did not happen.

Note what the same run says about the boosted feed alone: every boosted token in
that snapshot scored below the floor, mostly on 20–90x daily turnover against
$20–100k of depth. Paid placement and tradeable depth are not the same thing,
which is why discovery does not rely on it.

## What is deliberately not here yet

- **Solana anchoring.** The EVM memo path is implemented; a Solana Memo-program
  anchor is not. A Solana-chain agent runs unanchored today.
- **EVM buy/sell tax simulation.** `POST /internal/token-security` runs the
  honeypot round-trip on Solana only; on EVM the tax fields come back unset,
  which is why an EVM agent's published rules should set `requireLpLocked: false`
  explicitly rather than pretending we checked.
- **No live-money run.** Every cycle so far has executed against the paper
  executor. The managed execution path is wired to our own agent API and covered
  by tests, but it has not moved real funds.
- **Holder concentration can read above 100%.** The Base scan reported `top
  holders 101.5%` for one token, because a "holder" in that list can be the pool
  or router and balances get double-counted. The gate refuses on it, which is
  the safe direction, but the number itself should be treated as a smell rather
  than a measurement until the Python side excludes contract holders.

## Running on dev

Deployed and live: `https://api-ts-dev.up.railway.app/v1/autopilot`. The agent
`suwappu-alpha` is a paper agent on Base with $1,000 of paper capital, seeded by
`AUTOPILOT_BOOTSTRAP` and running a cycle every five minutes.

## Watching it

`/autopilot` on the showcase site renders the live agent: equity, P&L, positions
and the decision feed, refusals included, each expandable to its thesis, its
rule-by-rule gate verdict, its commitment and its anchor. It reads the same
public API anyone else can.

## Local development

`bun run scripts/autopilot-demo-server.ts` runs the real cycle against an
ephemeral in-process Postgres and serves the public read API from it — no
database, no API key, no wallet. Nothing it serves is fixture data. Point the
showcase at it with `NEXT_PUBLIC_API_URL=http://localhost:3200` to develop the
dashboard against decisions the real loop produced.
