# Build a Recurring DCA Product

Build a fixed-dollar recurring purchase workflow without letting cron, retries, or process restarts create accidental extra economic actions.

The public [`suwappu-dca-bot`](https://github.com/0xSoftBoi/suwappu-dca-bot) is the maintained reference. It is **preview-only by default** and intentionally narrow: each plan spends a fixed amount of USDC on a chosen cadence, with an explicit gas ceiling and an outcome-safe managed-execution path.

This is an integration and product reference, not evidence that dollar-cost averaging is profitable. The useful thing to copy is the recurring-intent boundary: **one scheduled wall-clock slot becomes at most one durable economic action, and the next installment does not outrun an unresolved prior one**.

## What DCA means in this reference

“Buy some token every so often” leaves important accounting and retry questions unanswered. The reference makes those choices explicit:

| Question | Reference contract |
|----------|--------------------|
| What is the budget unit? | USDC only, so each plan/action has fixed-dollar accounting |
| What identifies the plan? | Stable caller-defined plan ID |
| What identifies one installment? | Plan ID + local wall-clock schedule slot |
| What happens if DST repeats an hour? | Both callbacks map to the same slot/action key |
| What happens if the worker was offline? | Missed slots are skipped; there is no automatic catch-up buying loop |
| What if the previous action is unresolved? | Reconcile/recover it and skip the new installment |
| What permits managed execution? | Fresh route + cost guard + `would_execute: true` + explicit live gates |
| What proves success? | Reconciled swap status and final amounts, not submission |

Those are reference-product constraints, not global restrictions on the Suwappu API. If your product needs arbitrary source assets, faster strategy loops, or catch-up behavior, model their units and failure semantics explicitly rather than silently changing this contract.

## The recurring-action state machine

Treat the schedule callback as a request to inspect durable state, not as permission to buy:

```text
plan + local wall-clock slot
  -> durable action identity
  -> fresh wallet-aware quote
  -> amount / gas / quote-TTL guard
  -> preview STOP
     or
  -> simulation (`would_execute === true`)
  -> persist intent + `submitting`
  -> POST /swap/execute with the intent's Idempotency-Key
  -> submitted / outcome_unknown
  -> status reconciliation
  -> completed / failed + final amounts
  -> only then is the plan free for another economic action
```

The distinction between **scheduled**, **submitted**, and **completed** is what makes this suitable as a base for a real automation product rather than a cron demo.

## Run the reference in preview mode

The repository requires Bun 1.3.14 or newer:

```bash
git clone https://github.com/0xSoftBoi/suwappu-dca-bot.git
cd suwappu-dca-bot
bun install --frozen-lockfile

curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-dca-product"}'

export SUWAPPU_API_KEY=suwappu_sk_...

mkdir -p ~/.suwappu-dca
cp examples/dca-config.example.json ~/.suwappu-dca/config.json

# Every due action obtains a real route preview, but cannot submit.
bun src/index.ts start
```

Keep API credentials in environment/secret management. The reference deliberately does not read an API key from the plan file.

## 1. Make the plan and slot stable

A plan looks like this:

```json
{
  "id": "daily-eth",
  "name": "Daily ETH",
  "fromToken": "USDC",
  "toToken": "ETH",
  "amount": 50,
  "chain": "base",
  "schedule": "0 9 * * *",
  "timezone": "America/New_York",
  "maxGasUsd": 2
}
```

The ID is durable business state. Do not derive it from an array index or regenerate it on deploy.

The reference accepts five-field cron with one literal minute (`0`–`59`), so each plan runs no faster than hourly. Timezone defaults to UTC and otherwise must be a valid IANA timezone. That cap is intentional for a recurring-purchase reference; a high-frequency strategy belongs in a different scheduler/execution design.

For example, consider a separate `dst-eth` plan scheduled with `30 1 * * *`. During the US daylight-saving fallback, both occurrences of that plan's local 01:30 resolve to the same slot identity:

```text
plan: dst-eth
schedule: 30 1 * * *
timezone: America/New_York
local slot: 2026-11-01 01:30
action: schedule.20261101T0130
```

The bot therefore cannot interpret the repeated wall-clock minute as “buy twice.” It also does not backfill a slot missed while the service was offline. If you add catch-up, make it an explicit customer policy with its own budget and deduplication rules.

## 2. Spend quote calls only when a slot is due

A time-based DCA product does not need continuous price polling. When a new slot is eligible, request the route for the actual fixed-USDC amount and chain.

The reference fails closed unless the quote:

- matches the requested input amount and assets;
- has valid optimistic and minimum outputs with `amount_out_min <= amount_out`;
- includes a usable `estimated_gas_usd` at or below the plan's `maxGasUsd`;
- has more than five seconds of useful TTL remaining.

It also applies `SUWAPPU_MAX_DCA_USDC` as an independent client-side per-action ceiling (default `1000`). Treat that as defense in depth; use restrictive [managed-wallet policies](managed-wallets.md) as the server-side control.

Preview mode stops here and records the route context. That is already enough to build a useful calendar, notification, or approval product without moving capital.

## 3. Simulation success is not execution permission

Managed execution requires a wallet-bound quote and `POST /swap/simulate`. The permission bit is specifically:

```ts
if (simulation.would_execute !== true) {
  return { action: 'blocked', warnings: simulation.warnings ?? [] }
}
```

An HTTP-successful simulation can still return `would_execute: false` because a balance, gas, wallet-policy, or other safety check failed. Do not substitute `response.ok` or a top-level `success: true` for that decision.

The public scheduler also requires both of these independent opt-ins:

```text
--execute
SUWAPPU_ALLOW_MANAGED_EXECUTION=1
```

Managed mode additionally needs `SUWAPPU_WALLET_ADDRESS`. Merely having credentials, a wallet, or an enabled plan never grants live authority.

## 4. Persist the economic intent before the risky request

For `/swap/execute`, `Idempotency-Key` identifies the **economic action**, not one HTTP attempt. Before the first request that can move money:

1. persist the plan ID, slot/action key, chain, assets, and source amount;
2. persist a stable idempotency key for that intent;
3. durably record `submitting`;
4. send that same key on `POST /swap/execute`;
5. retain it across restarts and ambiguous responses.

The managed API accepts caller-owned idempotency keys of 1–64 characters using letters, digits, `_`, `.`, `:`, and `-`. Never derive a retry key from the current timestamp.

The reference journal uses these phases:

```text
preview -> prepared -> submitting -> submitted -> completed / failed
                                 \
                                  -> outcome_unknown
```

Terminal state is monotonic: a late stale `pending` response cannot overwrite an already recorded terminal result.

## 5. Let an ambiguous action own the next slot

A timeout or lost response after `/swap/execute` does **not** prove that nothing happened. The request may have crossed the side-effect boundary before the response disappeared.

The reference records `outcome_unknown` and uses two recovery paths:

- known swap ID: poll that swap; never submit a replacement action;
- no swap ID: keep the original economic terms and idempotency key, obtain a fresh same-terms quote/simulation, and retry with the **same** key.

If the next cron slot arrives while the previous plan action is `prepared`, `submitting`, `submitted`, or `outcome_unknown`, the unresolved action wins. The new installment is skipped while recovery/reconciliation proceeds.

That conservative rule is the key recurring-automation invariant: “the clock ticked again” is never a reason to invent a second economic action.

## 6. Reconcile final outcomes before accounting

Submission is not a fill. Poll `GET /v1/agent/swap/status/:id` or use [webhooks](webhook-setup.md), then keep quoted and final amounts separate.

The reference provides read-only operational commands:

```bash
bun src/index.ts history
bun src/index.ts history --reconcile
```

`history --reconcile` polls known swap IDs only; it cannot quote or submit. A completed swap that is still missing final amounts remains eligible for reconciliation so customer reporting can converge on the actual result.

By default, the example journal lives at `~/.suwappu-dca/execution-journal.json`. It assumes **one process owns the state directory**. Do not share that JSON file among replicas; move plan/action state into transactional durable storage before horizontal scale.

## Intentionally enable bounded managed execution

Once a plan has been validated in preview and the customer has deliberately granted the right scope:

```bash
export SUWAPPU_WALLET_ADDRESS=0x...
export SUWAPPU_ALLOW_MANAGED_EXECUTION=1
export SUWAPPU_MAX_DCA_USDC=100

bun src/index.ts start --execute
```

Keep independent wallet policies, period budgets, alerts, and an operator kill switch around any unattended capital.

## Turn the integration into a product people pay for

A cron expression is a commodity. Reliable recurring intent, approvals, explanations, and auditability can be a product.

| Product stage | Customer value | Capital moves? | What you add |
|---------------|----------------|----------------|--------------|
| Plan + preview | Budget/calendar plus real route and cost visibility | No | plan UI, notifications, route history |
| Approval workflow | “Ready to buy” context with one review step | Only after approval | roles, approvals, audit trail |
| Bounded automation | Recurring execution within customer limits | Yes | durable state, policies, reconciliation, alerts |
| Team / treasury | Shared recurring purchasing with accountability | Yes | tenant isolation, RBAC, budgets, exports, controls |

Validate retention before taking on more execution risk. Useful funnel metrics include:

- plan created -> first route-qualified preview;
- scheduled slots by preview / blocked / completed / failed / outcome-unknown;
- gas-ceiling and simulation block rates;
- approval-to-execution conversion, if approvals exist;
- time to terminal reconciliation;
- intentionally retained enabled plans and retained paying customers;
- operator/support interventions per 100 scheduled actions.

Those metrics describe whether the workflow is valuable and reliable. They do not require the purchased token to rise in price.

## Model request economics before setting a price

DCA has a useful cost property: its API demand is naturally bounded by scheduled slots rather than an always-on market polling loop.

```text
preview slot ≈ 1 quote
managed slot ≈ 1 quote + 1 simulation + 1 execute + reconciliation reads
ambiguous recovery ≈ fresh same-terms quote + simulation + same-key retry
```

Use current [Pricing](../billing/pricing.md) and [Rate Limits](../authentication/rate-limits.md) when you build the unit model; do not copy a point-in-time price into a long-lived business assumption.

Keep two scoreboards:

```text
builder contribution margin
= customer subscription / usage revenue
- Suwappu + infrastructure + notification/model + support/payment costs

customer investment result
= realized / marked value of acquired inventory
- acquisition and execution costs
```

Customer investment performance is not your builder revenue, and an optimistic quote is not customer profit. The Agent API does not currently promise a generic third-party `builder_fee`; charge for your product through an explicit customer billing contract unless a documented attribution surface applies. See [Build a Business on Suwappu](build-a-business.md).

## Know where this reference stops

Suwappu is the financial action plane here; this repository is deliberately smaller than a full trading engine.

| Need | Suwappu DCA reference | Deeper benchmark |
|------|-----------------------|------------------|
| One fixed-USDC recurring action with safe retry/recovery | Yes | This reference |
| Multi-order DCA execution lifecycle/controller architecture | No | [Hummingbot DCAExecutor](https://hummingbot.org/strategies/v2-strategies/executors/dcaexecutor/) |
| DCA-style position adjustment inside a full strategy engine | No | [Freqtrade strategy callbacks](https://www.freqtrade.io/en/stable/strategy-callbacks/) |
| Backtesting, exits, drawdown, strategy P&L | No | Use a strategy/research framework plus [Strategy Lifecycle](strategy-lifecycle.md) |

Freqtrade's own position-adjustment documentation explicitly warns that loose re-entry logic can place extra entries very quickly. That is exactly why recurring intent needs stable identity and explicit limits even when the surrounding strategy framework changes.

## Production checklist before multi-tenant automation

- Put tenant + plan + slot intents in transactional storage with a uniqueness constraint.
- Serialize conflicting economic actions and make reconciliation a durable background job.
- Isolate each customer's API identity, state, policies, and audit history.
- Keep idempotency keys until every ambiguous action can no longer require recovery.
- Define plan-edit semantics: budget/asset/cadence changes should not rewrite an already-durable intent.
- Make missed-slot/catch-up behavior explicit and budgeted.
- Show quoted and final amounts separately.
- Expose `outcome_unknown` to operators instead of hiding it as “failed.”
- Keep server-side wallet policies in addition to client caps.
- Keep builder margin and customer investment performance in separate ledgers.

The best first paid experiment is simple: offer preview-only fixed-USDC plans with route/cost notifications, measure retained use, add approvals for users who want a faster action loop, and offer bounded automation only to users who explicitly ask for it. The defensible value is not cron—it is trusted recurring intent with a provable outcome loop.

> Educational integration reference, not financial advice or a guarantee of investment returns. Automated execution can lose funds.
