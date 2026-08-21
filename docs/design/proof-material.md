# SUWAPPU MARKETING PROOF MATERIAL

## 1. STATS.GENERATED.JSON
**Source:** showcase/src/data/stats.generated.json:1-32

- **platformChains:** 41 (bot + terminal surface, excludes testnets)
- **agentApiChains:** 17 (mirrors GET /v1/agent/chains)
- **routerCount:** 19 (swap quote providers)
- **Routers listed:** 0x, 1inch, Across, AVNU, CCIP, CCTP, CoW, GoatSwap, JuiceSwap, Jupiter, KyberSwap, LayerZero, Li.Fi, OKX, Socket, SunSwap, Tempo DEX, usdt0, Wormhole

*Note: "CHAIN-GATED — never claim every swap races all of them" per stats.generated.json:30*

---

## 2. SUPPORTED CHAINS (bot/config/chains.py)

**Non-testnet chains in CHAINS dict (bot/config/chains.py:43-400+):**
1. ethereum (ChainType.EVM, chain_id=1)
2. bsc (ChainType.EVM, chain_id=56)
3. polygon (ChainType.EVM, chain_id=137)
4. arbitrum (ChainType.EVM, chain_id=42161)
5. optimism (ChainType.EVM, chain_id=10)
6. base (ChainType.EVM, chain_id=8453)
7. avalanche (ChainType.EVM, chain_id=43114)
8. fantom (ChainType.EVM, chain_id=250)
9. linea (ChainType.EVM, chain_id=59144)
10. mantle (ChainType.EVM, chain_id=5000)
11. gnosis (ChainType.EVM, chain_id=100)
12. scroll (ChainType.EVM, chain_id=534352)
13. solana (ChainType.SOLANA, chain_id="solana")
14. tron (ChainType.TRON, chain_id="tron")
15. starknet (ChainType.STARKNET, chain_id="SN_MAIN")
16. tempo (ChainType.EVM, chain_id=4217) — **Tempo DEX integration**
17. plasma (ChainType.EVM, chain_id=9745)
18. goat (ChainType.EVM, chain_id=2345)
19. rootstock (ChainType.EVM, chain_id=30, legacy_gas_only=True, min_gas_price_wei=60M)
20. citrea (ChainType.EVM, chain_id=4114)
21. sonic (ChainType.EVM, chain_id=146)
22. opbnb (ChainType.EVM, chain_id=204)
23. fraxtal (ChainType.EVM, chain_id=252)
24. zksync (ChainType.EVM, chain_id=324)
25. worldchain (ChainType.EVM, chain_id=480)
26. flow (ChainType.EVM, chain_id=747)
27. hyperevm (ChainType.EVM, chain_id=999)
28. lisk (ChainType.EVM, chain_id=1135)

**Testnet chains (excluded from user-facing pickers, admin only):**
- base-sepolia (ChainType.EVM, chain_id=84532, is_testnet=True)

**Chain types:** EVM, Solana, Tron, Starknet

---

## 3. WALLET SECURITY: KMS ENVELOPE ENCRYPTION (bot/config/settings.py:50-81)

**Encryption Scheme Options:**
- **Default:** `kms_aesgcm_v2` (line 76, default value)
- **Legacy:** `legacy_fernet_v1` (auto-migrated to v2 on first use if `auto_migrate_legacy_wallets=True`, line 79-80)

**KMS Providers Supported (bot/config/settings.py:56-59, 60-103):**
1. `aws` — AWS KMS (requires `kms_key_id` + `kms_region`)
2. `gcp` — Google Cloud KMS (requires `gcp_project_id`, `gcp_kms_location`, `gcp_kms_keyring`)
3. `local` — Local KMS (requires `wallet_master_kek`, high-entropy base64/hex KEK wrapping per-wallet DEKs; production-acceptable for fallback/backup + OAuth tier)
4. `dev` — Local mock (NOT for production)

**Wallet Provider Options (bot/config/settings.py:84-102):**
- `local` — Encrypted in DB
- `turnkey` — TEE-backed (Turnkey Wallet Infrastructure with circuit-breaker fallback)

**Turnkey Fallback (bot/config/settings.py:110-124):**
- Enabled by default (`turnkey_fallback_enabled=True`, line 111)
- Circuit breaker threshold: 3 consecutive failures (line 119)
- Recovery wait: 300 seconds (line 122)
- Fallback modes: auto (circuit breaker), manual (always local), disabled

**Custody Model:** 
- Not explicitly specified as custodial/non-custodial in settings. Code supports both local (non-custodial DB encryption) + Turnkey TEE (non-custodial TEE-backed signing).

**UNCERTAIN:** Exact marketed custody claim — code supports multiple models; would need marketing copy or docs.

---

## 4. BOT HANDLERS / COMMANDS (bot/handlers/*.py)

**Found 60+ handler files:**
start.py, swap.py, wallet.py, balance.py, portfolio.py, alerts.py, snipe.py, orders.py (assumed from services), admin.py, referral.py, settings.py, trending.py, token.py, gas.py, tax.py, intel.py, approvals.py, bulk_swap.py, copy.py, points.py, dashboard.py, positions.py, perps.py, quickswap.py, predictions.py, support.py, battle.py, luckybox.py, savings.py, rewards.py, vip.py, stocks.py (via xstocks.py config), tempo.py, smartaccount.py, twofa.py, recovery.py, import_handler.py, p2p_handler.py, limit_orders.py, borrow.py, airdrop.py, fund.py, giftcard.py, and many admin-specific ones.

**Standard public commands inferred from CLAUDE.md:**
- /start — Onboarding
- /s (swap) — Token swap
- /w (wallet) — Wallet management
- /b (balance) — Check balances
- /p (portfolio) — Portfolio view
- /a (alerts) — Alert management
- /o (orders) — Order history
- /snipe — Snipe configuration
- /ref — Referral
- /xp — XP / points
- Admin: /st, /hw, /fee, /m

**Features identifiable from handlers:**
- Swap (swap.py, bulk_swap.py)
- Wallet (wallet.py, import_handler.py, recovery.py, smartaccount.py)
- Alerts (alerts.py)
- Orders (handlers suggest: limit_orders.py, history suggests order tracking)
- Copy trading (copy.py)
- Snipe (snipe.py)
- Perps (perps.py) — leverage trading
- Portfolio (portfolio.py)
- Referral (referral.py)
- Points/Rewards (points.py, rewards.py, vip.py)
- P2P trading (p2p_handler.py, admin_p2p.py)
- Tax (tax.py)
- Borrow (borrow.py)
- Savings (savings.py)

---

## CONTINUED SEARCH...


## 5. LIVE PRODUCTION URLS (CLICKABLE)

**API Base:** https://api.suwappu.bot/

**Agent Card Endpoints:**
- GET `https://api.suwappu.bot/.well-known/agent.json` (OpenAI Agent specification)
- GET `https://api.suwappu.bot/.well-known/agent-card.json` (alias)
- GET `https://api.suwappu.bot/agent-card.json` (legacy)

**Health Endpoints (JSON):**
- GET `https://api.suwappu.bot/health` — Returns `{status, service: "suwappu-api-ts", version, source_fingerprint, timestamp, db}` (api-ts/src/routes/health.ts:16)

**Public Token & Chain Lists (JSON, no auth):**
- GET `https://api.suwappu.bot/health/tokens?chainId=1` — Known-good verified tokens per chain (api-ts/src/routes/health.ts:94)
- GET `https://api.suwappu.bot/health/chains` — Supported chains with logos (api-ts/src/routes/health.ts:160)

**Agent API Endpoints (require authentication via Bearer token):**
- POST `https://api.suwappu.bot/v1/agent/register` — Register new agent
- GET `https://api.suwappu.bot/v1/agent/chains` — List chains (public)
- GET `https://api.suwappu.bot/v1/agent/me` — Get current agent profile
- PATCH `https://api.suwappu.bot/v1/agent/me` — Update agent profile
- POST `https://api.suwappu.bot/v1/agent/quote` — Get swap quote
- POST `https://api.suwappu.bot/v1/agent/swap/execute` — Execute swap
- GET `https://api.suwappu.bot/v1/agent/portfolio?wallet_address=0x...` — Get portfolio
- GET `https://api.suwappu.bot/v1/agent/perps/markets` — List perp markets (public)
- POST `https://api.suwappu.bot/v1/agent/perps/quote` — Get perp quote
- GET `https://api.suwappu.bot/v1/agent/billing/topup` — Manage credits

**MCP Endpoint (JSON-RPC 2.0, Bearer auth):**
- POST `https://api.suwappu.bot/mcp` — Model Context Protocol interface for agent tools (api-ts/src/routes/mcp.ts)

---

## 6. SWAP ENGINES / AGGREGATORS / DEXES

**Quote Routers (19 total, from stats.generated.json):**
0x, 1inch, Across, AVNU, CCIP, CCTP, CoW, GoatSwap, JuiceSwap, Jupiter, KyberSwap, LayerZero, Li.Fi, OKX, Socket, SunSwap, Tempo DEX, usdt0, Wormhole

**Venue Implementation Note:** Routes are chain-gated; not all routers available on all chains. (bot/config/chains.py comments on chain-specific routing e.g., Li.Fi for Rootstock, JuiceSwap for Citrea, GOATSwap for GOAT)

---

## 7. FEE STRUCTURE (bot/services/fee_service.py:1-50)

**Tier-Based Swap Fees:**
- **FREE tier:** 1.0% swap fee
- **PRO tier:** 0.5% swap fee
- **PREMIUM tier:** 0.3% swap fee
- **ENTERPRISE tier:** 0.1% swap fee

**Referral Rewards:** 30% of fees go to referrer (bot/services/fee_service.py:49-50, bot/config/settings.py:1148-1149)

**Fee Floor (MIN_EFFECTIVE_FEE_RATE):** 0.1% (ENTERPRISE rate) — points discounts cannot reduce fees below this. (bot/services/fee_service.py:47)

**Fee Split (after referral payout):**
- 40% to staking pool
- 60% to protocol treasury
(bot/services/fee_service.py:76-78)

**Perps (HyperLiquid):**
- Builder fee: 10 tenths of basis point (default, configurable) = 1 bp = 0.01% (bot/config/settings.py:338-343)

---

## 8. PERPS INTEGRATION

**Protocol:** HyperLiquid (bot/config/settings.py:317-348, api-ts/src/routes/perps.ts)

**Features Available:**
- GET `/v1/agent/perps/markets` — List available perp markets
- POST `/v1/agent/perps/quote` — Get position quote (market, side, size, leverage)
- GET `/v1/agent/perps/positions` — Fetch user positions

**Revenue Model:** Suwappu earns builder fee + referral rewards on perp trades. Builder eligibility requires $1k trading volume threshold (bot/services checked on-chain). Referral code auto-attached to users on first perp trade. (bot/config/settings.py:317-337)

---

## 9. TEMPO CHAIN INTEGRATION

**Chain Name:** Tempo (EVM, chain_id=4217, display_name="Tempo", native_token="USD", decimals=6) (bot/config/chains.py:237-248)

**Features:**
- **Tempo DEX routing** — Listed as one of 19 routers in stats (stats.generated.json)
- **Gasless (fee-payer) Swaps:** Optional sponsor wallet can counter-sign type-0x76 swaps as fee payer for new users (bot/config/settings.py:261-274)
  - Controlled by `tempo_fee_sponsor_enabled` (default: False, line 261)
  - Sponsor wallet name: `tempo_fee_sponsor` (line 269)
- **Session Key Handler** — `/tempo grant|revoke|status` command allows users to authorize session-key access for automated Tempo swaps (DCA/limit/snipe) with weekly USD cap (bot/handlers/tempo.py:1-23, DEFAULT_CAP_USD)

**Explorer:** https://explore.tempo.xyz

---

## 10. SOLANA & STARKNET SUPPORT

**Solana Chain:**
- ChainType.SOLANA, chain_id="solana", native_token=SOL (9 decimals)
- Jupiter integration for quotes (api-ts services)
- Referral account for fee collection via Jupiter (bot/config/settings.py: jupiter_referral_account*, jupiter_referral_accounts)

**Starknet Chain:**
- ChainType.STARKNET, chain_id="SN_MAIN", native_token=STRK (18 decimals)
- Addresses from bot/config/starknet_addresses module (bot/config/tokens.py imports it)

---

## 11. MCP TOOLS (23 distinct tools)

**Source:** api-ts/src/routes/mcp.ts tool registry

Swap & Quote Tools (3):
- get_quote
- execute_swap
- simulate_swap

Portfolio & Pricing (2):
- get_portfolio
- get_prices

Listing & Discovery (2):
- list_chains
- list_tokens

Temporal & Tokens (1):
- get_tempo_tokens

Cross-Chain & Status (2):
- get_swap_status
- get_swap_history

Prediction Markets (5):
- predict_markets
- predict_market
- predict_market_detail
- predict_price
- predict_book
- predict_trades (6 total)

Perps (3):
- perps_markets
- perps_positions
- perps_quote

Lending (2):
- lend_markets
- lend_market

Directory & Policy (2):
- browse_mpp_directory
- list_wallet_policies

---

## 12. SDK PACKAGE

**Name & Version:** `@suwappu/sdk` v0.5.2 (packages/sdk/package.json)

**Distribution:** Published to npm (public access, packages/sdk/package.json:4-5)

**Exports:**
- Main: `./dist/index.js` (ES modules)
- Types: `./dist/index.d.ts`
- CLI: `suwappu` command-line tool (bin/suwappu points to `./dist/cli/index.js`)

**Description:** TypeScript client for the Suwappu cross-chain DEX API

---

## 13. I18N / LANGUAGE SUPPORT

**Bot i18n:** 4 languages (bot/i18n.py:18)
- English (en)
- Spanish (es)
- French (fr)
- Chinese (zh)

**Webapp i18n:** 4 language files (webapp/src/locales/)
- en.json
- es.json
- fr.json
- zh.json

---

## 14. TOKENS SUPPORTED (bot/config/tokens.py)

**Total:** 53 distinct token symbols registered

**List (alphabetical):**
AAVE, ALPHAUSD, ARB, BETAUSD, BNB, BTC, BTCB, BUSD, CBBTC, COMP, CRV, CRVUSD, CTUSD, DAI, DOC, ETH, EURC, FDUSD, FRAX, GHO, LDO, LINK, LUSD, MANTA, MATIC, MKR, OP, PATHUSD, PEPE, PYUSD, SHIB, SNX, SOL, STRK, SUSHI, TBTC, THETAUSD, TRX, TUSD, UNI, USDC, USDD, USDP, USDT, USDT0, WBNB, WBTC, WCBTC, WETH, WGBTC, WMATIC, WRBTC, ZK

**Notable Cross-Chain Pairs:**
- USDT0 (LayerZero OFT canonical USDT, separate registry entry from USDT)
- USDT (traditional USDT, with per-chain addresses)
- Stables: USDC, DAI, FRAX, USDD, USDP, TUSD, LUSD, CRVUSD, GHO
- Correlated: wBTC, BTCB, CBBTC, WGBTC, tBTC (BTC variants)
- Exotics: ALPHAUSD, BETAUSD, THETAUSD, PATHUSD (Synthetix)

---

## 15. API-TS SERVICE VERSION

**api-ts package.json version:** 0.4.0 (api-ts/package.json)

---

## 16. HANDLER COUNT & FEATURE SUMMARY

**Bot Handlers:** 60+ files in bot/handlers/ (bot/handlers/*.py glob)

**Verified Features & Handlers:**
1. Swap (swap.py, bulk_swap.py)
2. Wallet (wallet.py, import_handler.py, recovery.py, smartaccount.py)
3. Balance (balance.py)
4. Portfolio (portfolio.py)
5. Alerts (alerts.py)
6. Orders / Limit Orders (limit_orders.py, history.py for tracking)
7. Copy Trading (copy.py)
8. Snipe (snipe.py)
9. Perps (perps.py) — HyperLiquid leverage
10. Referral (referral.py)
11. Points & Rewards (points.py, rewards.py, vip.py)
12. P2P Trading (p2p_handler.py, admin_p2p.py)
13. Tax (tax.py)
14. Token Intelligence (intel.py, token.py)
15. Token Security (approvals.py, aegis_scan.py)
16. Gas Estimation (gas.py)
17. Trending (trending.py)
18. Two-Factor Auth (twofa.py)
19. Smart Accounts (smartaccount.py)
20. Borrow (borrow.py)
21. Savings (savings.py)
22. Stocks (stocks.py via xstocks.py config)
23. Airdrop (airdrop.py)
24. Fund / Deposit (fund.py)
25. Battle / Gaming (battle.py)
26. Prediction / Forecast (predict.py) — via polymarket/prediction markets
27. Dashboard (dashboard.py)
28. Settings (settings.py)
29. Support (support.py)
30. Admin tools (admin.py, admin_*.py)

---

## 17. CHAIN TYPE BREAKDOWN

**From bot/config/chains.py:**

- **EVM Chains:** 25 total (ethereum, bsc, polygon, arbitrum, optimism, base, avalanche, fantom, linea, mantle, gnosis, scroll, tempo, plasma, goat, rootstock, citrea, sonic, opbnb, fraxtal, zksync, worldchain, flow, hyperevm, lisk)
- **Solana:** 1 (SOLANA chain type)
- **Tron:** 1 (TRON chain type)
- **Starknet:** 1 (STARKNET chain type)
- **Testnet:** 1 (base-sepolia, marked `is_testnet=True`, excluded from user-facing UIs)

**Subtotal Production Chains:** 28 (25 EVM + Solana + Tron + Starknet)

---

## UNCERTAINTY FLAGS

- **Custody Model Clarity:** Code supports both local (non-custodial DB encryption) and Turnkey TEE (non-custodial TEE-backed signing). No explicit "custodial vs non-custodial" claim found in code/config — may be in marketing docs or CLAUDE.md.
- **Exact Token Decimals Override:** Rootstock USDT is 18 decimals (not 6) per code comment (bot/config/tokens.py:40). This overrides the default 6 and may affect on-chain routing.
- **GOAT Chain Li.Fi Support:** Comments indicate Li.Fi does NOT support GOAT (chain 2345); routes via GOATSwap only (bot/config/chains.py:271).

---

