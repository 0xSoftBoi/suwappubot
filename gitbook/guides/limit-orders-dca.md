# Limit Orders

Set price-triggered swap orders that execute automatically when your target price is reached.

> **Authentication note:** The `/webapp/me/limit-orders` endpoints are protected by Telegram Mini App authentication (`X-Telegram-Init-Data`). They are accessible only from inside the Suwappu Telegram Mini App, not via agent API keys. Agent/API-key access to limit orders is not yet available.

## How It Works

1. You set a token pair, target price, and trigger condition (price goes above or below)
2. Suwappu monitors the price continuously
3. When the target is hit, the swap executes automatically

## Authentication (Mini App only)

These routes require the Telegram Web App `initData` string passed as the `X-Telegram-Init-Data` header:

```typescript
// Inside the Telegram Mini App
const initData = window.Telegram.WebApp.initData;

const res = await fetch('https://api.suwappu.bot/webapp/me/limit-orders', {
  method: 'POST',
  headers: {
    'X-Telegram-Init-Data': initData,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    fromChain: 'base',
    fromToken: 'USDC',
    toToken: 'ETH',
    amount: '500',
    targetPrice: '2800',
    triggerType: 'lte',
  }),
});
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

## Use Cases

**Buy the dip:** Set `triggerType: "lte"` to buy ETH when the price drops below $2,800.

**Take profit:** Set `triggerType: "gte"` to sell ETH when the price rises above $4,000.

**Accumulate:** Create multiple limit orders at different price levels to dollar-cost average into a position.

## Telegram Bot

Use the Telegram bot's `/o` command for an interactive limit order interface with step-by-step token selection, price setting, and order management.
