# Prediction Markets

Trade prediction markets on Polymarket through the Suwappu API. Browse events, check prices, and place orders on binary outcome markets.

## Public Endpoints

### GET /v1/agent/predict/markets

Search and browse active prediction markets.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search term |
| `category` | string | No | Filter by category (e.g., `"crypto"`, `"politics"`) |
| `limit` | number | No | Results per page (default 20) |
| `offset` | number | No | Pagination offset |

```bash
curl "https://api.suwappu.bot/v1/agent/predict/markets?category=crypto&limit=5" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

**Response:**

```json
{
  "success": true,
  "markets": [
    {
      "id": "0x1234abcd",
      "question": "Will ETH reach $5,000 by June 2026?",
      "category": "crypto",
      "endDate": "2026-06-30T00:00:00Z",
      "volume": "2450000",
      "liquidity": "890000",
      "outcomes": [
        { "name": "Yes", "price": 0.42 },
        { "name": "No", "price": 0.58 }
      ]
    }
  ]
}
```

### GET /v1/agent/predict/events

Browse prediction events with filtering.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search term |
| `limit` | number | No | Results per page |
| `offset` | number | No | Pagination offset |

```bash
curl "https://api.suwappu.bot/v1/agent/predict/events?query=bitcoin" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

### GET /v1/agent/predict/market/:id

Get detailed information about a specific market.

```bash
curl https://api.suwappu.bot/v1/agent/predict/market/0x1234abcd \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

### GET /v1/agent/predict/market/:id/book

Get the order book for a market.

```bash
curl https://api.suwappu.bot/v1/agent/predict/market/0x1234abcd/book \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

### GET /v1/agent/predict/market/:id/price

Get the current midpoint price for a market.

```bash
curl https://api.suwappu.bot/v1/agent/predict/market/0x1234abcd/price \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

### GET /v1/agent/predict/market/:id/trades

Get recent trades for a market.

```bash
curl https://api.suwappu.bot/v1/agent/predict/market/0x1234abcd/trades \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## Authenticated Endpoints

### POST /v1/agent/predict/order

Place an order on a prediction market.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tokenId` | string | Yes | Outcome token ID |
| `price` | number | Yes | Price between 0 and 1 (e.g., `0.42` for 42 cents) |
| `size` | number | Yes | Number of shares |
| `side` | string | Yes | `"BUY"` or `"SELL"` |

```bash
curl -X POST https://api.suwappu.bot/v1/agent/predict/order \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenId": "71321044878958750425140208824424590210...",
    "price": 0.42,
    "size": 100,
    "side": "BUY"
  }'
```

**Response:**

```json
{
  "success": true,
  "order": {
    "id": "ord_abc123",
    "tokenId": "71321044878958750425140208824424590210...",
    "side": "BUY",
    "price": 0.42,
    "size": 100,
    "status": "open",
    "created_at": "2026-03-29T12:00:00Z"
  }
}
```

### DELETE /v1/agent/predict/order/:id

Cancel an open order.

```bash
curl -X DELETE https://api.suwappu.bot/v1/agent/predict/order/ord_abc123 \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

### GET /v1/agent/predict/positions

List your open prediction market positions.

```bash
curl https://api.suwappu.bot/v1/agent/predict/positions \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

### GET /v1/agent/predict/orders

List your orders (open and filled).

```bash
curl https://api.suwappu.bot/v1/agent/predict/orders \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
