# Trading Product Essentials — Gap Analysis & Plan

Framework: a trading product needs (1) asset discovery, (2) actions, (3) position
management — plus reliability/speed/liveness underneath. Miss one and the product
falls apart.

This plan audits Suwappu against that framework. **Verified against code on
2026-08-12** — every claim below carries a `file:line` anchor.

---

## The core diagnosis: the data layer is built, the mass-market surface is starved

Suwappu has three frontends:

| Surface | Audience | Discovery | Actions | Manage |
|---|---|---|---|---|
| `terminal/` | Desktop pro | Rich | Rich | Rich |
| `bot/` (Telegram) | Mass market | Thin | **Strongest** | Medium |
| `webapp/` (Mini App) | Mass market | **Broken** | Navigates away | Medium |

`api/routes/terminal.py` already exposes a genuinely strong data layer:

- `/chart/ohlcv` (terminal.py:172) — real candles, Coinbase for ETH/USDC,
  GeckoTerminal pool OHLCV for any other token
- `/perps/whales` (terminal.py:386) — top-trader leaderboard (**this is the "edge"**)
- `/signals` (terminal.py:643), `/market/regime` (terminal.py:567)
- `/token/safety` (terminal.py:1020) — EVM + Solana safety scoring
- `/discovery/final-stretch` (terminal.py:1106) — near-graduation launches

**Zero files under `webapp/src/` call any of it.** The Mini App re-implements a
worse version client-side. This is not a "build more features" problem. It is a
wiring problem, and it is the single highest-leverage thing in this repo.

---

## 1) Asset discovery — the weakest pillar

### P0-1. The chart is dead. `webapp/src/hooks/useChart.ts:88`

```ts
export function useTokenChart(chain, address, timeframe) {
  return useQuery({ queryFn: async () => {
    // DexScreener doesn't provide candle data via public API
    return { candles: [] }        // <-- hardcoded, always
  }})
}
```

`TokenDetail.tsx:67` renders `<TokenChart>` with this. Every token page in the
Mini App shows **"No chart data available"**, permanently. The timeframe selector
(5m/15m/1h/4h/1d) renders and does nothing.

The backend that fixes this already exists at `terminal.py:172`. Point the hook at
it. This is the cheapest, highest-visibility fix in the plan.

### P0-2. "Trending" is a text search for the word "trending". `useChart.ts:44`

```ts
`${DEXSCREENER_API}/search?q=trending`
```

This is a literal full-text query for the string `trending` — it returns pairs
whose *name* matches, not trending tokens. The Mini App's discovery feed is
effectively random. `/discovery/final-stretch` (terminal.py:1106) and `/signals`
(terminal.py:643) are the real feeds and already exist.

### P0-3. DexScreener is called direct from the client

`useChart.ts:41` — the browser hits `api.dexscreener.com` with no key, no
caching, no rate-limit handling, no CORS guarantee. Move behind our API so it is
cached, keyed, and monitorable.

### P1-4. Token detail is data-poor. `TokenDetail.tsx:97-110`

Shows exactly three numbers: mcap, 24h volume, liquidity. Meanwhile we **already
compute** and show nowhere on mobile:

- holder concentration + top-10 distribution — `bot/services/token_intel/intel_service.py:58`
- deployer profile, prior deploys, dead deploys — `intel_service.py:52`
- token age (`pair_created_at`) — `intel_service.py:65`
- security score 0–100 + honeypot / mint-authority / freeze-authority flags —
  `bot/services/token_security/token_analyzer.py:81`, `terminal.py:1020`

Traders read density as competence; three stat tiles reads as a toy. *Never kill
data points for the sake of simplicity.* Fill the grid — the data is already there.

### P1-5. No edge feature in the Mini App

We have **two** edge engines and neither reaches the Mini App:

- `/traders` top-trader leaderboard — `bot/handlers/copy.py:49`
- copy trading + live follow feed — `copy_service.py`, `terminal/src/components/copy/CopyTradingDashboard.tsx:20`
- `/perps/whales` whale ranking — `terminal.py:386`

*Everyone needs an edge, or at least the illusion of one.* We compute the edge
and show it to nobody on mobile.

**Missing entirely:** X/Twitter account tracking and labelled-wallet ("smart
money") tracking — the gmgn wedge. `terminal/src/components/tracker/WalletTrackerPanel.tsx:24`
is Solana-only, client-side Helius, and its persistent backend is stubbed.

### P1-6. Static token list is a discovery ceiling

`bot/config/tokens.py` — **151 tokens, hardcoded**, stablecoin-heavy, across
`bot/config/chains.py` — 46 chains. The brief: *more assets you surface = more
they'll trade.* A static 151-token list cannot surface the long tail that
actually gets traded. Needs dynamic token resolution from a registry.

### P1-7. No personalized feed

`bot/handlers/favorites.py` + watchlists exist; `CopyFeed.tsx` is the only
feed-shaped thing and it only covers followed wallets. Nothing assembles "your
tokens moved". Largest unexplored surface per the brief — P1, not P0, because it
needs the above wired first.

---

## 2) Trading actions — closest to correct, one structural flaw

### P0-7. Presets navigate away instead of trading. `TokenDetail.tsx:128`

```ts
onClick={() => navigate(`/swap?to=${address}&chain=${chain}&amount=${amount}`)}
```

The brief's rule is *<5s, one click, casino-slot simple*. Today: tap preset →
full route change → swap page → re-quote → confirm. The preset buttons look like
one-click buy and are not. Execute in place with an inline confirm.

### P0-8. Presets are hardcoded and chain-wrong. `TokenDetail.tsx:54`

```ts
const BUY_PRESETS = ['0.01', '0.05', '0.1', '0.5']   // hardcoded
<p>Buy with ETH</p>                                   // line 121 — always "ETH"
```

On Solana, BSC, or any of the 45 supported chains, the UI still says "Buy with
ETH". Presets must be per-chain, denominated in the chain's gas token (or a
stable), and **user-editable** — Axiom's preset model is the reference.

### P1-9. Alerts stop one step short of the trade. `bot/services/alerts.py:285`

A triggered price alert renders a **"💱 Review & Sign" deep link** — not a buy or
sell button. The brief: *any info, including alerts, should lead with an action
CTA.* The user has conviction at exactly that moment and we hand them a
navigation step. Make it `[Buy 0.1] [Buy 0.5] [Sell 50%]` inline on the alert.

### P1-10. No optimistic feedback

The webapp does show a success toast and polls `signed → submitted → completed`
(`webapp/src/pages/Swap.tsx:145`), which is better than nothing — but there is
**no sound, no haptics, and no optimistic fill marker on the chart**.
`AnimatedNumber.tsx` exists in `components/swap/` — the primitive is there, the
dopamine loop is not. Telegram Mini Apps expose `HapticFeedback` for free.

### Optionality — mostly fine, two real gaps

Limit orders, trailing stop, DCA, snipe, perps (HyperLiquid), and prediction
markets (Polymarket YES/NO) all exist — `bot/services/orders.py:13,39`,
`bot/handlers/snipe.py`, `perps.py`, `predict.py`. Webapp has matching
`LimitOrders.tsx` / `DCA.tsx` / `PerpsMarkets.tsx` / `PredictionMarkets.tsx`
pages. Optionality is broadly preserved. But:

- **Perps TP/SL has no UI.** `PerpPosition.tp_price` / `sl_price` exist in the DB
  (`bot/models/perps.py:26`) with no handler to set them. Also flagged as
  `F2 [SUW-197]` in `/goal`.
- **No % sell presets** anywhere in the bot (25/50/100%) — only the Mini App's
  `TokenDetail.tsx:55` has them, and those navigate away.

---

## 3) Manage assets — the strongest pillar, with liveness gaps

**Genuinely good already:** `bot/handlers/positions.py` is a unified spot + perps
+ predictions + orders hub with cost basis (`UserPosition.cost_usd`), realized
**and** unrealized PnL (`positions.py:78-99`), and — for perps — liquidation
price (`positions.py:117`) and leverage (`positions.py:121`). Risk visibility on
perps is real. Perps are monitored live: `perps_monitor.py:18` polls every 10s
and `hl_ws_alerts.py:26` streams fills/liquidations/funding over WebSocket.

### P1-11. Spot positions do not move (perps do)

`usePortfolioPnl.ts:7` uses `staleTime: 60_000` with **no `refetchInterval`** —
spot portfolio numbers sit frozen until a manual refetch. `refetchInterval`
appears in only 6 places in `webapp/src/`; `LaunchFeed.tsx:117` at 10s is the
fastest thing in the app. The brief: *users need to feel positions changing every
second.* The perps path proves we can do this; spot just isn't wired to it.

### P1-11b. No unified exposure view, no liquidation warning on mobile

Spot is grouped by chain and perps by market, but nothing aggregates total
notional/leverage exposure. Liquidation alerts exist only as HL WebSocket pushes
to Telegram — the **webapp shows no liquidation warning at all**. *Traders love
risk but hate being surprised by it.*

### P1-12. Chart cannot tick

`TokenChart.tsx:64` — the `useEffect` dependency array includes `data`, so every
price update **destroys and recreates the entire chart**, losing zoom and pan.
Correct fix: create the chart once, then `series.update()` on new candles.

### P2-13. Chart is light-mode only

`TokenChart.tsx:22-32` hardcodes `background: '#ffffff'` and slate grid colors. In
a dark Telegram theme this is a white slab. Traders are dark-mode natives.

### P1-14. Adjusting a position is not "dead simple"

*Users constantly change their mind as markets move.* Today: no % sell presets in
the bot, no perps TP/SL UI (P1-Optionality above), and editing a resting limit
order is `/orders`-only and PRO+ gated (`bot/handlers/limit_orders.py:42`).

---

## 4) Reliability / liveness

- **Staleness is invisible — the most dangerous gap here.** Prices are cached
  with a 60s TTL (`bot/utils/cache.py:25`) and nothing anywhere shows "last
  updated". The brief is blunt: *stale data is more dangerous than no data.* A
  minute-old number rendered as if it were live is the worst failure mode a
  trading app has, and it is currently our default on every spot surface.
- **Good:** `health_monitor.py:35` (10% failure threshold, 5min cooldown),
  perps-monitor heartbeat with 90s Redis TTL (`perps_monitor.py:54`), and recent
  commits #828/#829 show the uptime probe is actively maintained.
- **Growth loops already exist** — referrals (`referral_service.py`), XP/points
  (`points_service.py`), seasons with anti-farm caps (`seasons_service.py`),
  battles, copy trading. Correctly sequenced *after* the core loop, per the brief.
  **Do not invest here until 1–3 are fixed** — compounding a leaky loop wastes it.

---

## Sequenced plan

**Phase 0 — make the Mini App tell the truth (highest leverage)**
1. Wire `useTokenChart` → `/chart/ohlcv` (kills the dead chart)
2. Replace fake trending → `/discovery/final-stretch` + `/signals`
3. Proxy DexScreener through our API

**Phase 1 — make it one-click**
4. Execute presets in place, no route change
5. Per-chain, user-editable presets; fix the "ETH" label bug
6. Optimistic fill + haptics

**Phase 2 — make it dense and alive**
7. `refetchInterval` on spot prices/portfolio; `series.update()` instead of chart rebuild
8. Fill token detail from existing intel: holders, top-10 %, deployer, age, safety score
9. Top-trader / whale leaderboard on mobile
10. Dark-mode chart; **staleness indicators everywhere**

**Phase 3 — close the optionality & risk gaps**
11. Perps TP/SL UI (`SUW-197`); % sell presets in bot
12. Unified exposure view + liquidation warning in webapp
13. Alert → inline buy/sell CTA (`alerts.py:285`)

**Phase 4 — edge & coverage**
14. Watchlist-driven personalized feed
15. Dynamic token resolution (break the 151-token ceiling)
16. X/Twitter + labelled-wallet tracking (the gmgn wedge)

---

## Ground rules for execution

- Items 1–3 and 7 are **pure wiring** — backend exists, no new product decisions.
- Anything touching swap execution or presets is **MONEY-PATH** → `money-path-reviewer`
  before merge.
- Every fix needs live verification on the deployed URL, not CI green
  (CLAUDE.md standing rule #2).
