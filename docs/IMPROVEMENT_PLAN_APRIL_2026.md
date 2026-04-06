# Suwappu Improvement Plan — April 2026

**Date**: April 6, 2026  
**Scope**: Post-audit action items derived from deep codebase audit, API gap analysis, and competitive research.

---

## Priority 1: Critical Integration Gaps (Must-Fix)

These are features that are *built but not wired up* — highest ROI since most of the code exists.

### 1.1 API-TS Missing Endpoints

The webapp and mobile app call endpoints that **do not exist** in api-ts. Until these are built, chart/discovery/send features are dead on arrival.

| Endpoint | Consumer | Effort | Notes |
|----------|----------|--------|-------|
| `GET /webapp/chart/{symbol}` | PriceChart.tsx | Medium | OHLCV data — proxy to Birdeye (Solana) or CoinGecko. Return `{candles: [{time,open,high,low,close}]}` |
| `GET /webapp/token/{symbol}` | TokenDetail.tsx | Medium | Aggregate price + GoPlus safety. Return `{symbol,name,price,change24h,marketCap,volume24h,chain,address,safetyScore,safetyLevel,warnings}` |
| `POST /v1/wallet/send` | mobile send.tsx | High | Turnkey signing flow. Accept `{recipient,token,amount,chain}`, build TX, sign via Turnkey, broadcast |
| `GET /v1/discover/trending` | mobile useTokenDiscovery | Medium | Wrap CoinGecko trending + Birdeye volume leaders. Cache 60s |
| `GET /v1/discover/gainers` | mobile useTokenDiscovery | Low | CoinGecko market data sorted by 24h change |
| `GET /v1/discover/new` | mobile useTokenDiscovery | Medium | Birdeye new pools + DexScreener new pairs |
| `GET /v1/discover/search` | mobile useTokenDiscovery | Low | Proxy to existing `/webapp/tokens/search` |
| `GET /v1/tokens/price` | mobile useTokenPrice | Medium | OHLCV candle data for charts |

### 1.2 Webapp Wiring

| Item | File | Fix |
|------|------|-----|
| TokenDetail not in router | `webapp/src/App.tsx` | Add route: `<Route path="/token/:symbol" element={<TokenDetail />}` |
| lightweight-charts not installed | `webapp/package.json` | `npm install lightweight-charts` |
| DCA page files missing | `webapp/src/pages/` | Create `DCA.tsx` and `DCACreate.tsx` — routes already defined |

### 1.3 Bot Integration Gaps

| Item | File | Fix |
|------|------|-----|
| `/discover` not in command menu | `bot/main.py` post_init | Add `BotCommand("discover", "Discover trending tokens")` |
| Quick Buy not in main menu | `bot/handlers/start.py` | Add quickbuy + discover buttons to main_menu_callback keyboard |
| DB migrations missing | `database/db.py` | Add `_ensure_schema` entries for: `mev_protection_enabled`, `jito_tip_priority`, `trailing_percent`, `peak_price`, `referral_level`, `is_kol`, `custom_l1_rate` |
| Trailing stop UI incomplete | `bot/handlers/limit_orders.py` | Add trailing stop flow: user enters %, model stores trailing_percent, uses existing OrderType.TRAILING_STOP |

---

## Priority 2: High-Impact New Features

Based on competitive analysis — these are features competitors have that we don't.

### 2.1 Smart Money / Wallet Tracking

**Why**: GMGN.ai and Maestro's strongest differentiator. Users follow top wallets and copy their moves.

**What to build**:
- `bot/services/wallet_tracker.py` — Monitor a list of whale/KOL wallets on-chain via websockets
- `GET /v1/discover/smart-money` — Surface recent buys by tracked wallets
- Telegram handler: `/track <address>` — Add wallet to watchlist, get alerts on swaps
- Webapp: Add "Smart Money" tab to discovery page

**Data sources**: Birdeye (Solana), Etherscan (EVM), Dune Analytics for KOL wallets.

**Effort**: Large (1-2 weeks). Core infrastructure is on-chain indexing.

### 2.2 EVM MEV Protection (Flashbots Integration)

**Why**: `flashbots.py` exists but is **never used in swap execution**. User's `mev_protection_enabled` setting is silently ignored for EVM swaps.

**What to build**:
- In `swap_engine.py` `_execute_socket_swap` and LiFi execution: when user has MEV protection enabled, replace `chain.rpc_url` with `get_mev_protected_rpc(chain)` for tx submission
- Add Flashbots `eth_sendPrivateTransaction` for direct tx submission where available
- Show MEV protection status in swap confirmation ("🛡️ Sent via private mempool")

**Effort**: Small-Medium. The RPC endpoints exist, just need to wire them into execution.

### 2.3 PnL Card Sharing Handler

**Why**: `pnl_card.py` generates beautiful PnL images but there's no direct way to trigger them from the bot beyond history share.

**What to build**:
- `/pnl <token>` command — Generate and send PnL card for a position
- `/pnl` (no args) — Generate portfolio PnL card
- Add share button that sends image to chat for easy social sharing
- Add "Share to Twitter" deep link in card footer

**Effort**: Small. Image generation exists, just needs a handler.

### 2.4 Revenue Sharing / Fee Tokenomics

**Why**: Banana Gun's 40% fee-share to token holders drives loyalty and volume. BONKbot, Photon, GMGN have no sharing and face churn.

**What to build**: Design study only — evaluate:
- Fee distribution to referrers (already 25%/5%/2% via multi-tier)
- Staking mechanism for fee discount (10-25% off swap fees)
- Revenue share to active traders (volume-based cashback tiers)

**Effort**: Research/design phase. Implementation depends on tokenomics decisions.

### 2.5 Gamification Arena (Trojan-Style)

**Why**: Trojan's "Arena" with $5M prize pool drives massive engagement. We have points/XP system but no competitive element.

**What to build**:
- Weekly trading competitions with leaderboards
- Prize pool funded by % of swap fees
- Badges/achievements tied to trading milestones
- "Streak" rewards for daily active trading

**Effort**: Medium. Points infrastructure exists, needs competition layer.

---

## Priority 3: Platform Parity & Polish

### 3.1 GoPlus Safety on All Chains

**Current**: Bot only runs security analysis on Solana (via `token_analyzer`). GoPlus service supports 60+ chains but isn't integrated into the swap confirmation flow for EVM.

**Fix**: In `bot/handlers/swap.py`, extend the safety check (currently line ~452) to call `goplus_service.get_token_security()` for EVM chains alongside Solana's token_analyzer.

### 3.2 Webapp Test Coverage

**Current**: 4 test files for 46 components and 15 pages. Critical flows (swap, wallet, auth) have no unit tests.

**Target**: Add tests for:
- Swap flow (quote → confirm → execute)
- Auth flow (Telegram validation → JWT → protected routes)
- Portfolio data rendering
- TokenDetail + PriceChart components

### 3.3 Mobile Component Tests

**Current**: 9 test files, all at lib/hook level. No screen/component tests.

**Target**: Add snapshot tests for critical screens (Swap, Portfolio, Token Detail, Send).

### 3.4 Performance Optimization

- Add Redis caching to api-ts (currently in-memory Maps — lost on restart)
- Add connection pooling metrics to bot HTTP client
- Profile swap execution latency end-to-end; target <2s for Solana, <5s for EVM

---

## Priority 4: Competitive Moats (Strategic)

### 4.1 Intent-Based Execution

**Why**: CoW Protocol, UniswapX, and solver networks achieve 20-50% less slippage than AMM routing. This is the future of DEX execution.

**Current**: We have CoW Protocol integration for EVM same-chain swaps. Need to expand.

**Roadmap**:
1. Add UniswapX as a quote source alongside CoW
2. Evaluate 1inch Fusion as solver alternative
3. Build "Intent Mode" toggle in settings — routes through solver networks when possible
4. Long-term: Run our own solver node for cross-chain intents

### 4.2 AI Agent Ecosystem

**Why**: 550+ AI agent crypto projects, $4.3B market cap. Our A2A protocol is ahead of competitors.

**Current**: Agent API exists with registration, webhooks, A2A JSON-RPC.

**Roadmap**:
1. Add natural language swap interface ("swap $100 of SOL to BONK")
2. Build agent SDK with example bots
3. Partner with AI wallet projects (Wayfinder, NEAR AI, etc.)
4. Launch agent marketplace

### 4.3 Multi-Chain Portfolio Rebalancing

**Why**: No competitor offers automated cross-chain rebalancing. This leverages our 7-bridge infrastructure uniquely.

**What**: User sets target allocation (60% SOL, 30% ETH, 10% stables), bot auto-rebalances on schedule or threshold drift.

---

## Implementation Order

| Phase | Items | Timeline |
|-------|-------|----------|
| **Phase A** | 1.1 (API endpoints), 1.2 (webapp wiring), 1.3 (bot gaps) | Immediate |
| **Phase B** | 2.2 (EVM MEV), 2.3 (PnL handler), 3.1 (GoPlus all chains) | Week 1-2 |
| **Phase C** | 2.1 (Smart money tracking), 2.5 (Gamification) | Week 2-4 |
| **Phase D** | 3.2-3.3 (Tests), 3.4 (Performance) | Ongoing |
| **Phase E** | 4.1 (Intent execution), 4.2 (AI agents), 4.3 (Rebalancing) | Quarter 2 |
