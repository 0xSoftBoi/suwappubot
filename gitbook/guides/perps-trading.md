# Perpetual Futures Trading

Trade perpetual futures through Suwappu's HyperLiquid integration. Open leveraged long and short positions on 10 major crypto assets.

## Available Markets

| Market | Max Leverage |
|--------|-------------|
| BTC-USD | 20x |
| ETH-USD | 20x |
| SOL-USD | 20x |
| ARB-USD | 20x |
| AVAX-USD | 20x |
| DOGE-USD | 20x |
| MATIC-USD | 20x |
| OP-USD | 20x |
| SUI-USD | 20x |
| APT-USD | 20x |

## Step 1: Browse Markets

Check current prices, funding rates, and open interest:

```bash
curl https://api.suwappu.bot/v1/agent/perps/markets \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## Step 2: Get a Quote

Before opening a position, get a quote to see entry price, liquidation price, and required margin:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/perps/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "market": "ETH-USD",
    "side": "long",
    "size": "0.5",
    "leverage": 10
  }'
```

Key fields in the response:
- `entryPrice` — the price at entry
- `liquidationPrice` — price at which the position gets liquidated
- `margin` — required collateral
- `fee` — trading fee

## Step 3: Check Positions

Monitor your open positions:

```bash
curl https://api.suwappu.bot/v1/agent/perps/positions \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## TypeScript Example

```typescript
const client = new Suwappu({ apiKey: process.env.SUWAPPU_KEY })

// Browse markets
const markets = await fetch('https://api.suwappu.bot/v1/agent/perps/markets', {
  headers: { Authorization: `Bearer ${apiKey}` }
}).then(r => r.json())

console.log(markets.markets.map(m => `${m.symbol}: $${m.markPrice}`))

// Get a quote for 0.5 ETH long at 10x
const quote = await fetch('https://api.suwappu.bot/v1/agent/perps/quote', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    market: 'ETH-USD',
    side: 'long',
    size: '0.5',
    leverage: 10
  })
}).then(r => r.json())

console.log(`Entry: $${quote.quote.entryPrice}`)
console.log(`Liquidation: $${quote.quote.liquidationPrice}`)
console.log(`Margin required: $${quote.quote.margin}`)
```

## Telegram Bot

Use `/perps` in the Telegram bot for an interactive trading interface with market selection, side, amount, leverage, and confirmation steps.
