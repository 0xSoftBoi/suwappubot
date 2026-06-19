# Building a Trading Bot

Build a simple automated trading bot on the Suwappu API. This tutorial wires together the core endpoints — register, create a managed wallet, watch prices, quote, and execute — into a small price-triggered bot that buys when a token dips below a threshold.

## What You'll Build

A bot that:

1. Polls the price of a token.
2. When the price drops below your target, quotes a swap into it.
3. Executes the swap from a managed wallet.
4. Logs the resulting swap ID and waits for completion.

## Prerequisites

Register an agent and store the API key:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "dip-buyer"}'
# Response: { "success": true, "api_key": "suwappu_sk_..." }
```

Create and fund a managed wallet (see [Managed Wallets](managed-wallets.md)):

```bash
curl -X POST https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## The Bot

```typescript
const BASE = 'https://api.suwappu.bot/v1/agent'
const API_KEY = process.env.SUWAPPU_API_KEY!
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

async function getPrice(symbol: string): Promise<number> {
  const res = await fetch(`${BASE}/prices?symbols=${symbol}`, { headers })
  const json = await res.json()
  return json.prices[symbol].usd
}

async function quote(fromToken: string, toToken: string, amount: string, chain: string) {
  const res = await fetch(`${BASE}/quote`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ from_token: fromToken, to_token: toToken, amount, chain }),
  })
  return res.json()
}

async function execute(quoteId: string) {
  const res = await fetch(`${BASE}/swap/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ quote_id: quoteId }),
  })
  return res.json()
}

async function status(swapId: string) {
  const res = await fetch(`${BASE}/swap/status/${swapId}`, { headers })
  return res.json()
}

// Strategy: buy ETH on Base with 200 USDC when ETH drops below target.
async function run(targetPrice: number) {
  while (true) {
    const price = await getPrice('ETH')
    console.log(`ETH price: $${price.toFixed(2)}`)

    if (price <= targetPrice) {
      console.log(`Target hit ($${targetPrice}). Buying ETH...`)
      const q = await quote('USDC', 'ETH', '200', 'base')
      if (!q.success) {
        console.error('Quote failed:', q.error)
        return
      }

      const swap = await execute(q.quote_id)
      console.log('Swap submitted:', swap.swap_id)

      // Poll until terminal
      let s = await status(swap.swap_id)
      while (s.status === 'pending') {
        await new Promise((r) => setTimeout(r, 5000))
        s = await status(swap.swap_id)
      }
      console.log('Final status:', s.status, s.tx_hash)
      return
    }

    await new Promise((r) => setTimeout(r, 30_000)) // check every 30s
  }
}

run(2800)
```

## Going Further

- **Use webhooks instead of polling** for swap status — see [Webhook Setup](webhook-setup.md).
- **Add cross-chain entries** by quoting with `from_chain` / `to_chain` — see [Cross-Chain Swaps](cross-chain-swaps.md).
- **Track history** with `GET /v1/agent/swaps` to record fills.
- **Diversify** by extending the strategy to multiple tokens and chains.

> This is an educational example, not financial advice. Test with small amounts on a funded wallet first, and handle errors (insufficient balance, expired quotes, slippage) before running unattended.
