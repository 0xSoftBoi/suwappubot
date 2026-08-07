# Perpetual Futures Research

Build a HyperLiquid market and position research agent on Suwappu. The current Agent API is a **read/quote surface**: it can browse markets, estimate a hypothetical position, and inspect an address's open positions, but it cannot open or close a perpetual position.

That makes the useful product today an explorer, risk monitor, alerting service, or signal engine — not an autonomous perps trader.

## 1. Browse markets

```bash
curl https://api.suwappu.bot/v1/agent/perps/markets
```

Use the returned `name` values as the market identifiers. Do not hard-code a list: HyperLiquid's universe and Suwappu's supported subset can change.

## 2. Price a hypothetical position

```bash
curl -X POST https://api.suwappu.bot/v1/agent/perps/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "market": "ETH-USD",
    "side": "long",
    "size": 0.5,
    "leverage": 10
  }'
```

The quote gives you an indicative entry price, margin, approximate liquidation price, and fee estimate. It is not an executable order and does not model a guaranteed fill.

## 3. Inspect real positions by address

```bash
curl "https://api.suwappu.bot/v1/agent/perps/positions?address=0xYOUR_HYPERLIQUID_ADDRESS" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Useful alerts include:

- distance from mark price to liquidation price, only when `liquidationPrice > 0` (zero means HyperLiquid did not report one on this path);
- leverage or margin above a user-defined risk ceiling;
- unrealized P&L crossing a user-defined threshold;
- a meaningful change in the indicative fee/margin for a contemplated position.

Do not alert on `fundingRate` yet: this Agent API path currently reports a placeholder zero rather than live funding.

## TypeScript SDK (`0.6.x`)

Check the [SDK version note](../quickstart/sdk-examples.md) before installing; the repository can be ahead of npm.

```ts
import { Suwappu } from '@suwappu/sdk'

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY })

const markets = await client.perps.markets()
const eth = markets.find((market) => market.name === 'ETH-USD')
console.log(eth)

const hypothetical = await client.perps.quote({
  market: 'ETH-USD',
  side: 'long',
  size: 0.5,
  leverage: 10,
})
console.log(hypothetical)

const positions = await client.perps.positions('0xYOUR_HYPERLIQUID_ADDRESS')
console.table(positions)
```

## Turn research into a paid product

The clean monetization boundary is the analysis you add: risk scoring, alerts, watchlists, scenario reports, or a portfolio dashboard. Charge customers for that service and keep the downstream trading integration explicit.

If you later connect a separate execution venue, measure fills, fees, funding, and slippage in your own ledger and label that connector clearly. Do not present a signal as an executed Suwappu trade. See [Build a Business on Suwappu](build-a-business.md) and [Strategy Lifecycle](strategy-lifecycle.md).
