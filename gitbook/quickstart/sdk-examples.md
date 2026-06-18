# SDK Examples

TypeScript examples for the most common agent operations — quote, swap, and portfolio. The SDK is a thin wrapper over the REST API; every call maps one-to-one to an endpoint under `/v1/agent`, so the request and response shapes match the [API Reference](../api-reference/README.md) exactly.

## Install

```bash
bun add @suwappu/sdk
```

## Initialize the client

```ts
import { Suwappu } from '@suwappu/sdk'

const client = new Suwappu({ apiKey: process.env.SUWAPPU_KEY! })
```

Your API key comes from [registration](../api-reference/registration.md) and looks like `suwappu_sk_...`. Every request the client makes sends it as `Authorization: Bearer <key>`.

## Get a quote

```ts
const quote = await client.quote({
  from_token: 'ETH',
  to_token: 'USDC',
  amount: '0.1',
  chain: 'base',
})

console.log(`${quote.amount_in} ETH -> ${quote.amount_out} USDC`)
console.log(`Quote ID: ${quote.quote_id} (valid 60s)`)
```

## Execute a swap (managed wallet)

```ts
// Create a managed wallet once, then fund it.
const { wallet } = await client.createWallet()
console.log('Fund this address:', wallet.address)

// Quote, then execute against your managed wallet.
const quote = await client.quote({
  from_token: 'ETH',
  to_token: 'USDC',
  amount: '0.1',
  chain: 'base',
  wallet_address: wallet.address,
})

const swap = await client.executeSwap({ quote_id: quote.quote_id })
console.log('Swap submitted:', swap.swap_id, swap.status)

// Poll for completion.
const status = await client.swapStatus(swap.swap_id)
console.log('Final status:', status.status, status.tx_hash)
```

## Read a portfolio

```ts
const portfolio = await client.portfolio({ wallet_address: wallet.address })

console.log(`Total: $${portfolio.total_usd}`)
for (const b of portfolio.balances) {
  console.log(`${b.symbol} on ${b.chain}: ${b.balance} ($${b.usd_value})`)
}
```

## Prefer plain `fetch`?

The SDK is optional. Every example above is a single HTTP call you can make directly:

```ts
const apiKey = process.env.SUWAPPU_KEY!

const quote = await fetch('https://api.suwappu.bot/v1/agent/quote', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from_token: 'ETH',
    to_token: 'USDC',
    amount: '0.1',
    chain: 'base',
  }),
}).then((r) => r.json())

console.log(`Quote ID: ${quote.quote_id}`)
```

See the [API Reference](../api-reference/README.md) for the full set of endpoints and their exact request and response fields.
