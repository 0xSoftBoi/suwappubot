# Perpetual Futures Research

Build a Hyperliquid market, position-risk, and alerting product on Suwappu. The current Agent API is a **read/quote surface**: it can browse supported markets, estimate a hypothetical position, and inspect an address's open positions, but it cannot open or close a perpetual position.

That boundary is useful. You can sell monitoring, alerts, research, team workflows, or an API without giving an agent venue trading authority.

## 1. Browse live market context

```bash
curl https://api.suwappu.bot/v1/agent/perps/markets
```

Each market now carries live Hyperliquid mark/funding context plus two different leverage limits:

- `maxLeverage`: the maximum the current **Suwappu quote route** accepts for that market;
- `venueMaxLeverage`: the raw maximum reported by Hyperliquid for the venue market;
- `markPrice`: Hyperliquid's current `markPx`;
- `fundingRate`: Hyperliquid's current raw market `funding` rate.

Do not substitute `venueMaxLeverage` for `maxLeverage` when calling Suwappu. The current Suwappu quote ceiling is 20x, so a venue market can report a higher raw maximum than Suwappu will quote.

Use the returned `name` values as identifiers. Suwappu currently exposes a supported subset of the canonical Hyperliquid perp universe; do not hard-code the list.

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

The quote gives you an indicative entry price, margin, approximate liquidation price, current market funding rate, and fee estimate. It is not an executable order and does not model a guaranteed fill.

`entryPrice` uses Hyperliquid's current midpoint when the venue provides it, falling back to the mark. `fundingRate` is the current raw market rate, not a forecast of funding payments over a holding period.

Always validate requested leverage against that market's returned `maxLeverage` before asking for a quote.

## 3. Inspect real positions by address

```bash
curl "https://api.suwappu.bot/v1/agent/perps/positions?address=0xYOUR_HYPERLIQUID_ADDRESS" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

The returned `fundingRate` is the current market funding rate for that position's asset. It is **not** the position's accrued funding P&L. `liquidationPrice: 0` means Hyperliquid did not report a liquidation price on this path; treat it as unavailable.

## 4. Turn reads into a risk snapshot

A product primitive can compose `positions` + `markets` without adding authority:

```ts
import { Suwappu } from '@suwappu/sdk'

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY })
const address = '0xYOUR_HYPERLIQUID_ADDRESS'

const [positions, markets] = await Promise.all([
  client.perps.positions(address),
  client.perps.markets(),
])

const maxByMarket = new Map(markets.map((market) => [market.name, market.maxLeverage]))

const risk = positions.map((position) => {
  const liquidationBufferPct =
    position.liquidationPrice <= 0 || position.markPrice <= 0
      ? null
      : position.side === 'long'
        ? ((position.markPrice - position.liquidationPrice) / position.markPrice) * 100
        : ((position.liquidationPrice - position.markPrice) / position.markPrice) * 100

  return {
    id: position.id,
    market: position.market,
    notionalUsd: Math.abs(position.size) * position.markPrice,
    pnlOnMarginPct: position.margin > 0
      ? (position.unrealizedPnl / position.margin) * 100
      : null,
    liquidationBufferPct,
    leverageUtilizationPct: maxByMarket.has(position.market)
      ? (position.leverage / maxByMarket.get(position.market)!) * 100
      : null,
    fundingRate: position.fundingRate,
  }
})

console.table(risk)
```

The two endpoints are independent reads. The composed object is not an atomic venue snapshot, and your local computation time is not an exchange timestamp.

## 5. Build alerts that do not spam

Useful customer-configured rules include:

- reported liquidation buffer crossing a threshold;
- leverage utilization crossing a threshold;
- unrealized P&L or P&L-on-margin crossing a threshold;
- the raw current funding rate crossing a threshold;
- a contemplated quote's fee or margin changing materially.

The hard part is alert state, not the comparison operator. Persist a key such as `(tenant, wallet, position, rule_version)` with last state, first-triggered time, last-notified time, acknowledgement/snooze state, and delivery result.

Use hysteresis. For example, a customer could configure a warning at a 10% reported liquidation buffer and recovery at 12%. Those numbers demonstrate state-machine behavior; they are not a recommended risk policy.

Notify on transitions (`healthy → warning`, `warning → recovered`) instead of every poll.

## Request economics

A standalone wallet risk snapshot uses two Suwappu reads: one positions read plus one markets read. A service can share the markets result across wallets in the same poll cycle.

For 100 wallets polled once per minute:

- naive per-wallet composition: `100 × 2 × 1,440 = 288,000` HTTP reads/day;
- one shared markets read per cycle: `(100 + 1) × 1,440 = 145,440` HTTP reads/day.

Those are request counts, not a Suwappu billing claim. Convert usage into money only with the current tier/pricing terms that actually apply to your account.

## Turn research into a paid product

A clean product ladder is:

1. free market/position explorer;
2. paid risk/funding/P&L alerts;
3. multi-wallet workspace with history and team ownership;
4. API/webhook plan with quotas, exports, and delivery logs;
5. optional execution handoff as a separate integration and approval boundary.

Keep builder economics separate from customer trading performance:

```text
product revenue = paid seats × realized subscription revenue per seat
variable cost   = API usage + delivery + storage + variable compute
contribution    = product revenue - variable cost
```

Customer trading P&L is not your product revenue. Measure activation (first successful real read), alert setup, successful delivery, retained monitored wallets, support cost, and contribution margin.

See [Build a Business on Suwappu](build-a-business.md) and [Strategy Lifecycle](strategy-lifecycle.md).

## Source SDK examples

Check the [SDK version note](../quickstart/sdk-examples.md) before installing; the repository can be ahead of the npm package.

```ts
import { Suwappu } from '@suwappu/sdk'

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY })
const markets = await client.perps.markets()
const eth = markets.find((market) => market.name === 'ETH-USD')

if (eth) {
  console.log({
    quoteMax: eth.maxLeverage,
    venueMax: eth.venueMaxLeverage,
    mark: eth.markPrice,
    funding: eth.fundingRate,
  })
}
```

## How this stacks up against Hyperliquid OSS

Hyperliquid's official [API documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api) points developers to its [official Python SDK](https://github.com/hyperliquid-dex/hyperliquid-python-sdk). The direct venue surface is much broader: signing/trading, more market/account endpoints, and realtime [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket).

Use Hyperliquid directly when you need low-latency streaming, the full venue universe, venue-specific features, or execution/signing. Use Suwappu when you want a smaller agent-facing REST/SDK/MCP research boundary and you explicitly do **not** want to hand that agent venue execution authority.

Current Suwappu limitations to design around:

- no Agent API perps open/close/order route;
- no perps WebSocket surface in this API;
- a supported subset of the canonical Hyperliquid perp universe rather than every venue/Dex market;
- quotes are indicative and do not model order-book depth or fill slippage;
- position `fundingRate` is current market context, not accrued funding P&L.
