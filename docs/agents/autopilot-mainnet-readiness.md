# Autopilot: mainnet readiness

Audit of the live-execution path, Aug 2026. Written before any live agent
exists, so that the decision to create one is made against a list rather than a
feeling.

**Current verdict: still NOT ready — but for one reason now, not six.**

Five of the six blockers below are **CLOSED** (marked inline). What remains is
B5: there is no track record. That one cannot be closed by writing code, and it
is why a date matters less than a trade count.

Nothing here is speculative — every blocker names the file and line that causes
it.

---

## [CLOSED] B1 — A broadcast swap that loses its response is money we stop tracking

**`executor.ts:198`** (`ManagedExecutor.execute`, the outer `catch`)

```ts
} catch (err) {
  return { ok: false, paper: false, quoteId, error: `execute request failed: ${err}` }
}
```

The POST to `/v1/agent/swap/execute` has a 30s timeout. If it times out, or the
connection drops, or our own API 502s **after** the swap has been broadcast, the
executor reports `ok: false`. `settleDecision` then marks the decision `failed`
(`AutopilotService.ts:~1240`) and no position is opened.

On paper this is free. On mainnet the tokens are bought, sitting in the wallet,
and the agent does not know. Its own accounting still shows the cash, so the
next cycle can spend it again. Nothing in the codebase ever reconciles a
`failed` decision against the chain — grep for `reconcil`, `orphan`, `pending`
returns nothing in this service.

The `Idempotency-Key` header (the decision's commitment) means a *retry* would
be deduplicated by our own API. The agent never retries.

**Fix**: a third terminal state. A failure that could not have broadcast
(quote rejected, gate refused, connection refused before send) is `failed`. A
failure that might have (timeout, 5xx, dropped connection after send) is
`unknown`, and an agent with any `unknown` decision must halt rather than trade
on an account balance it cannot vouch for.

## [CLOSED] B2 — A stop-loss that cannot fill is not a stop-loss

**`AutopilotService.ts:1093`**

```ts
} else {
  errors.push(`exit ${position.symbol}: ${result.error}`)
}
```

A failed sell logs and moves on. The next cycle re-attempts with the same
`rules.maxSlippageBps`. If the sell is failing *because* 150bps is too tight for
a market moving against us, it will keep failing on exactly the days it matters,
while the position runs past the stop it was supposed to enforce.

**Fix**: escalate. Widen the slippage allowance on each consecutive failed exit
attempt up to a hard ceiling, and alert loudly once a position has failed to
exit N times. An exit is the one action that must be allowed to pay to complete.

## [CLOSED] B3 — The loss halt only counts losses we have already taken

**`gates.ts:156`**

```ts
const lossHalt = -portfolio.realizedPnlTodayUsd >= rules.dailyLossHaltUsd
```

Only realized P&L. An agent whose open book is deeply underwater has realized
nothing, so the halt never fires and it keeps opening positions. This is the
ordinary way an automated strategy blows up: the losses are all unrealized right
up until they are not.

**Fix**: halt on realized **plus** unrealized, or on drawdown from peak equity.
Unrealized is already computed in `computeEquity`.

## [CLOSED] B4 — The money path is typed with `as never`

**`AutopilotService.ts:1089`** and the entry call site

```ts
} as never)
```

A cast that suppresses whatever the compiler was about to say, at the exact call
that spends money. It is there because `ExecutionRequest` and the executor's
extra fields were never unified. Whatever mismatch it hides is currently
invisible.

**Fix**: give `Executor.execute` one honest parameter type and delete both casts.

## [OPEN — the only one left] B5 — There is no track record

Zero closed trades. The panel shipped this session says so in as many words:
*"No closed trades yet. There is nothing here to evaluate."*

The Minimum Track Record Length statistic exists precisely to answer "is this
ready?" and its current answer is that we cannot yet distinguish this strategy
from luck — not because it is bad, but because it has produced no evidence
either way. Going live now means the first real money is also the first
evidence.

This is not a code blocker and cannot be fixed by writing code.

## [CLOSED] B6 — The live path has never run

`grep -l ManagedExecutor src/__tests__/` returns nothing. `PaperExecutor` has
tests pinning direction, fees and impact; `ManagedExecutor` has none. Its quote
parsing, its idempotency handling, its error branches and its `fillPriceUsd`
arithmetic (`amountUsd / toAmount`) have never been executed by anything.

**Fix**: test it against a mocked agent API covering the branches that matter —
quote failure, execute failure, the timeout-after-send case from B1, and a
successful fill — then one real testnet swap before any mainnet one.

---

## What is already right

Recorded so the review does not re-litigate them.

- **The autopilot owns no signing path.** Live execution goes through
  `/v1/agent/*` with an agent API key, so every existing money-path control —
  policy gate, spend limits, approvals, fee handling, idempotency — applies
  unchanged. This is the single most important design decision here.
- **Bootstrap cannot create a live agent** (`bootstrap.ts:54`). A live agent
  must be created deliberately, by a human, through the admin route.
- **Live mode fails closed** on a missing `AUTOPILOT_AGENT_API_KEY`
  (`AutopilotService.ts:727`) rather than silently falling back to paper.
- **A kill switch exists**: `POST /admin/autopilot/:slug/status` with `paused`
  or `stopped`, and `runCycle` refuses to run a non-active agent
  (`AutopilotService.ts:692`).
- **Exits are never blocked by exposure or liquidity rules** (`gates.ts`
  preamble). A risk system that can stop you selling is a bug.
- **Costs and slippage are modelled pessimistically** and published.

---

## Go-live gates

Ordered. Each is a gate, not a task — a later one does not start until the
earlier one holds.

| # | Gate | Closes |
|---|------|--------|
| 1 | ~~B1, B2, B3, B4 fixed~~ **done** — needs a money-path review by a human | code |
| 2 | ~~B6: ManagedExecutor covered~~ **done** (8 tests). Still needs one real testnet swap end to end | code |
| 3 | Paper agent runs unattended with the corrected accounting until MinTRL is met, or until it is clear the edge is negative | evidence |
| 4 | A human reads the reliability curve and decides whether stated confidence is worth sizing on | judgement |
| 5 | First live agent: smallest viable size, one chain, `maxOpenPositions: 1`, a daily loss halt that would not hurt to hit | judgement |

Gate 3 is the long one and cannot be shortened by working harder. Gates 4 and 5
are explicitly a person's call, not the agent's and not mine.
