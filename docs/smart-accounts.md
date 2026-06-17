# ERC-4337 Smart Accounts

Suwappu can derive and (once enabled) transact through ERC-4337 smart accounts —
**ZeroDev Kernel v0.3.1** on **EntryPoint v0.7**, driven by the audited,
MIT-licensed [`permissionless.js`](https://github.com/pimlicolabs/permissionless.js)
+ [`viem`](https://viem.sh) stack. No account-abstraction crypto is hand-rolled.

Supported chains: Ethereum (1), Optimism (10), BNB (56), Polygon (137),
Base (8453), Arbitrum (42161).

## Architecture

```
Telegram bot  ──HTTP──▶  api-ts SmartAccountService  ──▶  permissionless.js + chain RPC
   /sa command            /v1/smart-account/*               (+ bundler, when enabled)
```

- **`api-ts/src/services/SmartAccountService.ts`** — the only place that touches
  account-abstraction libraries.
  - `predictAddress` — counterfactual Kernel address + on-chain deployment
    status. Read-only; works on any supported chain with an RPC.
  - `sendUserOperation` — build/sign/submit a UserOperation via a bundler.
    Bundler-agnostic (prefers Pimlico's gas oracle, falls back to chain fees).
- **Routes**: `GET /v1/smart-account/config`, `POST /v1/smart-account/predict`.
  The send path is intentionally **not** exposed over HTTP until it has been
  verified end-to-end on a testnet.
- **Bot**: `/sa` shows the user's default EVM wallet's smart-account address with
  an inline chain switcher (`bot/handlers/smart_account.py`), calling api-ts via
  `bot/services/api_client.py`.

## Configuration

| Env var | Where | Default | Purpose |
|---|---|---|---|
| `SMART_ACCOUNT_ENABLED` | api-ts | `false` | Master switch for the send path. |
| `BUNDLER_RPC_URL` | api-ts | — | ERC-4337 bundler JSON-RPC (e.g. Pimlico). Required to send. |

Address prediction needs neither — it works as long as the chain's RPC is set.

## Verification status

| Step | Status |
|---|---|
| Address prediction | ✅ Verified on Base mainnet (bot → api-ts → chain). |
| UserOperation build / encode / nonce / sign / hash | ✅ Verified on Base mainnet (`bun run verify:smart-account`). |
| Bundler submission + mining | ⛔ Needs a bundler API key + a funded/sponsored account. |

The only unverified hop is the bundler submission. It cannot be exercised
without a bundler key (gated behind a provider dashboard signup) and either
native testnet gas in the account or a sponsoring paymaster.

## Completing the send verification (needs a key)

1. **Get a free bundler key.** Create one at the
   [Pimlico dashboard](https://dashboard.pimlico.io) (free tier covers testnets).
   Any ERC-4337 bundler works (Alchemy, Stackup, …) — the code is not
   Pimlico-specific.

2. **Fund or sponsor the account.** Either send Base Sepolia ETH to the
   smart-account address (printed by the harness) from a
   [faucet](https://docs.base.org/chain/network-faucets), or use the bundler's
   paymaster for gas sponsorship.

3. **Run the harness** from `api-ts/`:

   ```bash
   SA_CHAIN_ID=84532 \
   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
   BUNDLER_RPC_URL="https://api.pimlico.io/v2/84532/rpc?apikey=YOUR_KEY" \
   SA_TEST_PRIVATE_KEY=0xYOUR_TEST_KEY \
   bun run verify:smart-account
   ```

   With no `BUNDLER_RPC_URL` it runs the build+sign verification only (no key,
   no funds needed) — useful as a smoke test:

   ```bash
   bun run verify:smart-account
   ```

Once a real send succeeds, set `SMART_ACCOUNT_ENABLED=true` + `BUNDLER_RPC_URL`
in the api-ts deployment and the `sendUserOperation` path is ready to wire into
the swap flow.
