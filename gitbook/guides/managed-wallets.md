# Managed Wallets

Managed wallets let your agent swap without ever touching a private key. Suwappu provisions a server-side wallet (secured by Turnkey) tied to your agent, signs transactions on your behalf, and broadcasts them. Your code only ever sees a public address and a Bearer token.

## Why Managed Wallets

- **No key handling** — your agent never generates, stores, or signs with a private key.
- **One EVM wallet, every EVM chain** — a single managed EVM address works across all 40+ EVM networks.
- **Server-side execution** — call `POST /v1/agent/swap/execute` and Suwappu does the signing and broadcasting.

## Step 1: Create a Wallet

```bash
curl -X POST https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

```json
{
  "success": true,
  "wallet": {
    "address": "0xYOUR_MANAGED_ADDRESS",
    "chain_type": "evm",
    "supported_chains": ["ethereum", "polygon", "arbitrum", "optimism", "base", "bsc"]
  },
  "message": "Wallet created. Fund it to start swapping."
}
```

The returned `address` is your agent's managed EVM wallet. It is recorded against your agent, so quotes and swaps are automatically priced and executed against it. Although `supported_chains` lists a sample, the same EVM address works across every supported EVM chain.

## Step 2: List Your Wallets

```bash
curl https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

If you have not created a wallet yet, the response hints you to create one with `POST /v1/agent/wallets`.

## Step 3: Fund the Wallet

Send the native gas token (and any tokens you want to swap) to the managed address. The wallet needs gas on whichever chain you intend to swap on (ETH on Base/Arbitrum/Optimism, BNB on BSC, MATIC on Polygon, etc.).

## Step 4: Quote, Simulate, and Execute

Use the managed wallet address on quote/simulation so routing and balance/gas checks run against the real sender. The final managed execution still resolves that wallet server-side:

```bash
# Quote
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "0.1", "chain": "base", "wallet_address": "0xYOUR_MANAGED_ADDRESS"}'

# Dry-run the returned q_abc123 before any broadcast
curl -X POST https://api.suwappu.bot/v1/agent/swap/simulate \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "q_abc123", "wallet_address": "0xYOUR_MANAGED_ADDRESS"}'

# Only after would_execute=true and explicit approval: execute server-side
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: rebalance-2026-08-06-001" \
  -d '{"quote_id": "q_abc123"}'
```

Persist the idempotency key. If an execution response is lost, reconcile status/history before retrying and reuse the same key.

## Ownership & Security

- A managed wallet belongs to the agent that created it. Quotes are cached per agent and can only be executed by that agent.
- Natural-language commands (`/v1/agent/execute`) that include a `wallet_address` are rejected unless the address is your own managed wallet — you cannot swap from a wallet you don't own.
- Rotate your API key any time with `POST /v1/agent/keys/rotate`; this does not change your wallet address.

## Client-Signed Wallets (Opt-Out)

If you prefer to hold your own keys, skip managed wallets entirely. Use `POST /v1/agent/swap` with your own `wallet_address` to receive an unsigned transaction (`to`, `value`, `data`, `chain_id`) that you sign and broadcast yourself. See [Cross-Chain Swaps](cross-chain-swaps.md#client-signed-alternative).
