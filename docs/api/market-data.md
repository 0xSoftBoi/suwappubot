# Suwappu Market Data API Reference

Databento-style capture → normalize → store → distribute pipeline for Suwappu's
cross-chain token market data. This document covers `/v1/data/*` on the
TypeScript API (`api-ts`).

## 1. Overview

**Architecture** (`docs/plans/market-data-parity.md`):

```
capture   Python bot/services/market_data.py (async task, api/main.py lifespan)
          polls CoinGecko every ~60s per tracked token -> normalizes -> writes candles
          one-time tiered backfill from GeckoTerminal on startup: ~365d of 1d
          candles, ~30d of 1h, ~24h of 1m, per (symbol, chain)
storage   shared Postgres, `market_candles` table (SQLAlchemy model +
          Drizzle schema + _ensure_schema(), additive/idempotent)
distribute api-ts, /v1/data/* (Hono; Effect-TS only for the DB read)
          Reference  GET /v1/data/reference/{chains,tokens,resolve}
          Historical GET /v1/data/history/ohlcv (DB-backed, external fallback)
          Metadata   GET /v1/data/{metadata,status} (dataset coverage + capture freshness)
          Live       WS  /v1/data/live (in-process 2s poll of the shared price cache)
clients   packages/sdk (TypeScript), packages/sdk-python (Python)
metering  per-caller request counters, /v1/data/usage
```

Source: `api-ts/src/routes/data.ts:1-17`, `docs/plans/market-data-parity.md:14-29`.

### Authentication

Every `/v1/data/*` route (including the WebSocket upgrade) is gated by
`agentFlexAuth()` (`api-ts/src/routes/data.ts:45`), which tries two schemes in order:

1. **Org API key** — `X-API-Key: sk_live_xxx` or `Authorization: Bearer sk_live_xxx`.
   Validated against `api_keys` + `organizations` + `subscriptions`; the owning
   org must hold an **active enterprise subscription** or the request is
   rejected with 401. Enforces a per-key (fallback per-org) rate limit —
   `X-RateLimit-Limit` / `X-RateLimit-Remaining` response headers, 429 with
   `Retry-After` when exceeded. (`api-ts/src/middleware/apiKeyAuth.ts:22-168`)
2. **Agent bearer token** — `Authorization: Bearer suwappu_sk_xxx`
   (`api-ts/src/middleware/agentFlexAuth.ts:1-37`, pattern
   `^suwappu_sk_[a-zA-Z0-9_-]+$` in `api-ts/src/middleware/auth.ts:134`).

The caller identity used for metering is `apikey:<keyId>` for org keys, else
`agent:<uuid|id>` (`api-ts/src/routes/data.ts:48-54`).

WebSocket note: browsers cannot set custom headers on the upgrade request, so
`Authorization: Bearer` only reaches the server under Bun (which extends
`WebSocket` with a `headers` option); browser callers need a same-origin proxy
that injects the header (`packages/sdk/src/client.ts:744-751`).

Route mount: `app.route('/v1/data', dataRoutes)` — `api-ts/src/app.ts:203`.

---

## 2. Reference API

### `GET /v1/data/reference/chains`

Returns every chain slug, both EVM (deduped from the shared `CHAINS` config)
and the three non-EVM chains hardcoded in the route.

No params.

```json
{
  "success": true,
  "chains": [
    { "slug": "base", "chain_id": 8453, "name": "Base", "native_token": "ETH", "type": "evm" },
    { "slug": "solana", "chain_id": "solana", "name": "Solana", "native_token": "SOL", "type": "solana" },
    { "slug": "sui", "chain_id": "sui", "name": "Sui", "native_token": "SUI", "type": "move" },
    { "slug": "ton", "chain_id": "ton", "name": "TON", "native_token": "TON", "type": "ton" }
  ]
}
```

Source: `api-ts/src/routes/data.ts:66-85`.

### `GET /v1/data/reference/tokens`

| param | required | notes |
|---|---|---|
| `chain` | no | chain slug (`base`, `ethereum`, …) or `solana`/`sol`. Omit to get every chain's registry at once. |

- `chain=solana|sol` → `{ success, chain: "solana", tokens: [{ symbol, address, decimals, name }] }`
- `chain=<evm slug>` → `{ success, chain, chain_id, tokens: [{ symbol, address, decimals }] }`
- no `chain` → `{ success, chains: [{ chain_id, tokens: [...] }, ..., { chain_id: "solana", tokens }] }`

`decimals` for EVM tokens: Tempo (chain id 4217) / Robinhood (4663) overrides
from `TEMPO_TOKEN_DECIMALS`/`ROBINHOOD_TOKEN_DECIMALS`, else 6 for
USDC/USDT-family symbols, else 18 (`api-ts/src/routes/data.ts:87-91`).
Token registry source of truth: `api-ts/src/config/tokenRegistry.ts` (`COMMON_TOKENS`,
`SOLANA_TOKENS`) — 15 EVM chains as of this writing (ethereum, optimism, bsc,
polygon, arbitrum, base, avalanche, tempo, robinhood, plasma, fantom, linea,
mantle, gnosis, scroll — `api-ts/src/services/TokenService.ts:38-210`).

Error: unknown `chain` → 400 `CHAIN_UNSUPPORTED` with `supported` list.

Source: `api-ts/src/routes/data.ts:94-146`.

### `GET /v1/data/reference/resolve`

One endpoint, four modes selected by which params are present:

| mode | params | response shape |
|---|---|---|
| reverse lookup | `address` + `chain` (both required together) | flat: `{ success, symbol, chain, chain_id, address, decimals, coingecko_id }` |
| single symbol, one chain | `symbol` + `chain` | flat, same shape as above |
| single symbol, all chains | `symbol` only | `{ success, symbol, chains: ResolveEntry[] }` — one entry per chain the symbol is known on |
| batch | `symbols=A,B` (+ optional `chain`) | `{ success, symbols: [...], results: { SYMBOL: ResolveEntry[] } }` — with `chain`, each array has 0 or 1 entries; without, each covers every known chain |

`ResolveEntry`: `{ symbol, chain, chain_id, address, decimals, coingecko_id }`.
`coingecko_id` comes from `COINGECKO_IDS` (`api-ts/src/lib/prices.ts`), `null`
if unmapped.

Example — `?symbols=ETH,SOL`:
```json
{
  "success": true,
  "symbols": ["ETH", "SOL"],
  "results": {
    "ETH": [
      { "symbol": "ETH", "chain": "ethereum", "chain_id": 1, "address": "0x00...00", "decimals": 18, "coingecko_id": "ethereum" },
      { "symbol": "ETH", "chain": "base", "chain_id": 8453, "address": "0x00...00", "decimals": 18, "coingecko_id": "ethereum" }
    ],
    "SOL": [
      { "symbol": "SOL", "chain": "solana", "chain_id": "solana", "address": "So1111...", "decimals": 9, "coingecko_id": "solana" }
    ]
  }
}
```

Errors: 400 `VALIDATION_ERROR` (no symbol/symbols/address given, or `address`
given without `chain`), 400 `CHAIN_UNSUPPORTED`, 404 `TOKEN_UNKNOWN`.

Source: `api-ts/src/routes/data.ts:148-302`.

---

## 3. Historical API — `GET /v1/data/history/ohlcv`

| param | required | notes |
|---|---|---|
| `symbol` | one of `symbol`/`symbols` required | single-symbol legacy flat response |
| `symbols` | — | comma-separated, dedup'd, uppercased; triggers the grouped multi-symbol response even with one symbol |
| `chain` | yes | lowercased chain slug |
| `timeframe` | no (default `1h`) | one of `1m`, `5m`, `1h`, `1d` — 400 `VALIDATION_ERROR` otherwise |
| `start`, `end` | no | ISO 8601 string **or** unix timestamp (seconds unless the number exceeds 1e12, then treated as ms) |
| `limit` | no (default 500) | capped to `MAX_LIMIT = 1000` |
| `cursor` | no | opaque, base64 of the last-returned candle's ISO timestamp; pass back `next_cursor` from a previous response to page forward (`gt(ts, cursorTs)`) |
| `format` | no (default `json`) | `json` or `csv` |

### Pagination semantics

Each requested symbol is queried independently with the same `cursor`. If a
symbol's page came back exactly `limit` rows, it's flagged as possibly having
more (`hasMore`). `next_cursor` in the response is the **minimum** last-seen
timestamp across all overflowing symbols — safe (won't skip rows for any
symbol) at the cost of possibly re-returning a few already-seen rows for
symbols that hadn't overflowed yet. (`api-ts/src/routes/data.ts:443-505, 579-585`)

### `external_fallback` behavior

If `market_candles` has zero rows for the (symbol, chain, timeframe) — the
Python capture service hasn't backfilled that pair yet — the route falls back
to a DexScreener search for the symbol, picks the highest-liquidity pair on
the requested chain, and synthesizes a short candle series from its
`priceChange` buckets (`h24`/`h6`/`h1`/`m5`). These synthetic candles carry
`"source": "external_fallback"` and **no pagination** (`hasMore: false`,
`next_cursor` never set for a fallback page). A response note is attached:
`"No persisted candles yet; synthesized from live DexScreener price-change
data (not exact historical OHLCV)."`, or `"...this pair may not be tracked
yet."` if DexScreener also has nothing. (`api-ts/src/routes/data.ts:350-505, 620-631`)

### JSON response — single symbol

```json
{
  "success": true,
  "symbol": "ETH",
  "chain": "base",
  "timeframe": "1h",
  "source": "db",
  "candles": [
    { "ts": "2026-08-13T10:00:00.000Z", "open": "3120.5", "high": "3140.0", "low": "3110.2", "close": "3135.8", "volume": "812345.12", "source": "coingecko" }
  ],
  "next_cursor": "MjAyNi0wOC0xM1QxMDowMDowMC4wMDBa"
}
```

### JSON response — `symbols=` (grouped)

```json
{
  "success": true,
  "chain": "base",
  "timeframe": "1h",
  "symbols": {
    "ETH": { "source": "db", "candles": [ "..." ] },
    "SOL": { "source": "external_fallback", "candles": [ "..." ] }
  },
  "next_cursor": "..."
}
```

### CSV — `format=csv`

`Content-Type: text/csv; charset=utf-8`. `X-Next-Cursor` header set instead
of a body field, when applicable.

```
symbol,chain,timeframe,ts,open,high,low,close,volume,source
ETH,base,1h,2026-08-13T10:00:00.000Z,3120.5,3140.0,3110.2,3135.8,812345.12,coingecko
```

Errors: 400 `VALIDATION_ERROR` (missing symbol/chain, bad timeframe, bad
`start`/`end`/`limit`/`cursor`, bad `format`).

Source: `api-ts/src/routes/data.ts:304-632`.

---

## 4. Live API — `WS /v1/data/live`

Bun WebSocket (`upgradeWebSocket`), authenticated identically to every other
`/v1/data/*` route on the upgrade request. One shared poller per process runs
every `LIVE_POLL_INTERVAL_MS = 2000`ms against `fetchTokenPrices()` (the same
~60s-TTL cache backing `GET /v1/agent/prices`), computed once per poll
regardless of subscriber count. Server pushes are **push-on-change**, plus a
`LIVE_KEEPALIVE_MS = 30000`ms keepalive per symbol/channel when nothing has
changed. This poller and connection-set state are **per-instance** (in
memory, not shared across replicas). (`api-ts/src/routes/data.ts:636-786`)

### On connect

```json
{ "type": "connected", "hint": "Send {\"action\":\"subscribe\",\"symbols\":[\"ETH\"]} for ticks, or {\"action\":\"subscribe\",\"channel\":\"ohlcv\",\"timeframe\":\"1m\",\"symbols\":[\"ETH\"]} for 1m candles" }
```

### Tick channel (default)

Client → server:
```json
{ "action": "subscribe", "symbols": ["ETH", "SOL"] }
{ "action": "unsubscribe", "symbols": ["SOL"] }
```
Server → client:
```json
{ "type": "subscribed", "symbols": ["ETH", "SOL"] }
{ "type": "tick", "symbol": "ETH", "price_usd": 3135.8, "ts": "2026-08-13T10:00:02.000Z" }
{ "type": "unsubscribed", "symbols": ["ETH"] }
```

### Candle channel — 1m OHLCV

Only `timeframe: "1m"` is accepted (else `{"type":"error"}`).

Client → server:
```json
{ "action": "subscribe", "channel": "ohlcv", "timeframe": "1m", "symbols": ["ETH"] }
```
Server → client (on subscribe, if a candle is already in progress, and again
on every price change or minute close):
```json
{ "type": "subscribed", "channel": "ohlcv", "timeframe": "1m", "symbols": ["ETH"] }
{ "type": "candle", "channel": "ohlcv", "timeframe": "1m", "symbol": "ETH", "final": false, "ts": "2026-08-13T10:05:00.000Z", "open": 3130.1, "high": 3135.8, "low": 3129.0, "close": 3135.8 }
{ "type": "candle", "channel": "ohlcv", "timeframe": "1m", "symbol": "ETH", "final": true,  "ts": "2026-08-13T10:05:00.000Z", "open": 3130.1, "high": 3138.2, "low": 3129.0, "close": 3137.5 }
```
`final: true` is emitted exactly once, when the minute boundary rolls over
(the frame for the just-closed minute); every other push for that minute is
`final: false`.

### Errors

```json
{ "type": "error", "message": "Invalid JSON message" }
{ "type": "error", "message": "Only timeframe \"1m\" is supported on the ohlcv channel" }
{ "type": "error", "message": "Unknown action — expected \"subscribe\" or \"unsubscribe\"" }
```

### Worked session

```
connect -> {"type":"connected", "hint": "..."}
send    -> {"action":"subscribe","symbols":["ETH"]}
recv    <- {"type":"subscribed","symbols":["ETH"]}
recv    <- {"type":"tick","symbol":"ETH","price_usd":3135.8,"ts":"..."}      # on change
send    -> {"action":"subscribe","channel":"ohlcv","timeframe":"1m","symbols":["ETH"]}
recv    <- {"type":"subscribed","channel":"ohlcv","timeframe":"1m","symbols":["ETH"]}
recv    <- {"type":"candle","channel":"ohlcv","timeframe":"1m","symbol":"ETH","final":false,...}
...     <- {"type":"tick",...}                                                # ~30s keepalive if unchanged
recv    <- {"type":"candle",...,"final":true}                                 # minute closed
send    -> {"action":"unsubscribe","symbols":["ETH"]}
recv    <- {"type":"unsubscribed","symbols":[]}
```

Source: `api-ts/src/routes/data.ts:634-878`.

---

## 5. Metadata API — dataset coverage + capture freshness

Databento-style metadata surface: what's tracked (`/metadata`) and how fresh
the capture pipeline is (`/status`). Both read `market_candles` with a single
grouped aggregation query — no per-symbol/per-timeframe loop.

### `GET /v1/data/metadata`

| param | required | notes |
|---|---|---|
| `symbol` | no | uppercased; filters to one symbol |
| `chain` | no | lowercased chain slug; filters to one chain |

Groups `market_candles` by `(symbol, chain, timeframe)` in one query
(`count(*)`, `min(ts)`, `max(ts)` per group), then nests the per-timeframe
rows under each `(symbol, chain)` pair. Response is capped at **500
datasets** (`(symbol, chain)` pairs) — narrow with `?symbol=`/`?chain=` to see
more; `total_candles` always reflects every matching row, not just the
returned page.

```json
{
  "success": true,
  "datasets": [
    {
      "symbol": "ETH",
      "chain": "base",
      "timeframes": {
        "1h": { "candles": 4200, "start": "2026-07-14T00:00:00.000Z", "end": "2026-08-13T10:00:00.000Z" },
        "1d": { "candles": 180, "start": "2025-02-15T00:00:00.000Z", "end": "2026-08-13T00:00:00.000Z" }
      }
    },
    {
      "symbol": "SOL",
      "chain": "solana",
      "timeframes": {
        "1h": { "candles": 3100, "start": "2026-07-20T00:00:00.000Z", "end": "2026-08-13T10:00:00.000Z" }
      }
    }
  ],
  "total_candles": 7480,
  "venue_datasets": {
    "perps": { "count": 48210, "start": "2026-07-01T00:00:00.000Z", "end": "2026-08-13T10:04:00.000Z" },
    "predictions": { "count": 91500, "start": "2026-07-01T00:05:00.000Z", "end": "2026-08-13T10:00:00.000Z" },
    "lend": { "count": 6200, "start": "2026-07-01T00:10:00.000Z", "end": "2026-08-13T10:00:00.000Z" }
  }
}
```

`venue_datasets` (Round 5, `docs/plans/market-data-parity.md`) reports
whole-table `count`/`start`/`end` for each of the three venue-sourced tables
(`perp_metrics`, `prediction_snapshots`, `lend_metrics`) — a single
`count(*)`/`min(ts)`/`max(ts)` aggregate query per table, independent of the
`symbol`/`chain` filters above (those only apply to `market_candles`).
`count: 0, start: null, end: null` when a table has no rows yet.

When truncated, the response adds:
```json
{ "truncated": true, "note": "Response truncated to 500 datasets — refine with ?symbol=&chain= to narrow results." }
```

Errors: 500 `INTERNAL` on a DB query failure (no external fallback — this
endpoint only reports on persisted coverage).

### `GET /v1/data/status`

No params. Groups `market_candles` by `(timeframe, source)` in one query
(`max(ts)`, `count(*)` per group), then rolls that up into: the newest candle
per timeframe (across all sources) + its age in seconds, and total candle
counts per `source` across the whole table.

`healthy` is `true` only when the `1m` timeframe's newest candle is less than
**5 minutes** old (`FRESHNESS_HEALTHY_SECONDS = 300`) — a proxy for "is the
Python capture service still writing". Null-safe: an empty table (or a
timeframe with zero rows) reports `latest_ts: null, age_seconds: null` for
that timeframe and `healthy: false`, never throws.

```json
{
  "success": true,
  "timeframes": {
    "1m": { "latest_ts": "2026-08-13T10:04:32.000Z", "age_seconds": 28 },
    "5m": { "latest_ts": "2026-08-13T10:00:00.000Z", "age_seconds": 300 },
    "1h": { "latest_ts": "2026-08-13T10:00:00.000Z", "age_seconds": 300 },
    "1d": { "latest_ts": "2026-08-13T00:00:00.000Z", "age_seconds": 36300 }
  },
  "sources": {
    "coingecko": 812345,
    "geckoterminal": 41200
  },
  "healthy": true,
  "venue_datasets": {
    "perps": { "count": 48210, "latest_ts": "2026-08-13T10:04:00.000Z", "age_seconds": 30, "healthy": true },
    "predictions": { "count": 91500, "latest_ts": "2026-08-13T10:00:00.000Z", "age_seconds": 245, "healthy": true },
    "lend": { "count": 6200, "latest_ts": "2026-08-13T10:00:00.000Z", "age_seconds": 245, "healthy": true }
  }
}
```

Empty-table response (fresh instance, capture not yet run):
```json
{
  "success": true,
  "timeframes": {
    "1m": { "latest_ts": null, "age_seconds": null },
    "5m": { "latest_ts": null, "age_seconds": null },
    "1h": { "latest_ts": null, "age_seconds": null },
    "1d": { "latest_ts": null, "age_seconds": null }
  },
  "sources": {},
  "healthy": false,
  "venue_datasets": {
    "perps": { "count": 0, "latest_ts": null, "age_seconds": null, "healthy": true },
    "predictions": { "count": 0, "latest_ts": null, "age_seconds": null, "healthy": true },
    "lend": { "count": 0, "latest_ts": null, "age_seconds": null, "healthy": true }
  }
}
```

`venue_datasets[name].healthy` compares `age_seconds` against a per-dataset
threshold — **perps < 5 min**, **predictions < 15 min**, **lend < 30 min** —
and is **trivially `true` when `count` is 0** (an empty, not-yet-capturing
dataset never drags down the overall response). The top-level `healthy` is
the AND of the `market_candles` 1m freshness check *and* all three
`venue_datasets[*].healthy` flags.

Errors: 500 `INTERNAL` on a DB query failure.

Both endpoints require auth like every other `/v1/data/*` route (section 1)
and are metered under `/v1/data/metadata` / `/v1/data/status` in
`GET /v1/data/usage`'s `by_endpoint`.

Source: `api-ts/src/routes/data.ts` (METADATA section).

---

## 6. Usage / Metering — `GET /v1/data/usage`

No params. Returns the calling API key/agent's cumulative `/v1/data/*`
request counts.

```json
{
  "success": true,
  "total_requests": 4213,
  "first_seen_at": "2026-07-01T00:00:00.000Z",
  "last_seen_at": "2026-08-13T10:05:02.000Z",
  "by_endpoint": {
    "/v1/data/history/ohlcv": 3900,
    "/v1/data/reference/resolve": 300,
    "/v1/data/usage": 13
  }
}
```

Metering mechanics (`api-ts/src/lib/dataUsage.ts`):
- `recordDataUsage()` increments an **in-memory, per-instance** counter
  synchronously on every `/v1/data/*` request (`usage` map, unbounded
  lifetime, evicted LRU past `MAX_TRACKED_KEYS = 50,000`).
- A write-behind buffer of `(callerKey, route, day)` deltas is flushed to the
  shared Postgres `api_usage_daily` table every **30s**
  (`FLUSH_INTERVAL_MS = 30_000`) via `INSERT ... ON CONFLICT DO UPDATE count = count + delta`.
  If the flush fails, deltas stay buffered and retry next tick — no counts lost, just late.
  This buffer flush timer is `.unref()`'d so it won't hold a short-lived process open.
- `getDataUsage()` reads persisted `api_usage_daily` totals and merges in
  whatever's still unflushed in the buffer; falls back to buffer-only totals
  if the DB read fails. `first_seen_at` always comes from the in-memory entry
  (no DB column for it) and is `null` on a fresh instance until at least one
  request has landed on it.

Source: `api-ts/src/lib/dataUsage.ts:1-246`, `api-ts/src/routes/data.ts:884-889`.

---

## 7. Client SDKs

Both SDKs default `base_url`/`baseUrl` to `https://api.suwappu.bot` and read
the API key from `SUWAPPU_API_KEY` if not passed explicitly.

### Historical OHLCV

```python
# Python — packages/sdk-python/src/suwappu/client.py
from suwappu import create_client

client = create_client(api_key="suwappu_sk_...")
result = await client.get_ohlcv("ETH", "base", timeframe="1h", limit=200)
print(result.source, len(result.candles))

multi = await client.get_ohlcv_multi(["ETH", "SOL"], "base", timeframe="1h")
```
```typescript
// TypeScript — packages/sdk/src/client.ts
import { createClient } from "@suwappu/sdk";

const client = createClient({ apiKey: "suwappu_sk_..." });
const result = await client.getOhlcv({ symbol: "ETH", chain: "base", timeframe: "1h", limit: 200 });
console.log(result.source, result.candles.length);

const multi = await client.getOhlcvMulti({ symbols: ["ETH", "SOL"], chain: "base", timeframe: "1h" });
```

### CSV export

```python
csv_text = await client.get_ohlcv_csv(symbol="ETH", chain="base", timeframe="1d", limit=365)
```
```typescript
const csvText = await client.getOhlcvCsv({ symbol: "ETH", chain: "base", timeframe: "1d", limit: 365 });
```

### Reference resolve

```python
entry = await client.resolve_symbol("ETH", "base")
grouped = await client.resolve_symbols(["ETH", "SOL"])           # all-chains, grouped
reverse = await client.resolve_address("0xC02aaA...", "ethereum") # address -> symbol
```
```typescript
const entry = await client.resolveSymbol("ETH", "base");
const grouped = await client.resolveSymbols(["ETH", "SOL"]);
const reverse = await client.resolveAddress("0xC02aaA...", "ethereum");
```

### Dataset metadata + capture status

```python
metadata = await client.get_data_metadata(symbol="ETH", chain="base")  # both optional
print(metadata.total_candles, [d.symbol for d in metadata.datasets])

status = await client.get_data_status()
print(status.healthy, status.timeframes["1m"].age_seconds)
```
```typescript
const metadata = await client.getDataMetadata({ symbol: "ETH", chain: "base" }); // both optional
console.log(metadata.totalCandles, metadata.datasets.map((d) => d.symbol));

const status = await client.getDataStatus();
console.log(status.healthy, status.timeframes["1m"]?.ageSeconds);
```

### Perps / predictions / lend (Round 5)

```python
markets = await client.get_perps_markets(venue="hyperliquid")  # venue optional
history = await client.get_perps_history("BTC", venue="hyperliquid", limit=200)

predictions = await client.get_prediction_markets(q="election", limit=20)
odds = await client.get_prediction_history("0xmarket...", outcome="YES")
all_outcomes = await client.get_prediction_history("0xmarket...")  # -> .outcomes

lend_markets = await client.get_lend_markets(chain_id=8453)
lend_history = await client.get_lend_history("0xmorphomarket...", limit=200)
```
```typescript
const markets = await client.getPerpsMarkets("hyperliquid"); // venue optional
const history = await client.getPerpsHistory({ symbol: "BTC", venue: "hyperliquid", limit: 200 });

const predictions = await client.getPredictionMarkets({ q: "election", limit: 20 });
const odds = await client.getPredictionHistory({ marketId: "0xmarket...", outcome: "YES" });
const allOutcomes = await client.getPredictionHistory({ marketId: "0xmarket..." }); // -> .outcomes

const lendMarkets = await client.getLendMarkets({ chainId: 8453 });
const lendHistory = await client.getLendHistory({ marketId: "0xmorphomarket...", limit: 200 });
```

See sections 9-11 below for full endpoint reference.

### Live tick subscription

```python
live = await client.subscribe_live(
    ["ETH", "SOL"],
    on_tick=lambda t: print(t.symbol, t.price_usd),
)
# requires: pip install "suwappu[live]"
await live.subscribe(["BTC"])
await live.close()
```
```typescript
const live = client.subscribeLive({
  symbols: ["ETH", "SOL"],
  onTick: (tick) => console.log(tick.symbol, tick.priceUsd),
});
live.subscribe(["BTC"]);
live.close();
```

### Live candle subscription

```python
live = await client.subscribe_live(
    ["ETH"], on_tick=lambda t: None,
    candle_symbols=["ETH"],
    on_candle=lambda c: print(c.symbol, c.close, c.final),
)
```
```typescript
const live = client.subscribeLive({
  symbols: ["ETH"],
  onTick: () => {},
  candleSymbols: ["ETH"],
  onCandle: (c) => console.log(c.symbol, c.close, c.final),
});
```

Source: `packages/sdk/src/client.ts:532-846`, `packages/sdk-python/src/suwappu/client.py:445-699`.

---

## 8. Data coverage

**Chains** — 15 EVM chains via `CHAINS`/`COMMON_TOKENS` (ethereum, optimism,
bsc, polygon, arbitrum, base, avalanche, tempo, robinhood, plasma, fantom,
linea, mantle, gnosis, scroll — `api-ts/src/services/TokenService.ts:38-210`)
plus Solana (`SOLANA_TOKENS`); `sui` and `ton` are listed by
`/reference/chains` but have no token registry entries in `tokenRegistry.ts`
(reference/tokens and resolve will return empty/404 for them).

**Candle retention / backfill tiers** (Python capture service,
`bot/services/market_data.py`):

| tier | timeframe | backfill depth |
|---|---|---|
| 1 | `1d` | ~365 days |
| 2 | `1h` | ~30 days |
| 3 | `1m` | ~24 hours |

Live capture then polls every ~60s, aggregates ticks into 1m candles, and
rolls completed 1m candles up into 5m/1h/1d rows periodically
(`bot/services/market_data.py`).

**`source` field semantics** — `market_candles.source`:
- `coingecko` — live capture writes (`CAPTURE_SOURCE`, `bot/services/market_data.py`)
- `geckoterminal` — one-time startup backfill (`BACKFILL_SOURCE`, `bot/services/market_data.py`)
- `external_fallback` — synthesized at request time by the api-ts route when
  `market_candles` has no rows yet (`api-ts/src/routes/data.ts:416`)
- `db` — not a candle-level `source` value; it's the top-level `OhlcvResult.source`
  discriminator meaning "these candles came from the DB" (as opposed to
  `external_fallback` for the whole result)

`dexscreener` appears only as the upstream API called for the
`external_fallback` synthesis, not as a `market_candles.source` value written
by capture.

---

## 9. Perps API — `perp_metrics`

Round 5 (`docs/plans/market-data-parity.md`) — funding rate / open interest /
mark & index price / 24h volume, captured every 60s from Hyperliquid REST
`metaAndAssetCtxs` (`bot/services/hyperliquid_client.py`). Unique key
`(venue, symbol, ts)`.

### `GET /v1/data/perps/markets`

| param | required | notes |
|---|---|---|
| `venue` | no | lowercased; omit for every venue |

Latest `perp_metrics` row per `(venue, symbol)` in one query
(`selectDistinctOn` on `(venue, symbol)` ordered by `ts desc`).

```json
{
  "success": true,
  "venues": ["hyperliquid"],
  "markets": [
    {
      "venue": "hyperliquid",
      "symbol": "BTC",
      "ts": "2026-08-13T10:04:00.000Z",
      "funding_rate": "0.0000125",
      "open_interest": "812345000",
      "mark_price": "95210.5",
      "index_price": "95198.2",
      "volume_24h": "4821000000"
    }
  ]
}
```

### `GET /v1/data/perps/history`

| param | required | notes |
|---|---|---|
| `symbol` | yes | uppercased |
| `venue` | no (default `hyperliquid`) | lowercased |
| `start`, `end` | no | ISO 8601 string or unix timestamp (same parsing as `history/ohlcv`) |
| `limit` | no (default 500) | capped to 1000 |
| `cursor` | no | opaque, base64 last-returned `ts` — pass back `next_cursor` to page forward |

```json
{
  "success": true,
  "symbol": "BTC",
  "venue": "hyperliquid",
  "metrics": [
    {
      "ts": "2026-08-13T10:04:00.000Z",
      "funding_rate": "0.0000125",
      "open_interest": "812345000",
      "mark_price": "95210.5",
      "index_price": "95198.2",
      "volume_24h": "4821000000"
    }
  ],
  "next_cursor": "MjAyNi0wOC0xM1QxMDowNDowMC4wMDBa"
}
```

Errors: 400 `VALIDATION_ERROR` (missing `symbol`, bad `start`/`end`/`limit`/`cursor`).

Source: `api-ts/src/routes/data.ts` (PERPS section).

---

## 10. Predictions API — `prediction_snapshots`

Round 5 — implied-probability odds snapshots, captured every 5 minutes for the
top ~100 active markets by volume from Polymarket Gamma
(`bot/services/polymarket_api.py`). Unique key `(venue, market_id, outcome, ts)`.

### `GET /v1/data/predictions/markets`

| param | required | notes |
|---|---|---|
| `q` | no | case-insensitive substring match on `question` (ILIKE) |
| `limit` | no (default 50) | capped to 200 |

Latest `prediction_snapshots` row per `(market_id, outcome)` — one
`selectDistinctOn` query ordered by `(market_id, outcome, ts desc)`, then
sorted by `volume` desc and capped in application code (Postgres requires
`DISTINCT ON`'s leading `ORDER BY` columns to match its distinct columns, so
the volume-desc ordering can't be pushed into the same query).

```json
{
  "success": true,
  "markets": [
    {
      "venue": "polymarket",
      "market_id": "0xmarket...",
      "condition_id": "0xcondition...",
      "question": "Will X happen by 2026?",
      "outcome": "YES",
      "ts": "2026-08-13T10:00:00.000Z",
      "price": "0.62",
      "volume": "5120000",
      "liquidity": "180000",
      "end_date": "2026-12-31T00:00:00.000Z"
    }
  ]
}
```

### `GET /v1/data/predictions/history`

| param | required | notes |
|---|---|---|
| `market_id` | yes | |
| `outcome` | no | omit to get every outcome for the market, grouped |
| `start`, `end` | no | same parsing as `history/ohlcv` |
| `limit` | no (default 500) | capped to 1000 |
| `cursor` | no | opaque, base64 last-returned `ts` |

With `outcome` — flat time series:
```json
{
  "success": true,
  "market_id": "0xmarket...",
  "outcome": "YES",
  "history": [
    { "ts": "2026-08-13T10:00:00.000Z", "price": "0.62", "volume": "5120000", "liquidity": "180000" }
  ]
}
```

Without `outcome` — grouped by outcome (single flat query over the market,
shared `limit`/`cursor` across all outcomes, grouped in application code —
the same pattern `/metadata` uses to group `market_candles`):
```json
{
  "success": true,
  "market_id": "0xmarket...",
  "outcomes": {
    "YES": [{ "ts": "2026-08-13T10:00:00.000Z", "price": "0.62", "volume": "5120000", "liquidity": "180000" }],
    "NO":  [{ "ts": "2026-08-13T10:00:00.000Z", "price": "0.38", "volume": "3200000", "liquidity": "95000" }]
  }
}
```

Errors: 400 `VALIDATION_ERROR` (missing `market_id`, bad `start`/`end`/`limit`/`cursor`).

Source: `api-ts/src/routes/data.ts` (PREDICTIONS section).

---

## 11. Lend API — `lend_metrics`

Round 5 — supply/borrow APY, TVL, utilization, captured every 10 minutes from
Morpho GraphQL (`bot/services/morpho_api.py`). Unique key `(venue, market_id, ts)`.

### `GET /v1/data/lend/markets`

| param | required | notes |
|---|---|---|
| `chain_id` | no | numeric; filters to one chain |

Latest `lend_metrics` row per `market_id` in one query (`selectDistinctOn` on
`market_id` ordered by `ts desc`).

```json
{
  "success": true,
  "markets": [
    {
      "venue": "morpho",
      "market_id": "0xmorphomarket...",
      "chain_id": 8453,
      "loan_symbol": "USDC",
      "collateral_symbol": "WETH",
      "ts": "2026-08-13T10:00:00.000Z",
      "supply_apy": "0.0512",
      "borrow_apy": "0.0834",
      "tvl": "42100000",
      "utilization": "0.61"
    }
  ]
}
```

### `GET /v1/data/lend/history`

| param | required | notes |
|---|---|---|
| `market_id` | yes | |
| `start`, `end` | no | same parsing as `history/ohlcv` |
| `limit` | no (default 500) | capped to 1000 |
| `cursor` | no | opaque, base64 last-returned `ts` |

```json
{
  "success": true,
  "market_id": "0xmorphomarket...",
  "metrics": [
    { "ts": "2026-08-13T10:00:00.000Z", "supply_apy": "0.0512", "borrow_apy": "0.0834", "tvl": "42100000", "utilization": "0.61" }
  ],
  "next_cursor": null
}
```

Errors: 400 `VALIDATION_ERROR` (missing `market_id`, bad `chain_id`/`start`/`end`/`limit`/`cursor`).

Source: `api-ts/src/routes/data.ts` (LEND section).

All three surfaces above share auth (section 1) and metering
(`/v1/data/perps/markets`, `/v1/data/perps/history`,
`/v1/data/predictions/markets`, `/v1/data/predictions/history`,
`/v1/data/lend/markets`, `/v1/data/lend/history` are all in the
`KNOWN_DATA_ROUTES` metering allowlist).
