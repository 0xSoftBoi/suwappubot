# Market Data Platform — Databento-Style Feature Parity

Goal: give Suwappu the same service shape Databento's architecture diagram shows —
**capture → normalize → store → distribute**, exposed as **Historical**, **Live**, and
**Reference** APIs with **Python + TypeScript client SDKs** and per-key usage metering.
Translated to our domain: venues = chains/DEX aggregators (CoinGecko, DexScreener,
GeckoTerminal, Li.Fi); colocation/extranet analog = our per-chain RPC + aggregator
connections.

Audit baseline (Aug 2026): REST-only pass-through pricing, no persisted OHLCV, no
WebSocket streams (roadmap Phase 4 gap), token metadata scattered
(bot/config/tokens.py, agent.ts COMMON_TOKENS/SOLANA_TOKENS, Li.Fi on demand).

## Architecture

```
capture (Python bot/services/market_data.py, async task in api/main.py lifespan)
   └─ polls CoinGecko/DexScreener per tracked token → normalizes → writes candles
storage (shared Postgres)
   └─ market_candles table — SQLAlchemy model + Drizzle schema + _ensure_schema()
distribution (api-ts, /v1/data/*)
   ├─ Reference: GET /v1/data/reference/tokens, /chains, /resolve?symbol=
   ├─ Historical: GET /v1/data/history/ohlcv?symbol&chain&timeframe&start&end
   │     └─ serves from DB; falls back to GeckoTerminal/DexScreener when DB is sparse
   └─ Live: WS /v1/data/live — subscribe {symbols[]} → price ticks (Bun WebSocket)
clients (packages/sdk, packages/sdk-python)
   └─ get_ohlcv(), get_reference(), resolve_symbol(), live subscribe (WS)
metering: per-API-key request counters on /v1/data/* (existing key middleware)
```

## Normalized schema — `market_candles`

| column | type | note |
|--------|------|------|
| id | bigserial PK | |
| symbol | text | uppercase, e.g. ETH |
| chain | text | chain slug from bot/config/chains.py |
| token_address | text nullable | canonical address on that chain |
| timeframe | text | `1m`,`5m`,`1h`,`1d` |
| ts | timestamptz | candle open time, UTC |
| open/high/low/close | numeric(38,18) | USD |
| volume | numeric(38,18) nullable | |
| source | text | `coingecko`/`dexscreener`/`geckoterminal` |

Unique: `(symbol, chain, timeframe, ts)`. Index: `(symbol, chain, timeframe, ts DESC)`.
Additive + idempotent per docs/development/migrations.md.

## Phases

1. **Schema** (db-migrate): model in `bot/models/market_data.py`, Drizzle
   `api-ts/src/db/schema/marketCandles.ts`, `_ensure_schema()` DDL.
2. **Capture** (bot-dev): `bot/services/market_data.py` — poll tracked tokens
   (union of bot/config/tokens.py + active alert tokens) every 60s, aggregate into
   1m candles, roll up 5m/1h/1d; register in api/main.py lifespan next to
   alert_service; backfill 30d of 1h candles on first run from GeckoTerminal.
3. **Distribution** (api-ts-dev): reference + historical routes; WS live stream
   backed by 5s in-process poll of the shared price cache; reference registry
   consolidates COMMON_TOKENS/SOLANA_TOKENS + bot token list (exported JSON).
4. **SDKs** (sdk-dev): TS + Python methods incl. WS subscribe helper.
5. **Tests** (test-engineer): candle rollup unit tests, route tests, SDK smoke.
6. **Verify**: parse gates, `bun run check`, pytest, scripts/verify.sh.

Non-goals (explicit scope cuts — surfaced, not silent): no colocation/raw feed
capture (we have no venue extranet analog beyond RPCs), no C++/Rust SDKs, no
tick-level trade capture, no paid billing integration (metering counters only).
