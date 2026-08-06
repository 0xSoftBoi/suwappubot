# Cross-Chain Swaps

Walk through a complete cross-chain swap with the Suwappu API: get a quote that bridges between two chains, execute it with a managed wallet, and poll for the final status. Suwappu races up to nine aggregators and bridges (Li.Fi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across, CCTP) to find the best route, so you never pick a bridge yourself.

## How Cross-Chain Works

A same-chain swap passes a single `chain`. A cross-chain swap passes `from_chain` and `to_chain` instead — the routing engine handles bridging and settlement under the hood and returns a single quote with the expected output on the destination chain.

## Step 1: Get a Cross-Chain Quote

Move 100 USDC on Arbitrum into ETH on Base:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "USDC",
    "to_token": "ETH",
    "amount": "100",
    "from_chain": "arbitrum",
    "to_chain": "base",
    "wallet_address": "0xYOUR_MANAGED_ADDRESS"
  }'
```

The response includes a `quote_id`, the `expected_output`, the route, and estimated gas. Quotes are short-lived (roughly 60 seconds), so execute promptly.

```json
{
  "success": true,
  "quote_id": "q_abc123",
  "expected_output": "0.0392",
  "from_chain": "arbitrum",
  "to_chain": "base",
  "route": "...",
  "gas_usd": "0.41"
}
```

## Step 2: Simulate, Then Execute the Swap

With a managed wallet provisioned (see [Managed Wallets](managed-wallets.md)), dry-run the quote first:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/simulate \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "q_abc123", "wallet_address": "0xYOUR_MANAGED_ADDRESS"}'
```

Only continue when `would_execute` is true and the route economics still meet your product's limits. Managed execution signs and broadcasts server-side:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: cross-chain-intent-001" \
  -d '{"quote_id": "q_abc123"}'
```

```json
{
  "success": true,
  "swap_id": "sw_xyz789",
  "status": "pending"
}
```

Treat a timeout/network/5xx as outcome-unknown: reconcile the managed swap before retrying and reuse the same idempotency key.

## Step 3: Track the Swap

Cross-chain swaps settle over multiple blocks. Poll the status endpoint until it reaches a terminal state:

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/sw_xyz789 \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

```json
{
  "success": true,
  "status": "completed",
  "tx_hash": "0x..."
}
```

Instead of polling, you can set a `callback_url` on your agent and receive a signed webhook when the swap completes — see [Webhook Setup](webhook-setup.md).

## Client-Signed Alternative

If you manage your own keys, use `POST /v1/agent/swap` instead of `/swap/execute`. It returns an unsigned transaction request (`to`, `value`, `data`, `chain_id`) that you sign and broadcast yourself. Pass your own `wallet_address` so the quote is priced and the transaction is built against your address.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "q_abc123", "wallet_address": "0xYOUR_ADDRESS"}'
```

## Tips

- For stablecoin-to-stablecoin moves (e.g. USDC → USDC across chains), routing often uses CCTP or Across for fast, low-slippage bridging.
- Always check `expected_output` before executing — cross-chain rates include bridge fees.
- Re-quote if a `quote_id` has expired; executing a stale quote will fail.

See [EVM Chains](../chains-reference/evm-chains.md) for the full list of supported source and destination chains.
