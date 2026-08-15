# markets.xyz Feature Parity — Gap Analysis (Aug 2026)

**What markets.xyz is:** "Markets" by Kinetiq — a self-custodial perpetuals exchange app
(iOS/Android/web) built on Hyperliquid's HIP-3 framework. 24/7 perps on equities, FX,
commodities, bonds, and crypto. It is NOT a DEX swap bot: no cross-chain swaps, no sniping,
no Telegram surface. Suwappu's core niche is untouched; parity work is about absorbing
their perps/social wedge, not copying the product.

## Parity matrix

| markets.xyz feature | Suwappu status | Gap |
|---|---|---|
| Crypto perps (Hyperliquid) | ✅ `bot/handlers/perps.py`, `perps_monitor.py`, webapp Perps pages | — |
| **RWA perps: equities/FX/commodities/bonds (HIP-3 builder markets)** | ❌ crypto-only perps; `/stocks` is spot tokenized equities | **GAP 1 (core wedge)** |
| Order types: market, limit, stop, **TWAP, scale** | Spot has limit/DCA/trailing; perps order-type coverage TBD | **GAP 2** |
| TP/SL, isolated margin, liq monitoring | Liq monitoring ✅ (`perps_monitor.py`); TP/SL on perps TBD | GAP 2b |
| **Verified social trading feed** (posts tied to real fills) | Partial: copy trading + `/cards` position proofs; no feed surface | **GAP 3** |
| TradingView charts | ✅ `/chart`, webapp charts, `data.ts` ticker | — |
| Integrated news feed | ❌ (digest service exists, not market news) | GAP 4 (low) |
| Points program (kPoints) | ✅ XP/seasons/leaderboards | — |
| Referral fee-share (up to 15%) | ✅ `referral_service.py` fee rebates | — |
| Self-custody + social login | ✅ (bot custody model differs by design) | — |
| Mobile app | ⚠️ Expo MVP | existing known gap, out of scope here |

## Suwappu advantages markets.xyz lacks
Cross-chain swaps (40+ chains, 8 engines), sniping, copy trading, prediction markets,
Telegram/WhatsApp surfaces, token security scanning, bridging, lending/savings, P2P.

## Implementation plan (this branch)
1. **GAP 1 — HIP-3 / RWA perps markets**: extend Hyperliquid integration to enumerate
   builder-deployed (HIP-3) perp dexs and their markets (equities, FX, commodities, bonds);
   surface them in `/perps` market selection and `api-ts` perps routes so webapp Perps
   pages list them. 24/7 RWA perps become tradeable from Telegram — something markets.xyz
   itself doesn't offer.
2. **GAP 2 — perps order types**: add TWAP and scale (laddered) entry orders + TP/SL
   attach flow to the perps handler, reusing the existing order-service patterns.
3. **GAP 3 — verified trade feed**: `/feed` — recent real fills from opted-in traders
   (data already captured by copy-trading/position services), shareable, with follow/copy
   entry points. Webapp Feed page after bot surface proves out.
4. **GAP 4 — news** (deferred unless time allows): market-news section in digest service.

Unconfirmed research points (do not state as fact in marketing copy): markets.xyz exact
leverage cap (40x vs 50x), fee schedule, fiat onramp, Dexari/Kinetiq relationship.
