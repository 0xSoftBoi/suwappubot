# Limit Orders

Set price-triggered swap orders that execute automatically when your target price is reached.

## How It Works

1. You set a token pair, target price, and trigger condition (price goes above or below)
2. Suwappu monitors the price continuously
3. When the target is hit, the swap executes automatically

## Creating a Limit Order

```bash
curl -X POST https://api.suwappu.bot/webapp/me/limit-orders \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fromChain": "base",
    "fromToken": "USDC",
    "toToken": "ETH",
    "amount": "500",
    "targetPrice": "2800",
    "triggerType": "lte"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromChain` | string | Yes | Chain to swap on |
| `fromToken` | string | Yes | Token to sell |
| `toToken` | string | Yes | Token to buy |
| `amount` | string | Yes | Amount of `fromToken` to swap |
| `targetPrice` | string | Yes | Price that triggers the swap |
| `triggerType` | string | Yes | `"lte"` (price drops to) or `"gte"` (price rises to) |

**Response:**

```json
{
  "success": true,
  "order": {
    "id": "lo_abc123",
    "fromChain": "base",
    "fromToken": "USDC",
    "toToken": "ETH",
    "amount": "500",
    "targetPrice": "2800",
    "triggerType": "lte",
    "status": "active",
    "created_at": "2026-03-29T12:00:00Z"
  }
}
```

## Listing Orders

```bash
curl https://api.suwappu.bot/webapp/me/limit-orders \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## Canceling an Order

```bash
curl -X DELETE https://api.suwappu.bot/webapp/me/limit-orders/lo_abc123 \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## Use Cases

**Buy the dip:** Set `triggerType: "lte"` to buy ETH when the price drops below $2,800.

**Take profit:** Set `triggerType: "gte"` to sell ETH when the price rises above $4,000.

**Accumulate:** Create multiple limit orders at different price levels to dollar-cost average into a position.

## Telegram Bot

Use the Telegram bot's `/o` command for an interactive limit order interface with step-by-step token selection, price setting, and order management.
