# Build a Standalone Recurring DCA Product

Build a fixed-dollar recurring purchase workflow without letting cron, retries, or process restarts create accidental extra economic actions.

The public [`suwappu-dca-bot`](https://github.com/0xSoftBoi/suwappu-dca-bot) v2 is the maintained standalone reference. It is **preview-only by default** and intentionally narrow: each plan spends a fixed amount of USDC on a chosen cadence, with an explicit gas ceiling and an outcome-safe managed-execution path. V2 also enforces one local journal writer, bounded/sanitized API operations, scheduler overlap protection, and a release/container contract.

This is an integration and product reference, not evidence that dollar-cost averaging is profitable. The useful thing to copy is the recurring-intent boundary: **one scheduled wall-clock slot becomes at most one durable economic action, and the next installment does not outrun an unresolved prior one**.

## What DCA means in this reference

“Buy some token every so often” leaves important accounting and retry questions unanswered. The reference makes those choices explicit:

| Question | Reference contract |
|----------|--------------------|
| What is the budget unit? | USDC only, so each plan/action has fixed-dollar accounting |
| What identifies the plan? | Stable caller-defined plan ID |
| What identifies one installment? | Plan ID + local wall-clock schedule slot |
| What happens if DST repeats an hour? | Both callbacks map to the same slot/action key |
| What if a callback starts late? | The scheduler's intended instant—not delayed callback wall time—owns slot identity |
| What if two local workers use one state directory? | The second writer fails closed on `execution.lock` |
| What happens if the worker was offline? | Missed slots are skipped; there is no automatic catch-up buying loop |
| What if the previous action is unresolved? | Reconcile/recover it and skip the new installment |
| What permits managed execution? | Fresh route + cost guard + `would_execute: true` + explicit live gates |
| What proves success? | Reconciled swap status and final amounts, not submission |
| What can operators inspect without credentials? | Plan `status` and plain `history`; both are local-only |

Those are reference-product constraints, not global restrictions on the Suwappu API. If your product needs arbitrary source assets, faster strategy loops, or catch-up behavior, model their units and failure semantics explicitly rather than silently changing this contract.

## The recurring-action state machine

Treat the schedule callback as a request to inspect durable state, not as permission to buy:

```text
plan + local wall-clock slot
  -> durable action identity
  -> preview: fresh quote -> amount / pair / gas / quote-TTL guard
              -> journal preview -> STOP
     OR managed: persist prepared economic intent + stable Idempotency-Key
  -> fresh wallet-aware quote
  -> amount / pair / gas / quote-TTL guard
  -> simulation (`would_execute === true`)
  -> re-check quote TTL after simulation
  -> persist `submitting`
  -> POST /v1/agent/swap/execute with the intent's Idempotency-Key
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

mkdir -p ~/.suwappu-dca
cp examples/dca-config.example.json ~/.suwappu-dca/config.json

# Local validation: no API key and no network request.
bun src/index.ts status

curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-dca-product"}'

export SUWAPPU_API_KEY=suwappu_sk_...

# Every due action obtains a real route preview, but cannot submit.
bun src/index.ts start
```

Keep API credentials in environment/secret management. The reference deliberately does not read an API key from the plan file. `status` and plain `history` remain usable without credentials; `start`, `run-once`, and `history --reconcile` require a key because those modes can make Suwappu network requests.

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

V2 pins node-cron 4.6, enables its per-task `noOverlap` guard, and computes the durable action key from the scheduler context's intended `date`. That matters when the event loop is delayed across a minute boundary: callback start time must not silently turn one scheduled installment into another slot. The application-level journal lock/idempotency state remains necessary; scheduler overlap prevention is not a substitute for financial exactly-once semantics.

For example, consider a separate `dst-eth` plan scheduled with `30 1 * * *`. During the US daylight-saving fallback, both occurrences of that plan's local 01:30 resolve to the same slot identity:

```text
plan: dst-eth
schedule: 30 1 * * *
timezone: America/New_York
local slot: 2026-11-01 01:30
action: schedule.20261101T0130
```

The bot therefore cannot interpret the repeated wall-clock minute as “buy twice.” It also does not backfill a slot missed while the service was offline. If you add catch-up, make it an explicit customer policy with its own budget and deduplication rules.

For the scheduler's current timezone/DST and overlap behavior, see the upstream [node-cron timezone/DST](https://www.nodecron.com/timezones-and-dst.html) and [scheduling options](https://www.nodecron.com/scheduling-options.html) documentation. Keep Suwappu's economic-action identity above that scheduler layer so a future scheduler change does not redefine customer intent.

## 2. Spend quote calls only when a slot is due

A time-based DCA product does not need continuous price polling. When a new slot is eligible, request the route for the actual fixed-USDC amount and chain.

The reference fails closed unless the quote:

- returns `success: true`, a non-empty quote ID, the requested token pair, and the requested input amount;
- has valid optimistic and minimum outputs with `amount_out_min <= amount_out`;
- includes a usable `estimated_gas_usd` at or below the plan's `maxGasUsd`;
- has more than five seconds of useful TTL remaining.

It also applies `SUWAPPU_MAX_DCA_USDC` as an independent client-side per-action ceiling (default `1000`). Treat that as defense in depth; use restrictive [managed-wallet policies](managed-wallets.md) as the server-side control.

Preview mode stops here and records the route context. That is already enough to build a useful calendar, notification, or approval product without moving capital.

## 3. Simulation success is not execution permission

Managed execution requires a wallet-bound quote and `POST /v1/agent/swap/simulate`. The permission bit is specifically:

```ts
if (simulation.would_execute !== true) {
  return { action: 'blocked', warnings: simulation.warnings ?? [] }
}
```

An HTTP-successful simulation can still return `would_execute: false` because a balance, gas, wallet-policy, or other safety check failed. Do not substitute `response.ok` or a top-level `success: true` for that decision.

V2 also requires simulation `success: true` **and the same `quote_id` that was requested**. After a permitted simulation, it re-checks the route expiry and refuses submission when five seconds or less remain. That prevents a slow simulation from promoting a quote that was fresh when fetched but is already expiring at the side-effect boundary.

The public scheduler also requires both of these independent opt-ins:

```text
--execute
SUWAPPU_ALLOW_MANAGED_EXECUTION=1
```

Managed mode additionally needs `SUWAPPU_WALLET_ADDRESS`. Merely having credentials, a wallet, or an enabled plan never grants live authority.

## 4. Persist the economic intent before the risky request

For `/v1/agent/swap/execute`, `Idempotency-Key` identifies the **economic action**, not one HTTP attempt. V2 persists a new managed action in `prepared` **before** obtaining the quote, then keeps that same intent through quote, simulation, submission, and reconciliation. Before the first request that can move money:

1. persist the plan ID, slot/action key, chain, assets, and source amount;
2. persist a stable idempotency key for that intent;
3. obtain the wallet-aware quote, apply amount/pair/gas/TTL guards, simulate, and re-check TTL;
4. durably record `submitting`;
5. send that same key on `POST /v1/agent/swap/execute`;
6. require a valid `success: true` / non-empty swap-ID/status response before treating the submission as known;
7. retain the intent/key across restarts and ambiguous responses.

The managed API accepts caller-owned idempotency keys of 1–64 characters using letters, digits, `_`, `.`, `:`, and `-`. Never derive a retry key from the current timestamp.

The reference journal uses these phases:

```text
preview -> prepared -> submitting -> submitted -> completed / failed
                                 \
                                  -> outcome_unknown
```

Terminal state is monotonic: a late stale `pending` response cannot overwrite an already recorded terminal result.

## 5. Let an ambiguous action own the next slot

A transport failure, timeout, HTTP 408/5xx, or malformed successful response after `/v1/agent/swap/execute` does **not** prove that nothing happened. The request may have crossed the side-effect boundary before the response disappeared. V2 records these as `outcome_unknown` and does not copy upstream HTTP response bodies into request errors/logs.

The reference records `outcome_unknown` and uses two recovery paths:

- known swap ID: poll that swap; never submit a replacement action;
- no swap ID: keep the original economic terms and idempotency key, obtain a fresh same-terms quote/simulation, and retry with the **same** key.

If the next cron slot arrives while the previous plan action is `prepared`, `submitting`, `submitted`, or `outcome_unknown`, the unresolved action wins. The new installment is skipped while recovery/reconciliation proceeds.

That conservative rule is the key recurring-automation invariant: “the clock ticked again” is never a reason to invent a second economic action.

## 6. Reconcile final outcomes before accounting

Submission is not a fill. Poll `GET /v1/agent/swap/status/:id` or use [webhooks](webhook-setup.md), then keep quoted and final amounts separate. The v2 adapter requires `success: true`, a non-empty status, and a returned `swap_id` that exactly matches the requested ID before it trusts a status response.

The reference provides read-only operational commands:

```bash
bun src/index.ts history
bun src/index.ts history --reconcile
```

`history --reconcile` polls known swap IDs only; it cannot quote or submit. A completed swap that is still missing final amounts remains eligible for reconciliation so customer reporting can converge on the actual result.

By default, the example journal lives at `~/.suwappu-dca/execution-journal.json`. V2 makes the single-owner assumption enforceable: `start`, `run-once`, and `history --reconcile` acquire `execution.lock`; a second local writer fails closed. The state directory is forced to mode `0700`, journal/lock files to `0600`, and journal replacement uses a unique temporary file, file `fsync`, atomic rename, and best-effort directory `fsync`.

A stale lock is deliberately **not** auto-deleted. Stop supervisors, inspect its recorded PID/acquisition time, prove the owner is gone, preserve state as incident evidence, and only then clear that proven-stale lock. Do not point multiple hosts at this directory and call the file lock distributed consensus.

`SUWAPPU_DCA_JOURNAL_LIMIT` defaults to `5000` as a soft target. Only preview-only evidence is eligible for automatic pruning; failed, completed, and unresolved execution/idempotency records remain even if that means exceeding the target. Move plan/action state into transactional durable storage before horizontal scale.

### Bound network work and emit safe operational metadata

Every Suwappu operation defaults to a 25-second deadline and can be configured from 100–30,000ms with `SUWAPPU_OPERATION_TIMEOUT_MS`. Invalid timeout configuration is rejected before the scheduler acquires its writer lock or makes an API request.

Set `SUWAPPU_API_EVENTS=1` for stderr records such as:

```text
suwappu_api_event {"operation":"quote","outcome":"response_ok","duration_ms":184.2,"status":200}
```

Events contain only operation, transport/protocol outcome, duration, and optional HTTP status. They exclude keys, wallet/market terms, quote/swap IDs, bodies, and error text. `response_ok` means the adapter received parseable JSON at that layer; it is not proof of valid strategy economics or terminal execution.

The supplied image runs non-root with durable `/data`. Its default command validates the included plan **without an API key or network call and exits**. `docker-compose.yml` uses `restart: "no"`; scheduling—and especially managed scheduling—must be an explicit operator choice rather than a hidden restart-loop side effect.

## Intentionally enable bounded managed execution

Once a plan has been validated in preview and the customer has deliberately granted the right scope:

```bash
export SUWAPPU_WALLET_ADDRESS=0x...
export SUWAPPU_ALLOW_MANAGED_EXECUTION=1
export SUWAPPU_MAX_DCA_USDC=100

bun src/index.ts start --execute
```

Keep independent wallet policies, period budgets, alerts, and an operator kill switch around any unattended capital.

## Choose REST, SDK, or MCP by authority—not by name

The same builder can use several Suwappu interfaces, but their custody boundaries are not interchangeable:

| Interface | Good fit for DCA | Money-moving boundary |
|-----------|------------------|-----------------------|
| REST | Exact v2 reference contract and lowest dependency surface | `POST /v1/agent/swap/execute` is managed sign/broadcast; `POST /v1/agent/swap` is unsigned self-custody preparation |
| TypeScript/Python SDK | Typed application integration | TypeScript `executeManagedSwap()` / Python `execute_managed_swap()` are managed; `prepareSwap()` / `prepare_swap()` remain unsigned |
| Hosted MCP | Agent discovery, quote/simulation/research workflows | Historical MCP `execute_swap` **prepares an unsigned self-custody transaction; it does not managed-broadcast** |

At this v2 sync (2026-08-07), the TypeScript SDK source in this repository is `0.6.0`, while the public npm registry resolves `@suwappu/sdk` to `0.4.0`. Re-check `npm view @suwappu/sdk version` when you build and treat your installed package's exports as authoritative. If an API exists in source but not your published SDK, use the documented REST contract rather than pasting a source-only helper into production.

SDK convenience methods do not replace the plan/slot identity, durable intent, idempotency, or reconciliation state machine. Hosted MCP is at `/mcp`; discover current tools with `tools/list` instead of hard-coding a count. If MCP research leads to Suwappu-managed execution, cross that authority boundary explicitly through managed REST/SDK execution and keep the economic intent in your application.

## Turn the integration into a product people pay for

A cron expression is a commodity. Reliable recurring intent, approvals, explanations, and auditability can be a product.

| Product stage | Customer value | Example paid fence | Capital moves? |
|---------------|----------------|--------------------|----------------|
| Plan + preview | Budget/calendar plus real route and cost visibility | saved-plan count, history, alert destinations | No |
| Approval workflow | “Ready to buy” context with one review step | team seats, roles, approvals, audit retention | Only after approval |
| Bounded automation | Recurring execution within customer limits | intentionally enabled automations, reconciliation/support tier | Yes |
| Team / treasury | Shared recurring purchasing with accountability | SSO/RBAC, shared budgets, exports, control/reporting tier | Yes |

Validate retention before taking on more execution risk. For the preview-first product, a useful activation event is **saved plan -> first route-qualified scheduled preview**. Track a separate managed milestone—**explicitly opted-in plan -> first terminal reconciled action**—instead of mixing money movement with signup/traffic metrics.

Useful funnel metrics include:

- plan created -> first route-qualified preview;
- scheduled slots by preview / blocked / completed / failed / outcome-unknown;
- gas-ceiling and simulation block rates;
- approval-to-execution conversion, if approvals exist;
- time to terminal reconciliation;
- intentionally retained enabled plans and retained paying customers;
- operator/support interventions per 100 scheduled actions.

Those metrics describe whether the workflow is valuable and reliable. They do not require the purchased token to rise in price.

Sell capability—more plans, alerts, approvals, durable history, automation, roles, exports, and support—not a “higher return” tier. The customer can value a workflow that behaves correctly even during a month when the acquired asset loses value.

## Model request economics before setting a price

DCA has a useful cost property: its API demand is naturally bounded by scheduled slots rather than an always-on market polling loop.

```text
preview slot ≈ 1 quote
managed slot ≈ 1 quote + 1 simulation + 1 execute + reconciliation reads
ambiguous recovery ≈ fresh same-terms quote + simulation + same-key retry
```

Turn those calls into a per-plan budget before deciding what “unlimited” means:

```text
monthly plan contribution margin
= allocated plan revenue
- (due previews × measured quote cost)
- (managed actions × measured simulate/execute cost)
- reconciliation reads
- allocated hosting/database/notification/support/payment cost
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
| Multi-order DCA execution lifecycle/controller architecture | No | [Hummingbot DCAExecutor](https://hummingbot.org/strategies/v2-strategies/executors/dcaexecutor/) / [Strategy V2](https://hummingbot.org/strategies/v2-strategies/) |
| DCA-style position adjustment inside a full strategy engine | No | [Freqtrade strategy callbacks](https://www.freqtrade.io/en/stable/strategy-callbacks/) |
| Backtesting, exits, drawdown, strategy P&L | No | Use a strategy/research framework plus [Strategy Lifecycle](strategy-lifecycle.md) |

Hummingbot's current Strategy V2 makes executors finite order-management units that can be orchestrated by controllers; its DCAExecutor is the natural graduation point when a recurring swap becomes multi-order lifecycle state. Freqtrade's position-adjustment documentation explicitly warns that loose re-entry logic can place extra entries very quickly. That is exactly why this repo should stay the small Suwappu action boundary rather than pretending to be either full framework.

## Enterprise graduation checklist

V2 gives one local process strong operating invariants; it is **not** a distributed multi-tenant control plane. Before selling hosted unattended execution as enterprise-ready:

- Put tenant + plan + slot intents in transactional storage with a uniqueness constraint; replace the local file lock with distributed serialization.
- Make reconciliation a durable job with bounded retry/backoff and alert on ambiguity age/reconciliation lag.
- Isolate each customer's API identity, state, secrets, wallet policy, and audit history; rotate credentials deliberately.
- Keep idempotency keys until every ambiguous action can no longer require recovery.
- Define plan-edit semantics: budget/asset/cadence changes should not rewrite an already-durable intent.
- Make missed-slot/catch-up behavior explicit and budgeted.
- Add tenant/period budgets, auditable live-mode changes, RBAC/SSO where needed, and re-approval for material scope changes.
- Show quoted and final amounts separately.
- Expose `outcome_unknown` to operators instead of hiding it as “failed.”
- Keep server-side wallet policies in addition to client caps.
- Alert on duplicate economic actions (target: zero), rate limits, timeout rates, simulation blocks, and stale locks/leases.
- Back up execution state and test restore/recovery before relying on unattended scheduling.
- Gate money-path releases on frozen dependencies, tests/build, dependency audit, container validation, code scanning, and explicit retry/idempotency review. The source v2 CI/CodeQL setup is a starting contract, not a substitute for your own production change controls.
- Keep builder margin and customer investment performance in separate ledgers.

The best first paid experiment is simple: offer preview-only fixed-USDC plans with route/cost notifications, measure retained use, add approvals for users who want a faster action loop, and offer bounded automation only to users who explicitly ask for it. The defensible value is not cron—it is trusted recurring intent with a provable outcome loop.

> Educational integration reference, not financial advice or a guarantee of investment returns. Automated execution can lose funds.
