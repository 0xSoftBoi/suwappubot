# SDK Examples

TypeScript examples for the current Suwappu SDK contract: quote, preview, managed execution, self-custody preparation, and portfolio reads.

> **Version check:** these examples target `@suwappu/sdk` `0.6.x`. The repository can be ahead of npm, so check the registry before copying them. If `npm view @suwappu/sdk version` reports anything below `0.6.0`, use the REST example at the bottom of this page until `0.6.x` is published.

## Install

```bash
npm view @suwappu/sdk version
npm install @suwappu/sdk@^0.6.0
```

## Initialize the client

```ts
import { Suwappu } from '@suwappu/sdk'

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY })
```

Your API key comes from [registration](../api-reference/registration.md) and looks like `suwappu_sk_...`. The SDK sends it as `Authorization: Bearer <key>`.

## Get a quote

```ts
const quote = await client.getQuote({
  from: 'ETH',
  to: 'USDC',
  amount: '0.1',
  chain: 'base',
})

console.log(`${quote.fromAmount} ${quote.fromToken} -> ${quote.toAmount} ${quote.toToken}`)
console.log(`Quote ID: ${quote.id}`)
console.log(`Minimum output: ${quote.amountOutMin}`)
console.log(`Estimated gas: $${quote.gas}; route fee: $${quote.fee}`)
```

Treat a quote as a short-lived preview, not a promise of profit. Refresh it before an execution decision if it is near expiry.

## Managed wallet: preview first, execute explicitly

Managed execution signs and broadcasts server-side, so make the live boundary obvious in your code. This example dry-runs the quote and requires `SUWAPPU_LIVE=1` before funds can move.

```ts
const wallet = await client.agent.createWallet()
console.log('Managed wallet:', wallet.address)

const quote = await client.getQuote({
  from: 'ETH',
  to: 'USDC',
  amount: '0.1',
  chain: 'base',
  walletAddress: wallet.address,
})

const simulation = await client.simulateSwap({
  quoteId: quote.id,
  walletAddress: wallet.address,
})

console.table({
  expectedOutput: quote.toAmount,
  minimumOutput: quote.amountOutMin,
  gasUsd: quote.gas,
  routeFeeUsd: quote.fee,
  wouldExecute: simulation.wouldExecute,
})

if (!simulation.wouldExecute) {
  throw new Error(`Simulation did not pass: ${simulation.warnings.join('; ')}`)
}

if (process.env.SUWAPPU_LIVE !== '1') {
  console.log('Preview only. Set SUWAPPU_LIVE=1 after reviewing the quote.')
} else {
  const swap = await client.executeManagedSwap(quote, {
    idempotencyKey: `quickstart-${quote.id}`.slice(0, 64),
  })
  console.log('Managed swap submitted:', swap.swapId, swap.status)

  const status = await client.getSwapStatus(swap.swapId)
  console.log('Current status:', status.status, status.txHash)
}
```

`executeManagedSwap()` is the explicit managed-custody path and maps to `POST /v1/agent/swap/execute`. Give each intended trade a durable idempotency key; after an outcome-unknown timeout/network/5xx, reconcile first and reuse that key. Keep wallet policies, spend caps, approvals, and a kill switch around unattended automation.

## Self-custody: prepare, then sign yourself

```ts
const tx = await client.prepareSwap({
  quoteId: quote.id,
  walletAddress: '0xYOUR_WALLET',
})

console.log(tx)
```

`prepareSwap()` maps to `POST /v1/agent/swap`. It returns an **unsigned** transaction. Suwappu does not sign or broadcast it; your wallet must review, sign, and submit it.

## Read a portfolio

```ts
const balances = await client.getPortfolio(wallet.address)

for (const balance of balances) {
  console.log(`${balance.token} on ${balance.chain}: ${balance.balance} ($${balance.usdValue})`)
}
```

## Prefer plain `fetch`?

The REST contract is canonical and is the safest fallback whenever a package registry lags the repository:

```ts
const apiKey = process.env.SUWAPPU_API_KEY!

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

See the [API Reference](../api-reference/README.md) for exact REST request and response fields.
