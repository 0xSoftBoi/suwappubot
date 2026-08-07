# Prediction Market Research

Use Suwappu's prediction-market reads to build screeners, watchlists, alerts, research workspaces, forecasting tools, and agent workflows on top of Polymarket data. Start read-only. Add trading authority only if it creates customer value and you have a separate approval, risk, and reconciliation workflow.

The public [Suwappu Prediction Research Bot](https://github.com/0xSoftBoi/suwappu-prediction-bot) is the copyable TypeScript/Python reference for this guide.

## Know the three identifiers

A market response carries identifiers with different jobs:

| Field | Use it for |
|---|---|
| `id` | Suwappu market detail, book, price, and trades routes; pass this to MCP `market_id` |
| `conditionId` | Venue/on-chain condition identity and settlement context |
| `tokens[].tokenId` | A specific outcome token; the prediction order endpoint takes this value |

Do not pass `conditionId` where an API or MCP tool asks for the market `id`, and do not place an order with the market `id` where a `tokenId` is required.

## 1. Discover markets and events

Search active markets with `query` and `limit`:

```bash
curl "https://api.suwappu.bot/v1/agent/predict/markets?query=bitcoin&limit=5" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

The current route supports `query` and `limit`; it does not expose `category` or `offset` query parameters. A market result includes the market `id`, `conditionId`, outcome names/prices, outcome token IDs, volume, liquidity, end date, activity state, and category.

Browse events when an event is a better grouping primitive:

```bash
curl "https://api.suwappu.bot/v1/agent/predict/events?query=bitcoin&limit=10" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## 2. Inspect one market before you alert on it

Use the market `id` returned by discovery:

```bash
MARKET_ID="<market-id>"

curl "https://api.suwappu.bot/v1/agent/predict/market/$MARKET_ID" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"

curl "https://api.suwappu.bot/v1/agent/predict/market/$MARKET_ID/price" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"

curl "https://api.suwappu.bot/v1/agent/predict/market/$MARKET_ID/book" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"

curl "https://api.suwappu.bot/v1/agent/predict/market/$MARKET_ID/trades?limit=20" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

These reads answer different questions:

| Read | Product question |
|---|---|
| detail | Is the market active, when does it end, and which outcome tokens exist? |
| price | What are the current CLOB midpoints? |
| book | What are the current bids/asks and how wide is the spread? |
| trades | Has the market traded recently and at what prices/sizes? |

They are separate live requests, not one atomic venue snapshot. If you combine them, store a capture timestamp and assume the market can move between responses.

## 3. Turn raw reads into a reusable snapshot

The reference repo turns detail + price + book + recent trades into a normalized, read-only market-health snapshot:

```bash
git clone https://github.com/0xSoftBoi/suwappu-prediction-bot.git
cd suwappu-prediction-bot
bun install --frozen-lockfile

export SUWAPPU_API_KEY=suwappu_sk_YOUR_KEY
bun run src/cli.ts snapshot --id <market-id> --trades 20
```

The snapshot derives per-outcome midpoint, best bid/ask, spread, one-cent near-book depth, recent-trade freshness, and warnings for inactive, empty, incomplete, or crossed books. It is designed as input to your product logic, not as a forecast or executable quote.

That distinction matters:

- a midpoint is market data, not a guaranteed objective probability;
- a midpoint is not a fill price;
- a narrow spread does not guarantee enough depth for your desired size;
- four responses captured together are still non-atomic;
- a historical backtest or forecast score is not customer trading P&L.

## Use MCP when the customer experience is conversational

Suwappu's hosted MCP server currently lists five prediction read tools:

- `predict_markets` — discovery/search;
- `predict_market` — market detail;
- `predict_book` — outcome books;
- `predict_price` — midpoint prices;
- `predict_trades` — recent trades.

`predict_market_detail` remains a legacy alias for market detail, but new clients should use the listed `predict_market` name. For all four tools that take `market_id`, pass the `id` from `predict_markets`, not `conditionId`.

Use the focused repository when you want a narrow prediction-data allowlist. Use hosted MCP when prediction research is one tool set inside a broader assistant that also needs other Suwappu capabilities.

## Choose the SDK surface deliberately

The `suwappubot` source tree can move ahead of published packages. The public prediction reference therefore uses the installed TypeScript SDK for methods that are already published and a tiny read-only REST bridge for newer prediction reads; its Python example pins the source SDK to a known commit.

Before copying a method from `main`, verify that the package version you actually install exports it. The REST examples in this guide show the current wire contract directly.

## Build a product before you build a trading bot

A useful product ladder is:

| Tier | What the customer gets | Authority |
|---|---|---|
| Screener | Search + saved markets + market-health snapshots | Read-only |
| Alerts | State-change alerts with spread/liquidity/freshness context | Read-only |
| Research workspace/API | History, notes, model forecasts, calibration, exports/webhooks | Read-only |
| Execution handoff | An explicit action that enters a separate trading workflow | Money-moving |

Start charging at the layer where a customer gets repeated value. You do not need custody or trading authority to sell research, monitoring, workflow, or an API.

For alerts, persist state instead of firing on every poll. A production monitor should have:

- a stable customer + market + rule identity;
- a threshold plus hysteresis so values near the boundary do not flap;
- dedupe/cooldown state across restarts;
- the observed midpoint, spread, depth, and capture time in the alert evidence;
- a stale-data policy and an upstream-error state distinct from “no change.”

## Budget requests before choosing a price

The reference snapshot is approximately four Suwappu read requests per watched market: detail, price, book, and trades. A rough polling budget is therefore:

```text
read calls/day ~= watched markets × snapshots per market/day × 4
```

Watching 25 markets every five minutes is roughly `25 × 288 × 4 = 28,800` Suwappu reads per day before discovery, customer refreshes, retries, model calls, storage, or alert delivery. Do not discover every market and snapshot every result on every loop.

Measure real usage and billing, then keep the business ledger separate:

```text
builder margin
  = subscription + usage revenue
  - Suwappu/API cost
  - model/provider cost
  - infrastructure + alert-delivery cost
  - support/refunds/credits
```

See [Build a Business on Suwappu](build-a-business.md) for the full pricing boundary.

## If you publish forecasts, prove calibration separately

Store an immutable forecast record before resolution:

```text
customer / model / market id
forecast probability
market midpoint at forecast time
captured_at
model + prompt/rule version
eventual resolved outcome
```

After resolution, calculate calibration metrics such as Brier score or log loss across a meaningful sample. Keep that forecast ledger separate from strategy fills, fees, slippage, and realized P&L. A good forecast score does not prove a profitable executable strategy, and a customer subscription is not trading profit.

## Trading is a separate authority boundary

Suwappu also has authenticated prediction order, cancel, position, and order-history routes. The public prediction reference deliberately does **not** expose order placement or cancellation.

The current order route takes exactly:

```json
{
  "tokenId": "<outcome-token-id>",
  "price": "0.42",
  "size": "10",
  "side": "BUY"
}
```

`price` and `size` are strings in the current contract, and the server submits a GTC limit order. Do not invent an `expiration` or `feeRateBps` field and assume it is enforced.

Before exposing that route to an agent, add your own approval/policy boundary, per-action and daily caps, durable intent state, and an ambiguous-outcome recovery path. Never blindly retry a money-moving request after a network timeout just because the client did not receive a response.

`GET /v1/agent/predict/positions` and `GET /v1/agent/predict/orders` are read operations, but they require prediction trading credentials for the agent. A fresh research-only agent can legitimately have none; do not place a dummy order just to initialize those account views.

## How this stacks up against current Polymarket OSS

For new direct-venue integrations, Polymarket's current official references are its unified [TypeScript SDK](https://github.com/Polymarket/ts-sdk) and [Python SDK](https://github.com/Polymarket/py-sdk). Polymarket also documents its current CLOB contract in the [V2 migration guide](https://docs.polymarket.com/v2-migration).

| Need | Suwappu prediction reference | Polymarket unified SDKs |
|---|---|---|
| Narrow read-only authority for an analyst/agent | Built in by example design | Build your own boundary |
| One identity/tool plane alongside other Suwappu capabilities | Yes | No |
| Copyable market-health/product normalization | Yes | Build it on venue data |
| Direct venue authentication, trading lifecycle, or venue-specific features | Not the goal of this reference | Better fit |
| Proof that a strategy will make money | No | No |

The Suwappu reference wins when your product needs a small, understandable authority surface and reusable product logic. The direct SDKs win when you need full venue control. Do not rebuild a venue SDK inside the example repo just to look comprehensive.

## A first paid experiment

Keep the first version narrow: one customer persona, a watchlist of perhaps 10–25 markets, one or two alerts that save real research time, and a weekly/daily evidence summary. Track:

- activation: did the user save a market and receive a useful snapshot/alert?;
- retention: did they return or keep alerts enabled after the novelty week?;
- signal quality: what share of alerts were opened, acted on, or muted?;
- reliability: stale/error rate and time to recover;
- unit economics: revenue per active customer versus read/model/infra/support cost.

Only add forecasting, more frequent polling, or execution when the retained use tells you why. That is a much stronger path to making money as a builder than promising that a prediction strategy will be profitable.

For exact endpoint shapes, see the [Prediction Markets API reference](../api-reference/predict.md).
