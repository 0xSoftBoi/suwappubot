# Polymarket + Polycule Deep Dive — Meeting Prep

**Meeting date**: 2026-03-22
**Prepared**: 2026-03-21

---

## PART 1: POLYMARKET — THE PLATFORM

### Overview
- **What**: Largest decentralized prediction market ($9B valuation, $21.5B volume in 2025)
- **Chain**: Polygon (Chain ID 137)
- **Collateral**: USDC.e (migrating to native USDC via Circle partnership)
- **Architecture**: Hybrid — off-chain order matching + on-chain settlement (non-custodial)
- **Founded by**: Shayne Coplan

### Key Numbers

| Metric | Value |
|--------|-------|
| Valuation | $9B (Series D, Oct 2025, led by ICE) |
| Total funding | $2.3B across 7 rounds |
| 2025 volume | $21.5B (note: Paradigm found double-counting, real ~50% of reported) |
| Feb 2026 monthly volume | $7B |
| Weekly volume | ~$786M |
| TVL | >$550M |
| Revenue (annualized Q1 2026) | $200-360M |
| DAU | 27,000-32,000 |
| AI bot wallets | 30% of all wallets |

### Revenue Model (NEW — started Jan 2026)
- **2025**: Zero fees (growth strategy)
- **Jan 2026**: Taker fees on crypto markets ($2.7M/week)
- **Feb 2026**: Taker fees expanded to NCAAB, Serie A sports
- **Fee rates**: Peak 1.56% at 50% probability; 0.30% taker / 0.20% maker rebate
- **Polymarket US target**: 0.1% flat taker fee
- **RTDS data licensing**: Bloomberg, hedge funds, news agencies
- **Treasury yield**: Hundreds of millions in USDC earning yield

### Smart Contracts

| Contract | Address |
|----------|---------|
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` |
| Neg Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` |
| CTF (Conditional Tokens) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| Proxy Wallet Factory | `0xaB45c5A4B0c941a2F231C04C3f49182e1A254052` |

### How Trading Works
1. Markets have YES/NO tokens (ERC1155) — prices sum to $1.00
2. Lock $1 USDC → get 1 YES + 1 NO token
3. Orders signed off-chain (EIP712), matched by operator
4. Settlement atomic on-chain via CTF Exchange
5. Resolution via UMA Optimistic Oracle (2hr minimum, dispute = days)
6. Correct shares redeem for $1.00

### APIs

#### Gamma API (Market Data — No Auth)
- Base: `https://gamma-api.polymarket.com`
- `GET /markets` — all markets with filtering
- `GET /events` — events (most efficient)

#### CLOB API (Order Management — Auth Required)
- Auth: API Key + Secret + Passphrase (POLY_* headers)
- Public: `GET /price`, `GET /book`, `GET /midpoint`
- Private: `POST /order`, `DELETE /order`

#### WebSocket (Real-Time)
- 4 channels: market, user, sports, RTDS
- RTDS: Crypto feeds from Binance/Chainlink, comment streaming
- Ping every 10s or disconnected

#### SDKs
- **TypeScript**: `@polymarket/clob-client` (v5.8.0), `@polymarket/real-time-data-client` (v1.4.0)
- **Python**: `py-clob-client`
- **Rust**: `polymarket-rtds`
- **Subgraphs**: 5 Goldsky subgraphs (Orders, Positions, Activity, OI, PnL)

### Regulatory Status
- **2022**: $1.4M CFTC penalty, banned from US
- **Nov 2025**: CFTC Amended Order — approved as regulated exchange
- **Dec 2025**: US customers can onboard directly
- **2025**: Acquired QCEX ($112M) for CFTC license
- **2026**: State challenges (Nevada, Tennessee, Massachusetts)

### Major Partnerships (2025-2026)

| Partner | Type | Date |
|---------|------|------|
| **MLB** | Exclusive prediction market partner | Mar 2026 |
| **UFC/TKO Group** | Exclusive sports partner | 2025 |
| **Dow Jones/WSJ** | Probability data in WSJ, Barron's | Jan 2026 |
| **ICE** | $2B investor + global data distribution | Oct 2025 |
| **Circle** | Native USDC migration | In progress |
| **Google** | Data partnership | 2025 |
| **Palantir** | Data partnership | 2025 |

### Upcoming
- **POLY token launch** (confirmed 2026, retroactive airdrop)
- **Native USDC** migration (removing USDC.e bridge risk)
- **Institutional API** (FIX protocol for high-volume)

---

## PART 2: POLYCULE — THE TELEGRAM BOT

### Overview
- **What**: #1 Telegram bot for trading on Polymarket
- **Telegram**: @polycule_v2_trade_bot (v2 after Jan 2026 hack)
- **Website**: polycule.trade
- **Twitter**: @polycule_bot
- **Founder**: Krish Shah (@top_jeet_)
- **Funding**: $560K from Alliance DAO (Jun 2025)
- **Token**: $PCULE (~$1.16M market cap)

### Key Numbers

| Metric | Value |
|--------|-------|
| Lifetime volume | $6.75M |
| Lifetime revenue | $12,050 |
| Take rate | 0.178% |
| 24h volume | $155-308K |
| Funding | $560K (Alliance DAO) |
| PCULE market cap | $1.16M |

### Features
- Browse and trade all Polymarket binary markets from Telegram
- Copy trading — mirror successful traders with customizable filters
- Group broadcasting — trades auto-shared in Telegram groups
- Limit orders
- Real-time price charts
- Portfolio tracking / PnL
- Trading leaderboards
- Cross-chain funding from Solana (deBridge)
- Automated wallet creation

### Architecture
- **CRITICAL: Custodial** — server stores user private keys (reversibly encrypted)
- Uses Polymarket CLOB API via `@polymarket/clob-client`
- Polygon for execution
- deBridge for cross-chain bridging

### THE HACK (Jan 13, 2026) — $230K stolen
- **Root cause**: SSRF vulnerability → forged copy trading signals → extracted reversibly-encrypted private keys
- **Impact**: All user funds at risk; $230K confirmed stolen
- **Response**: Bot taken offline, patched, relaunched as v2
- **Fundamental problem**: Custodial key management can't be fully fixed without architectural redesign
- **User trust**: Significantly damaged

### Competing Telegram Bots

| Bot | Fee | Model | Specialty |
|-----|-----|-------|-----------|
| **Polycule** | 0.178% | Custodial | Full-featured, social/copy, hacked |
| **PolyGun** | 1% | Non-custodial (Gnosis Safe) | Advanced sniping, gas-sponsored |
| **PolyCop** | 0.5% | Non-custodial | Pure copy-trading, fastest execution |
| **PolyBot** | Unknown | Non-custodial (Gnosis Safe) | Self-custodial, high-speed |
| **DropsBot** | Tiered | N/A | Whale tracking, alerts only |
| **Predictify** | Unknown | N/A | All-in-one discovery + trading |

**Trend**: Non-custodial (PolyGun, PolyCop) gaining ground post-Polycule hack.

---

## PART 3: SUWAPPU × POLYMARKET OPPORTUNITY

### Why This Matters
- Polymarket is the #1 prediction market ($9B, CFTC-approved, MLB partner)
- 30% of Polymarket wallets are AI bots — agent trading is huge
- Suwappu already has: Telegram bot, cross-chain DEX, agent API (A2A), MPP payments
- Natural extension: prediction market trading alongside token swaps

### Integration Angles

#### A. Prediction Market Trading in Suwappu Bot
- Add `/predict` command to trade on Polymarket markets
- User sends "bet YES on BTC > $100K" → Suwappu executes via CLOB API
- Leverage existing wallet infrastructure (non-custodial, unlike Polycule)
- Cross-chain: user funds on any chain → Suwappu bridges to Polygon → executes trade

#### B. Agent-to-Agent Prediction Trading
- Extend Suwappu's A2A agent protocol to include prediction market skills
- AI agents can place prediction bets through Suwappu's API
- Combine with x402 micropayments for per-trade billing

#### C. Arbitrage Infrastructure
- $40M+ extracted from Polymarket in 18 months via arbitrage
- Suwappu's cross-chain routing + Polymarket's CLOB = automated arb engine
- Cross-platform arb: Polymarket vs Kalshi price discrepancies

#### D. Oracle Data Feed
- Use Polymarket RTDS data to inform swap routing
- Example: 80% probability of BTC dump → adjust slippage/routing
- License RTDS for LP risk management

#### E. Liquidity Partnership
- Co-provide liquidity on high-volume Polymarket markets
- Suwappu LP rewards + Polymarket fee-sharing
- Focus on peak events (elections, economic releases)

#### F. Wrapped Prediction Tokens
- Create tradeable wrapped versions of popular Polymarket positions
- Enable prediction tokens as swap assets in Suwappu's DEX

### Suwappu Advantages Over Polycule

| # | Advantage | Detail |
|---|-----------|--------|
| 1 | **Non-custodial** | KMS-encrypted wallets, not server-stored private keys |
| 2 | **Multi-chain** | 9 chains vs Polycule's Polygon-only |
| 3 | **Agent API** | A2A protocol + MCP tools for programmatic access |
| 4 | **Payment protocol** | x402/MPP for agent micropayments |
| 5 | **No hack history** | Clean security record |
| 6 | **Established infra** | Swap engine, cross-chain bridging, portfolio tracking already built |

### Key Talking Points

1. **"We're the only Telegram bot with non-custodial wallets + cross-chain + agent API"** — Polycule got hacked because of custodial keys; we don't have that vulnerability
2. **"Agent trading is 30% of your volume — we have an A2A agent protocol"** — natural fit for programmatic prediction market access
3. **"We bridge 9 chains — users don't need to manually move USDC to Polygon"** — remove the biggest friction point
4. **"x402 micropayments for per-prediction billing"** — complements Polymarket's new fee model
5. **"MLB partnership creates mass market opportunity"** — Telegram bot for casual fans who won't use web UI
6. **Revenue split proposal**: Suwappu handles UX/distribution, Polymarket handles settlement, shared fees

### Technical Integration Checklist (if approved)
1. Add `@polymarket/clob-client` to api-ts dependencies
2. Create `bot/services/polymarket_api.py` — Python wrapper for Gamma + CLOB APIs
3. Add `/predict` handler to bot (browse markets, place trades, check positions)
4. Add Polymarket positions to portfolio view (`/p` command)
5. Extend agent-card.json with prediction market skills
6. Bridge integration: auto-route USDC from any chain → Polygon for Polymarket trades

---

## Sources
- Polymarket docs: https://docs.polymarket.com
- CLOB API: https://docs.polymarket.com/developers/CLOB/introduction
- Gamma API: https://docs.polymarket.com/developers/gamma-markets-api/overview
- Contract addresses: https://docs.polymarket.com/resources/contract-addresses
- Polycule: polycule.trade, @polycule_v2_trade_bot
- Polycule hack: https://www.kucoin.com/news/flash/telegram-trading-bot-polycule-on-polymarket-hacked-230k-stolen
- Polymarket CFTC approval: https://www.prnewswire.com/news-releases/polymarket-receives-cftc-approval-302625833.html
- MLB partnership: https://www.cnbc.com/2026/03/19/mlb-polymarket-prediction-markets.html
- ICE investment: https://insights4vc.substack.com/p/polymarket-raises-2b-at-9b-valuation
- Polymarket + WSJ: https://finance.yahoo.com/news/polymarket-dow-jones-publisher-wall-160000431.html
- Volume double-counting: https://www.paradigm.xyz/2025/12/polymarket-volume-is-being-double-counted
