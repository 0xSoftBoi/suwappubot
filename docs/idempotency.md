# Idempotency, retries, and unknown outcomes

**Audience:** SDK authors, agents, integrators, reviewers, and operators  
**Machine contract:** `GET https://api.suwappu.bot/v1/retry-contracts`  
**Repository authority:** `api-ts/retry-contracts.json`  

Money-moving infrastructure must assume that HTTP clients, gateways, RPCs, signing services, and
venues can fail **after** accepting work. A timeout is therefore not proof that nothing happened.

Suwappu classifies every audited externally reachable operation that can move funds, submit an
external order/transaction, change signing/custody authority, or activate paid value into one of
four retry classes.

## Retry classes

| Class | Meaning | Safe client behavior |
|---|---|---|
| `natural-identity` | The operation already carries an immutable external identity, such as a chain transaction hash or identical signed transaction bytes. | Retry only with the same identity. Never rebuild a new transaction/payment merely because the HTTP response was lost. |
| `explicit-idempotency-key` | The caller provides a durable operation identity. | Persist the key before the first attempt and reuse the exact same key for all retries of that intended operation. |
| `durable-operation-id` | A server-issued identity, such as a quote/execution ID, binds the operation. | Retry/reconcile with that same ID. Do not mint a replacement ID until the old operation is known not to have executed. |
| `unsafe-auto-retry` | The current implementation cannot prove duplicate effects are impossible after an ambiguous failure. | **Do not automatically retry.** Inspect the documented reconciliation surface first. These entries are parity blockers. |

The machine registry publishes the same-request, conflicting-reuse, concurrency, unknown-outcome,
and reconciliation contract for every audited write.

## Managed Agent swap

For `POST /v1/agent/swap/execute`, supply an `Idempotency-Key` and persist it before the first
request.

```http
POST /v1/agent/swap/execute
Authorization: Bearer ...
Idempotency-Key: order-2026-08-21-00042
Content-Type: application/json
```

If a timeout, connection error, or downstream 5xx occurs, treat the outcome as unknown. Do not
create a new key and fire a replacement swap. Reconcile the original operation/chain state first.
The managed execution path itself also treats these failures as unknown rather than assuming the
trade failed and refunding blindly.

## Payments and subscriptions

Agent topups and prepaid subscriptions use the source-chain payment transaction as their natural
identity. The shared consumed-payments ledger has a unique `(chain, tx_hash)` key, so one payment
cannot be redeemed twice or reused across multiple payment purposes.

If the HTTP response is lost after payment submission, retry/reconcile using the **same** chain
transaction. Do not send another payment simply to obtain another API response.

Recurring Spend Permission registration is currently classified `unsafe-auto-retry`: the signed
permission is meaningful authority, but the current `recurring_subscriptions` table does not yet
have a dedicated durable uniqueness key for that permission identity. Inspect billing/permission
state before retrying. This remains a parity blocker until uniqueness and concurrency tests land.

## Prediction market orders

`POST /v1/agent/predict/order` is currently `unsafe-auto-retry`.

Each request presently creates a fresh signed CLOB order salt and timestamp. Therefore, a blind
retry after a timeout can create a second distinct order. Inspect `GET /v1/agent/predict/orders`
and venue state before attempting another order. The same caution applies to ambiguous cancel
responses until duplicate-cancel behavior is contract-tested.

This is intentionally documented as a blocker rather than hidden behind generic “retry with
backoff” advice.

## Managed wallet and policy writes

Creating a managed wallet or a Turnkey policy changes custody/signing authority. These operations
are currently `unsafe-auto-retry` until Suwappu persists a durable operation identity around the
provider call. After an ambiguous failure, list wallets or policies first instead of blindly
creating another resource.

## Showcase public swap

`POST /public/swap/execute` supports an `idempotencyKey`, but it is currently optional. Callers that
omit it do not receive the same durable retry guarantee. Until the API requires or safely derives an
operation identity, omitted-key executions remain a parity blocker.

## Terminal swaps

The Terminal/Python managed swap path forwards `quoteId` to `SwapEngine` as the execution
`idempotency_key`. Preserve the same quote identity for retries.

External-wallet recording uses the chain transaction hash (`ext:<tx_hash>`) as its natural identity.
For Jito submission, retry only the **identical already-signed Solana transaction bytes**. Rebuilding
or re-signing creates a different transaction identity and is not a retry of the original attempt.

## Prepare-only operations

Unsigned transaction construction is not the same as fund movement. The current retry registry
explicitly excludes boundaries that only prepare or simulate actions, including Agent swap
prepare/simulate, rewards claim calldata preparation, the read-only staking surface, and current
smart-account prediction/configuration routes.

That exclusion is about execution authority, not importance: these endpoints still require normal
validation and security review.

## CI rule

`api-ts/scripts/check-retry-contracts.ts` validates the registry and high-risk implementation
markers. In particular, CI fails if:

- an `unsafe-auto-retry` entry is not marked as a parity blocker;
- a contract lacks duplicate/concurrency/unknown-outcome/reconciliation semantics;
- a source file disappears;
- managed Agent swap loses its idempotency or unknown-outcome markers;
- the global payment replay unique constraint disappears;
- known blocker implementations change without a fresh audit;
- Terminal quote-ID, tx-hash, or identical-signed-transaction identity markers disappear.

A green registry does **not** mean parity is complete. `summary.parity_blocked` remains true while
any audited operation is classified unsafe for automatic retry.

## Integration rule

The default money-path client rule is:

1. choose/persist the operation identity **before** the first effectful request;
2. reuse that identity for the same intended operation;
3. never reuse it for different economic/custody terms;
4. on an ambiguous outcome, reconcile before creating a new identity;
5. only automatically retry operations whose machine contract explicitly allows identity-preserving retry.

Generic retry middleware must not retry money-changing POST/DELETE requests merely because the
status is 5xx or the connection timed out.
