# Executing our Relay provider on a Base fork (2026-09-13)

Method: `anvil --fork-url https://mainnet.base.org --chain-id 8453` (Foundry 1.5.1), a fresh wallet created through our own `WalletService` (dev KMS), 1 ETH minted on the fork, 100 USDC transferred from Relay's solver inventory by impersonation, then `SwapEngine._get_relay_quote` (live API) and `SwapEngine._execute_relay_swap` (our executor, our signer, real RelayDepository bytecode and state). Script: `scripts/research/relay_fork_exec.py`. Raw result: `probe/fork-exec-result.json`.

What this proves: the transactions our code signs for a live Relay quote are valid against the real depository contract, in order, with the right events and balance moves. What it cannot prove: a destination fill (the deposit lands on a fork Relay does not watch).

## Results
| Case | Deposit tx status | Gas used | Target | Event | Balance effect | Wall time |
|---|---|---|---|---|---|---|
| 0.01 ETH Base → Arbitrum (native, one `deposit` step) | success | 24,812 | `0x4cD0…BC31` RelayDepository | `RelayNativeDeposit` emitted | 0.01 ETH escrowed | 0.8 s |
| 25 USDC Base → Arbitrum (`approve` then `deposit`) | success | 53,774 | RelayDepository | `RelayErc20Deposit` emitted | 25.000000 USDC moved to depository | 0.3 s |
| Residual USDC allowance to depository after the run | 0 | | | | approve was sized to the input and fully consumed | |

Live quotes at the time: native case out 0.0099905 ETH, min 0.0099405, fee $0.0238, gas $0.0015, ETA 1 s; USDC case out 24.973444, min 24.848577, fee $0.0266, gas $0.0035, ETA 1 s.

Note on ids: the `bytes32 id` in the deposit calldata and event is Relay's protocol **order id**, not the API `requestId` (see 09-protocol-features-kit.md, "For Apps"). Our poller tracks by `requestId`, which is what `/intents/status/v3` accepts.

## The defect this run found, and the fix
First attempt failed before signing:

```
SwapError: Relay: execution re-quote min-out (9940500373627420) is worse than the approved
min-out (9940500877255904). Aborting to protect against slippage/price movement...
```

The executor re-quoted at execution (the Across pattern) and the shared fail-closed guard compared the fresh guaranteed minimum against the approved one. Relay's solver price ticks every second, so the fresh minimum was lower by 5 parts per billion and the guard, correctly by its own rule, refused. In production that would have rejected most Relay executions. Unit tests could not see this because they mock the quote.

Fix (`swap_engine.py`, `_execute_relay_swap`): a Relay quote is an order. Its deposit calldata carries the order id and the solver is bound to the quoted `minimumAmount` (it refunds rather than under-fills). So while the approved quote is fresh (within `max(expires_in, 90 s)`), the executor signs exactly the steps the user saw, as Relay's own SDK does. Re-quoting with the strict guard remains the fallback for an expired quote or one that lost its steps in transit (agent/webapp rehydration). Every step-validation check still runs on the approved steps. Two tests cover the new branch; the fork run then passed on the first try.

## What was exercised end to end
- Our `RelayAPI.get_quote` → engine `SwapQuote` → step validation (origin chain id, approve target = input token, approve amount ≤ input, native value = input on native, zero on ERC-20, one final deposit step) → gas plan with 25% buffer → native balance check → `WalletService.sign_evm_transaction` → broadcast → approve receipt check → deposit broadcast → `request_id` recorded for the poller.
- Not exercised: `tx_poller` against a live fill (unit-tested with mocked statuses), non-EVM origins, gasless/permit steps.

## Reproduce
```
~/.foundry/bin/anvil --fork-url https://mainnet.base.org --chain-id 8453 --port 8545 --silent &
PYTHONPATH=. KMS_PROVIDER=dev TELEGRAM_BOT_TOKEN=x ENCRYPTION_KEY=$(python3 -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())") \
DATABASE_URL=sqlite:////tmp/relay_fork.db python3 scripts/research/relay_fork_exec.py
```
