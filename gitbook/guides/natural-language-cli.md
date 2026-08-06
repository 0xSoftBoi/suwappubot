# Natural-Language CLI

Build a CLI that takes plain-English commands and routes them through the Suwappu `/execute` endpoint. Instead of constructing JSON for each swap, you type `swap 0.5 ETH to USDC on base` and the API parses the intent, resolves tokens and chains, and returns a ready quote.

## The /execute Endpoint

`POST /v1/agent/execute` accepts a natural-language `command` and an optional `wallet_address`. It parses swap and quote/price commands, fetches a quote, and returns a structured response. If you include `wallet_address` (which must be your own managed wallet), it also returns executable transaction data.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/execute \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"command": "swap 0.5 ETH to USDC on base"}'
```

A successful swap command returns:

```json
{
  "success": true,
  "action": "swap",
  "status": "quoted",
  "message": "Quote ready: 0.5 ETH -> 1247.500000 USDC on base",
  "quote_id": "q_abc123",
  "from_token": "ETH",
  "to_token": "USDC",
  "amount_in": "0.5",
  "amount_out": "1247.500000",
  "chain": "base",
  "chain_id": 8453,
  "exchange_rate": "2495.0",
  "gas_usd": "0.42",
  "has_transaction": false,
  "next_step": "Add wallet_address to get executable transaction data"
}
```

When you pass your own managed `wallet_address`, `has_transaction` becomes `true` and a `transaction` object (`to`, `value`, `data`, `chain_id`) is included for client-side signing.

> Note: `wallet_address` must be your agent's own managed wallet — passing another address returns `403`.

## The Script

```typescript
#!/usr/bin/env bun
const BASE = 'https://api.suwappu.bot/v1/agent'
const API_KEY = process.env.SUWAPPU_API_KEY
if (!API_KEY) { console.error('Set SUWAPPU_API_KEY'); process.exit(1) }

const headers = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }

async function execute(command: string, walletAddress?: string) {
  const body: Record<string, unknown> = { command }
  if (walletAddress) body.wallet_address = walletAddress
  const res = await fetch(`${BASE}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return res.json()
}

// Everything after the script name is the command.
const command = process.argv.slice(2).join(' ')
if (!command) {
  console.log('Usage: suwappu-nl "swap 0.5 ETH to USDC on base"')
  process.exit(1)
}

const result = await execute(command, process.env.SUWAPPU_WALLET)

if (!result.success) {
  console.error('Error:', result.error)
  if (result.fields) console.error(result.fields)
  process.exit(1)
}

console.log(result.message)
if (result.quote_id) console.log(`  quote_id: ${result.quote_id}`)
if (result.next_step) console.log(`  next: ${result.next_step}`)
```

## Usage

```bash
# Quote a swap
bun suwappu-nl.ts "swap 0.5 ETH to USDC on base"
# Quote ready: 0.5 ETH -> 1247.500000 USDC on base
#   quote_id: q_abc123
#   next: Add wallet_address to get executable transaction data

# Price/quote queries also work
bun suwappu-nl.ts "quote 1 ETH to USDC on arbitrum"
```

## Supported Phrasings

The endpoint understands forms like:

- `swap <amount> <from> to|for <to> [on <chain>]`
- `quote|price [of] <amount> <from> to|in|for <to> [on <chain>]`

If the chain is omitted, it defaults to Ethereum. For Solana, include `on solana`.

## Executing the Quote

`/execute` returns a quote (and optionally unsigned transaction data). It does not perform managed execution. First simulate that `quote_id`; then, after explicit approval, hand it to the managed endpoint:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/simulate \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "q_abc123"}'
```

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: nl-intent-001" \
  -d '{"quote_id": "q_abc123"}'
```

If the managed call has an unknown outcome, reconcile before retrying and reuse that idempotency key.

## Related

- The A2A endpoint (`POST /a2a`) accepts the same natural-language phrasing over JSON-RPC — see [A2A Protocol](../protocols/a2a.md).
- For typed, explicit commands, see the [Trading CLI](trading-cli.md).
