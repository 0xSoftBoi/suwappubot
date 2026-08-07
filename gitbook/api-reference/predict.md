# Prediction Markets

Read Polymarket market/event data through Suwappu, and—only when you intentionally grant trading authority—place or cancel CLOB limit orders with an authenticated Suwappu agent.

The market-data routes and trading/account routes have different authority. A read-only product does not need to initialize Polymarket trading credentials.

## Identifier contract

Market payloads expose three identifiers that are not interchangeable:

| Field | Meaning |
|---|---|
| `id` | Market ID used in `/market/:id` routes and MCP `market_id` |
| `conditionId` | Venue/on-chain condition ID |
| `tokens[].tokenId` | Outcome-token ID required by `POST /predict/order` |

## Market-data endpoints

### GET /v1/agent/predict/markets

Search/browse active markets.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | No | Full-text/topic search |
| `limit` | number | No | Maximum markets to return; default `20` |

`category` and `offset` are not parameters on the current route.

```bash
curl "https://api.suwappu.bot/v1/agent/predict/markets?query=bitcoin&limit=5"
```

The response envelope is `{ "markets": [...] }`:

```json
{
  "markets": [
    {
      "id": "<market-id>",
      "conditionId": "0x...",
      "question": "Will ...?",
      "outcomes": ["Yes", "No"],
      "outcomePrices": [0.42, 0.58],
      "tokens": [
        { "tokenId": "<yes-token-id>", "outcome": "Yes" },
        { "tokenId": "<no-token-id>", "outcome": "No" }
      ],
      "volume": 2450000,
      "liquidity": 890000,
      "endDate": "2026-12-31T00:00:00Z",
      "active": true,
      "category": "crypto"
    }
  ]
}
```

### GET /v1/agent/predict/events

Search/browse event groupings.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | No | Event title/topic search |
| `limit` | number | No | Maximum events to return; default `20` |

```bash
curl "https://api.suwappu.bot/v1/agent/predict/events?query=bitcoin&limit=10"
```

Response: `{ "events": [...] }`. Each event contains `id`, `title`, `description`, and `markets`.

### GET /v1/agent/predict/market/:id

Get one market's full detail. Use the `id` from `/predict/markets`, not `conditionId`.

```bash
curl "https://api.suwappu.bot/v1/agent/predict/market/<market-id>"
```

The response is the market object directly (there is no `success` or `market` wrapper) and adds `description`, `createdAt`, and `resolvedOutcome` to the fields shown above.

### GET /v1/agent/predict/market/:id/book

Get the current CLOB book for every outcome token in a market.

```bash
curl "https://api.suwappu.bot/v1/agent/predict/market/<market-id>/book"
```

Response shape:

```json
{
  "marketId": "<market-id>",
  "question": "Will ...?",
  "outcomes": [
    {
      "outcome": "Yes",
      "tokenId": "<yes-token-id>",
      "bids": [{ "price": "0.41", "size": "10" }],
      "asks": [{ "price": "0.43", "size": "8" }],
      "midpoint": "0.42",
      "lastTradePrice": "0.42",
      "tickSize": "0.01"
    }
  ]
}
```

Additional venue book fields such as `market` and `assetId` can also be present per outcome.

### GET /v1/agent/predict/market/:id/price

Get current CLOB midpoint data for every outcome.

```bash
curl "https://api.suwappu.bot/v1/agent/predict/market/<market-id>/price"
```

Response shape: `{ "marketId": "...", "question": "...", "prices": [{ "outcome": "Yes", "tokenId": "...", "mid": "0.42" }] }`.

### GET /v1/agent/predict/market/:id/trades

Get recent trades merged across a market's outcome tokens.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | No | Maximum merged trades; default `20` |

```bash
curl "https://api.suwappu.bot/v1/agent/predict/market/<market-id>/trades?limit=20"
```

Response: `{ "marketId": "...", "question": "...", "trades": [...] }`. Each trade is enriched with `outcome` and `tokenId`.

These market-data endpoints are independent live reads. Combining detail, price, book, and trades does not create an atomic venue snapshot.

## Authenticated trading/account endpoints

The following routes use the authenticated Suwappu agent's prediction trading credentials. Keep them outside a research-only agent unless trading authority is intentional.

### POST /v1/agent/predict/order

Place a CLOB GTC limit order. This is money-moving.

| Field | Type | Required | Description |
|---|---|---|---|
| `tokenId` | string | Yes | Outcome `tokenId` returned by market data |
| `price` | string | Yes | Limit price where `0 < price <= 1` |
| `size` | string | Yes | Positive number of outcome shares |
| `side` | string | Yes | `BUY` or `SELL` |

The current route does not expose `expiration` or `feeRateBps` request fields. Do not send them and assume they change the signed order.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/predict/order \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenId": "<outcome-token-id>",
    "price": "0.42",
    "size": "10",
    "side": "BUY"
  }'
```

Response: `{ "order": { ... } }`, where `order` is the current upstream CLOB order response.

Prediction-order placement does not currently expose the same durable request-idempotency contract as managed swap execution. If the client loses the response after submission, do not blindly retry the order. Reconcile account/venue state first.

### DELETE /v1/agent/predict/order/:id

Cancel an existing prediction order:

```bash
curl -X DELETE "https://api.suwappu.bot/v1/agent/predict/order/<order-id>" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

The agent must already have initialized Polymarket trading credentials.

### GET /v1/agent/predict/positions

List prediction positions enriched with current midpoint/P&L context:

```bash
curl https://api.suwappu.bot/v1/agent/predict/positions \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Response: `{ "positions": [...] }`.

### GET /v1/agent/predict/orders

List existing orders, optionally filtered by venue status:

```bash
curl "https://api.suwappu.bot/v1/agent/predict/orders?status=open" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Response: `{ "orders": [...] }`.

`positions`, `orders`, and `cancel` require prediction trading credentials. A fresh read-only agent may receive `No Polymarket credentials found. Place an order first to initialize.` That does not mean a research product should place a dummy order; simply omit account views until your product intentionally adds trading authority.

For a safe read-first workflow and product/economics patterns, see [Prediction Market Research](../guides/prediction-markets.md).
