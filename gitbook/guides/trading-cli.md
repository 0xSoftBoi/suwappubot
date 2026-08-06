# Trading CLI

Build a small command-line tool around the Suwappu REST API. The CLI separates **quote**, **preview**, and **managed execution** so a copied command never moves funds by default.

## Commands

- `suwappu quote <amount> <from> <to> [chain]` — fetch a fresh quote.
- `suwappu preview <quote_id> <wallet_address>` — run a zero-funds simulation.
- `suwappu execute <quote_id> --live` — explicitly submit through the authenticated agent's managed wallet.
- `suwappu status <swap_id>` — reconcile a managed swap.

## Setup

```bash
export SUWAPPU_API_KEY=suwappu_sk_YOUR_KEY
```

## The script

```ts
#!/usr/bin/env bun
const BASE = 'https://api.suwappu.bot/v1/agent'
const API_KEY = process.env.SUWAPPU_API_KEY
if (!API_KEY) { console.error('Set SUWAPPU_API_KEY'); process.exit(1) }

const headers = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
  const body = await response.json()
  if (!response.ok || body.success === false) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

async function post(path: string, body: unknown, extraHeaders = {}) {
  return request(path, {
    method: 'POST',
    headers: extraHeaders,
    body: JSON.stringify(body),
  })
}

const [cmd, ...args] = process.argv.slice(2)

switch (cmd) {
  case 'quote': {
    const [amount, from, to, chain = 'base'] = args
    const q = await post('/quote', { from_token: from, to_token: to, amount, chain })
    console.log(`Quote ${q.quote_id}`)
    console.log(`  ${q.amount_in} ${from} -> ${q.amount_out} ${to}`)
    console.log(`  minimum output: ${q.amount_out_min}`)
    console.log(`  preview with a wallet before executing`)
    break
  }
  case 'preview': {
    const [quoteId, walletAddress] = args
    const report = await post('/swap/simulate', {
      quote_id: quoteId,
      wallet_address: walletAddress,
    })
    console.log(JSON.stringify(report, null, 2))
    break
  }
  case 'execute': {
    const [quoteId, flag] = args
    if (flag !== '--live') {
      console.error('Refusing to execute without explicit --live')
      process.exit(2)
    }
    const idempotencyKey = `cli.${quoteId}`.slice(0, 64)
    const s = await post('/swap/execute', { quote_id: quoteId }, { 'Idempotency-Key': idempotencyKey })
    console.log(`Submitted managed swap ${s.swap_id} (${s.status})`)
    break
  }
  case 'status': {
    const [swapId] = args
    const s = await request(`/swap/status/${swapId}`)
    console.log(`Status: ${s.status}${s.tx_hash ? ` (${s.tx_hash})` : ''}`)
    break
  }
  default:
    console.log('Usage: suwappu <quote|preview|execute|status> ...')
}
```

## Usage

```bash
bun suwappu.ts quote 0.5 ETH USDC base
bun suwappu.ts preview q_abc123 0xYOUR_WALLET

# Only after reviewing the quote + simulation:
bun suwappu.ts execute q_abc123 --live
bun suwappu.ts status 42
```

The `execute` command uses `POST /swap/execute`, so it requires a funded [managed wallet](managed-wallets.md). For self-custody, call `POST /swap` instead; that returns an unsigned transaction that your wallet must sign and broadcast.

For a natural-language interface, see [Natural-Language CLI](natural-language-cli.md). For unattended automation, use the stricter [Strategy Lifecycle](strategy-lifecycle.md) rather than wrapping `quote -> execute` into a one-shot command.
