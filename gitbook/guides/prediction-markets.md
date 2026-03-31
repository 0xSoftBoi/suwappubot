# Prediction Markets

Trade binary outcome markets on Polymarket through the Suwappu API. Browse events, check live prices, and place orders.

## How It Works

Prediction markets let you buy shares in outcomes. Each outcome trades between $0 and $1:
- **$0.42** means the market gives a 42% probability
- If the outcome resolves **Yes**, shares pay out $1
- If the outcome resolves **No**, shares pay out $0

## Step 1: Browse Markets

Search for active markets by keyword or category:

```bash
curl "https://api.suwappu.bot/v1/agent/predict/markets?category=crypto&limit=5" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Or browse prediction events:

```bash
curl "https://api.suwappu.bot/v1/agent/predict/events?query=bitcoin" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## Step 2: Check Prices

Get the current midpoint price for a specific market:

```bash
curl https://api.suwappu.bot/v1/agent/predict/market/0x1234abcd/price \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

View the full order book:

```bash
curl https://api.suwappu.bot/v1/agent/predict/market/0x1234abcd/book \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## Step 3: Place an Order

Buy shares in an outcome at a specific price:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/predict/order \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenId": "71321044878958750425...",
    "price": 0.42,
    "size": 100,
    "side": "BUY"
  }'
```

The `tokenId` identifies which outcome token you're trading. Get it from the market detail endpoint.

## Step 4: Manage Positions

Check your open positions:

```bash
curl https://api.suwappu.bot/v1/agent/predict/positions \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

List your orders:

```bash
curl https://api.suwappu.bot/v1/agent/predict/orders \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Cancel an open order:

```bash
curl -X DELETE https://api.suwappu.bot/v1/agent/predict/order/ord_abc123 \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## MCP Tool

If you're using Claude or another MCP client, two tools are available:
- `predict_markets` — search and browse markets
- `predict_market_detail` — get detailed info with live CLOB prices

## Telegram Bot

Use the Telegram bot's prediction market interface for interactive market browsing, price checking, and order placement.
