# Trading CLI

Build a small command-line tool that quotes and executes swaps against the Suwappu API. It's a thin wrapper over the REST endpoints — useful for manual trading, scripting, and as a starting point for richer tooling.

## What You'll Build

A `suwappu` CLI with three commands:

- `suwappu quote <amount> <from> <to> [chain]` — get a quote
- `suwappu swap <quote_id>` — execute a quote from your managed wallet
- `suwappu status <swap_id>` — check a swap's status

## Setup

Export your key (register via `POST /v1/agent/register` if you don't have one):

```bash
export SUWAPPU_API_KEY=suwappu_sk_YOUR_KEY
```

## The Script

```typescript
#!/usr/bin/env bun
const BASE = 'https://api.suwappu.bot/v1/agent'
const API_KEY = process.env.SUWAPPU_API_KEY
if (!API_KEY) { console.error('Set SUWAPPU_API_KEY'); process.exit(1) }

const headers = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }

async function get(path: string) {
  return (await fetch(`${BASE}${path}`, { headers })).json()
}
async function post(path: string, body: unknown) {
  return (await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })).json()
}

const [cmd, ...args] = process.argv.slice(2)

switch (cmd) {
  case 'quote': {
    const [amount, from, to, chain = 'base'] = args
    const q = await post('/quote', { from_token: from, to_token: to, amount, chain })
    if (!q.success) { console.error('Error:', q.error); process.exit(1) }
    console.log(`Quote ${q.quote_id}`)
    console.log(`  ${amount} ${from} -> ${q.expected_output} ${to} on ${chain}`)
    console.log(`  Run: suwappu swap ${q.quote_id}`)
    break
  }
  case 'swap': {
    const [quoteId] = args
    const s = await post('/swap/execute', { quote_id: quoteId })
    if (!s.success) { console.error('Error:', s.error); process.exit(1) }
    console.log(`Submitted swap ${s.swap_id} (${s.status})`)
    console.log(`  Run: suwappu status ${s.swap_id}`)
    break
  }
  case 'status': {
    const [swapId] = args
    const s = await get(`/swap/status/${swapId}`)
    console.log(`Status: ${s.status}${s.tx_hash ? ` (${s.tx_hash})` : ''}`)
    break
  }
  case 'prices': {
    const p = await get(`/prices?symbols=${args.join(',') || 'ETH,BTC,SOL'}`)
    for (const [sym, data] of Object.entries<any>(p.prices)) {
      console.log(`${sym}: $${data.usd.toFixed(2)}`)
    }
    break
  }
  default:
    console.log('Usage: suwappu <quote|swap|status|prices> ...')
}
```

## Usage

```bash
# Get a quote
bun suwappu.ts quote 0.5 ETH USDC base
# Quote q_abc123
#   0.5 ETH -> 1247.50 USDC on base
#   Run: suwappu swap q_abc123

# Execute it (requires a funded managed wallet)
bun suwappu.ts swap q_abc123
# Submitted swap sw_xyz789 (pending)

# Check status
bun suwappu.ts status sw_xyz789
# Status: completed (0x...)

# Check prices
bun suwappu.ts prices ETH BTC SOL
```

## Next Steps

- Add a `wallet` command that calls `POST /v1/agent/wallets` to provision a managed wallet.
- Prefer natural-language input? See [Natural-Language CLI](natural-language-cli.md), which uses the `/execute` endpoint.
- Wrap quote → swap → status into a single command with automatic status polling.

Requires a funded [managed wallet](managed-wallets.md) for the `swap` command to execute server-side.
