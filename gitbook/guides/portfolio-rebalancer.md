# Portfolio Rebalancer

Build a fixed-target treasury or portfolio workflow that is **preview-only by default** and moves funds only through an explicit, outcome-safe managed-wallet boundary.

The maintained reference is [`suwappu-portfolio-rebalancer`](https://github.com/0xSoftBoi/suwappu-portfolio-rebalancer). Its most reusable contract is not a particular 50/50 or 60/40 allocation. It is this state machine:

```text
managed portfolio -> normalized holdings -> policy/drift -> preview
                  -> explicit live opt-in -> quote -> simulate
                  -> persist intent -> submit -> reconcile
                  -> final amounts -> fresh portfolio
```

Use a separate research/optimizer layer to decide *what* the target allocation should be.

## Start with the maintained reference

Requirements: Bun 1.3+ and a Suwappu managed wallet.

```bash
git clone https://github.com/0xSoftBoi/suwappu-portfolio-rebalancer.git
cd suwappu-portfolio-rebalancer
bun install --frozen-lockfile

export SUWAPPU_API_KEY=suwappu_sk_...
export SUWAPPU_WALLET_ADDRESS=0xYourManagedWallet

# Read only.
bun src/index.ts check

# Deterministic plan only. No funds move.
bun src/index.ts rebalance
```

The portfolio endpoint only lets an agent read its own managed wallet. Create one if needed:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

`SUWAPPU_WALLET_ADDRESS` is an address, never a private key.

## Define the policy explicitly

The repository's default is an arbitrary educational policy: 50% ETH / 50% USDC on Base with a 5 percentage-point drift threshold.

For your product, store a versioned strategy file:

```json
{
  "allocations": {
    "ETH": 60,
    "USDC": 40
  },
  "threshold": 5,
  "chain": "base"
}
```

Targets must be non-negative and sum to 100. Discover chains/tokens instead of assuming that a symbol is tradable everywhere:

```bash
curl https://api.suwappu.bot/v1/agent/chains \
  -H "Authorization: Bearer $SUWAPPU_API_KEY"

curl "https://api.suwappu.bot/v1/agent/tokens?chain=base" \
  -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

## Normalize the whole portfolio before calculating drift

A target map and a wallet are two different things. The reference planner:

1. aggregates duplicate symbol rows case-insensitively;
2. includes every holding returned for the configured chain in total portfolio USD value;
3. surfaces a positive holding absent from the target map as `UNCONFIGURED`;
4. refuses to plan while a material (`>$0.01`) unconfigured holding lacks an explicit target; and
5. accepts an explicit `0%` target only when liquidation is genuinely intended.

That explicit-zero rule matters. A surprise token, airdrop, or manually held asset should not become a sell authorization merely because it was omitted from a JSON file.

After policy is complete, the threshold is a **trigger**. If no absolute drift exceeds it, do nothing. Once one asset breaches it, the reference planner pairs all positive/negative dollar gaps toward the configured weights.

For example, with a 5-point threshold:

```text
asset A: +10 points
asset B:  -5 points
asset C:  -5 points
```

Testing only for underweights strictly greater than five produces no counterpart for A. A useful planner instead recognizes that A's $10-point excess funds the two $5-point deficits after the rebalance has been triggered.

## Keep USD intent and token units separate

Portfolio drift is naturally expressed in USD. `POST /quote` expects **source-token units**.

If the plan says “sell $425 of ETH” and ETH is $3,400, the input is:

```text
425 / 3400 = 0.125 ETH
```

It is not `425 ETH`.

The satellite fetches the current source-token USD price and performs this conversion before requesting a quote. Missing, zero, negative, or non-finite prices fail closed.

## Treat simulation as a gate, not an API health check

For a live candidate:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/simulate \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id":"q_...","wallet_address":"0xYourManagedWallet"}'
```

Read `would_execute`.

An HTTP-successful response (and even a JSON `success: true`) can still have `would_execute: false` because a balance, gas, allowance, revert, or other blocking check failed. Do not submit merely because the simulation endpoint returned 200.

## Persist managed intent before submission

The money-moving contract is:

| State | What is known | Safe next action |
|-------|---------------|------------------|
| Policy decision | Portfolio is outside configured policy | Create/preview a candidate |
| Quote + simulation | Current route and preflight evidence | Still no fill/accounting |
| Durable intent | Economic terms + stable idempotency key are stored | Submission may begin |
| Submitted | `swap_id` is known but not terminal | Poll that swap; no replacement |
| Outcome unknown | Network/timeout/5xx may have hidden a side effect | Keep the same intent/key; reconcile/retry idempotently |
| Completed | Terminal status includes final amounts | Consume outcome once, then fetch fresh portfolio |
| Failed | Terminal failure proves this attempt did not complete | Re-plan from fresh state if still needed |

For managed execution, persist a server-compatible key **before** the HTTP request:

```ts
const intent = await intents.create({
  economicTerms,
  idempotencyKey: durableIntentId,
  phase: 'submitting',
})

const response = await fetch('https://api.suwappu.bot/v1/agent/swap/execute', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SUWAPPU_API_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': intent.idempotencyKey,
  },
  body: JSON.stringify({ quote_id: freshQuoteId }),
})
```

If the request times out, loses its connection, or returns a 5xx after submission may have started, do not create a new current-time ID. A fresh quote can still represent the **same economic intent**; reuse the persisted idempotency key.

## Reconcile before the next economic action

Poll a known swap:

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/4812 \
  -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

Only a terminal success with final `from_amount` / `to_amount` belongs in completed-trade accounting. A quote's expected output and an accepted submission are not fills.

The maintained reference exposes the local journal directly:

```bash
bun src/index.ts executions
bun src/index.ts executions --reconcile
```

`--reconcile` only polls known swap IDs; it never submits a trade.

For safety, the live reference executes at most **one reconciled economic action per invocation**. Run `rebalance --execute` again to read the new portfolio and calculate the next action from fresh state. This avoids blindly running the remainder of a plan computed before the first fill.

## Turn on live mode deliberately

After preview/paper evaluation and wallet policies are ready:

```bash
export MAX_REBALANCE_USD=100
bun src/index.ts rebalance --execute
```

The repository defaults `MAX_REBALANCE_USD` to `1000`; set a smaller value while developing. An invalid/negative cap fails closed. The local cap is defense in depth—use Suwappu wallet policies, approvals, audit history, and a kill switch for server-side limits.

The reference JSON execution journal lives under `~/.suwappu-rebalancer` by default. Run only one live process per state directory. A multi-worker service needs transactional state, an economic-intent uniqueness constraint, locking/leases, and an append-only audit trail.

## Know what this repo does not solve

This is a fixed-target Suwappu workflow reference, not a quantitative portfolio engine.

| Need | Use this guide/repo for | Look deeper at |
|------|-------------------------|----------------|
| Managed-wallet drift -> action lifecycle | Yes | — |
| Fixed targets and drift band | Yes | — |
| Mean/semivariance, Black-Litterman, HRP, optimizer constraints | No | [PyPortfolioOpt](https://pyportfolioopt.readthedocs.io/) |
| Full algorithm framework, portfolio-construction scheduling, brokerage/reality models | No | [LEAN](https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework/portfolio-construction/key-concepts) |
| Tax lots / tax-aware rebalancing | No | Add a dedicated accounting/optimization layer |
| LP/debt/staking positions outside `/portfolio` | No | Add product-specific position adapters |

A clean architecture is:

```text
research / optimizer -> versioned target policy
                     -> Suwappu preview/rebalancer
                     -> approval / managed execution
                     -> reconciled portfolio state
```

That lets you improve portfolio intelligence without weakening the custody/execution boundary.

## Build a product people pay for

Trading return is uncertain. Workflow value is measurable.

### Treasury drift monitor

Start read-only: saved policies, scheduled drift checks, alerts, history, exports, and reports. Charge for monitoring frequency, policy/wallet count, delivery channels, team workspaces, or reporting depth.

First metric: **does the customer return for another real drift report?**

### Approval workspace

Add deterministic plans, fresh quotes, simulations, team roles, comments, stored approvals, and audit history. You can sell this tier without granting a model or scheduler execution authority.

First metric: **do teams repeatedly review/approve/reject real policy breaches?**

### Managed automation

Only after the workflow retains users, add policy-bounded managed execution and reconciliation. Sell automation/operations capability, not a promise that the target allocation will make money.

Track execution quality: simulation blocks, submission-to-completion rate, outcome-unknown rate, reconciliation latency, partial-rebalance recovery, and duplicate economic actions (target: zero).

## Keep the two economics ledgers separate

Customer portfolio outcome:

```text
portfolio result
  = realized gains/losses + mark-to-market change
  - venue fees - gas/bridge costs - realized slippage
```

Your product economics:

```text
builder contribution margin
  = subscription + usage revenue
  - Suwappu/API cost
  - model/data-provider cost
  - hosting/database/queue/observability cost
  - notification + payment-processing cost
  - variable support/refund cost
```

Never use a customer's investment return as a substitute for your product revenue. See [Build a Business on Suwappu](build-a-business.md) and [Strategy Lifecycle](strategy-lifecycle.md).

## Production checklist

- Use the authenticated agent's managed wallet; do not accept an arbitrary observation address as execution authority.
- Version the target policy and validate weights, chain, and token universe.
- Require an explicit target before liquidating a positive unconfigured holding; treat dust deliberately rather than hiding it from reports.
- Keep preview as the default and make live mode a positive opt-in.
- Convert planned USD to source-token units before quoting.
- Require `would_execute=true` and show simulation warnings/checks.
- Persist intent/idempotency state before managed submission.
- Treat timeout/network/5xx failures as outcome-unknown.
- Poll known swaps instead of creating replacement economic actions.
- Consume terminal final amounts exactly once.
- Fetch a fresh portfolio before the next live action.
- Add server-side caps/policies, approvals, audit, and a kill switch.
- Backtest/walk-forward the allocation policy separately from execution plumbing.
- Keep customer portfolio P&L and builder revenue/cost in separate ledgers.

The durable execution implementation and regression tests live in the [portfolio rebalancer repository](https://github.com/0xSoftBoi/suwappu-portfolio-rebalancer). Copy the authority/finality boundary first; then attach the portfolio policy your users actually value.
