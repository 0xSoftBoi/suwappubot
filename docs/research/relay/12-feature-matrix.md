# Feature matrix: Relay vs Suwappu (evidence-based, 2026-09-08)

Relay column: docs.relay.link and live API probes. Suwappu column: a read-only audit of this repository with file references. Status key: HAVE / PARTIAL / NONE.

| # | Capability | Relay | Suwappu | Evidence (ours) | Gap read |
|---|---|---|---|---|---|
| 1 | Cross-chain execution providers | One solver network (their own); Li.Fi/Bungee/Rango resell it | HAVE: 22 providers raced incl. Jupiter, Jito, Li.Fi, CCTP, Across, **Relay (new)**, Wormhole, CoW, Socket, 1inch, 0x, Kyber, OKX, USDT0 | `bot/services/swap_engine.py` `EXECUTABLE_PROVIDERS`, `_rank_quotes` | We are an aggregator on top of them; strength |
| 2 | Chains | 61 live: 52 EVM + Solana, Bitcoin, TON, Tron, XRP, HyperLiquid, Lighter, Eclipse | HAVE: 25+ EVM, Solana, Tron, Starknet. NONE: Bitcoin, TON, XRP native | `bot/config/chains.py:43-350` | TON is the gap that matters for a Telegram bot; Relay now gives us TON as a destination |
| 3 | Same-chain swaps | Yes (routes through 0x, Kyber, Jupiter etc.; visible in `route.destination.router`) | HAVE: Jupiter (Solana), 1inch/0x/Kyber/OKX (EVM) | `bot/services/{jupiter,1inch,kyberswap,zerox,okx_dex}_api.py` | Parity |
| 4 | Gasless execution (Permit2 / EIP-3009 / 7702 / 4337) | HAVE, app-balance funded, not skimmed from output | PARTIAL: paymasters on Tempo and Starknet, Permit2 on Robinhood; no universal gasless | `bot/services/paymaster.py`, `bot/services/starknet/paymaster.py`, `bot/config/chains.py:252` | Real gap for zero-gas new users |
| 5 | Fee sponsorship / gas top-up | HAVE: `subsidizeFees`, `subsidizationBps`, `topupGas` | PARTIAL: Tempo-only sponsor | `bot/services/tempo_fee_sponsor.py:52` | Gap |
| 6 | Deposit-address funding / fiat onramp | HAVE deposit addresses (open + strict), OnrampWidget | PARTIAL: deposit addresses for HyperLiquid funding; no MoonPay/Transak | `bot/handlers/fund.py`, `bot/services/hyperliquid_funding.py` | Fiat is a gap; deposit-address for any route is buildable on top of Relay `useDepositAddress` |
| 7 | Cross-chain contract calls | HAVE (`txs[]`) | PARTIAL: CCIP, Socket carry messages; not exposed as a product | `bot/services/{ccip_api,socket_api}.py` | Agent-action primitive opportunity |
| 8 | Webhooks / WebSockets to integrators | HAVE both, HMAC-signed, 10 retries | HAVE webhooks for agents; NONE WebSocket | `api-ts/src/db/schema/webhookEvents.ts`, `api-ts/src/routes/agent.ts` | Near parity |
| 9 | Integrator app fees / rev share | HAVE: bps on input, USDC accrual, claim endpoint + UI | PARTIAL: fee service + referral; no integrator fee split or claim UI | `bot/services/fee_service.py`, `bot/handlers/referral.py` | Gap if we sell the API to third parties |
| 10 | API keys, rate limits, dashboard | HAVE: dashboard.relay.link, per-key limits, request analytics, saved views | HAVE keys + limits; NONE dashboard | `api-ts/src/middleware/{rateLimit,apiKeyAuth}.ts` | Dashboard gap |
| 11 | Agent-facing API | NONE in market (4-star MCP repo) | HAVE: REST agent routes, A2A 0.3, MCP server, x402 billing | `api-ts/src/routes/{agent,a2a,mcp,billing}.ts` | **Our lead** |
| 12 | SDK / widget | HAVE: SDK (51K weekly npm downloads), Hooks, UI widget (2.8K/week) | PARTIAL: `@suwappu/sdk` client + CLI; no widget | `packages/sdk/src/{client,cli}` | Widget gap |
| 13 | Tx status polling for bridges | HAVE `/intents/status/v3` | HAVE `tx_poller`, `btc_bridge_poller`; Relay request_id not yet persisted (TODO) | `bot/services/{tx_poller,btc_bridge_poller}.py` | Wire Relay status |
| 14 | Refunds on failed bridge | HAVE automatic, origin chain, original currency; `MANUAL_REFUND_REQUIRED` exists | PARTIAL: reconciler, no bridge-refund state machine | `bot/services/withdraw_reconciler.py` | Gap; Relay handles it for Relay routes |
| 15 | Token security / honeypot | NONE (they only warn on Robinhood Chain) | HAVE: honeypot detector, rug service, analyzer | `bot/services/token_security/*` | **Our lead** |
| 16 | Points / seasons / rewards | NONE (no token, no points) | HAVE | `bot/services/points_service.py`, `bot/handlers/{points,rewards}.py` | **Our lead** |
| 17 | Min-output guard at execution | Guaranteed `minimumAmount` in quote | HAVE, fail-closed helper used by all executors incl. Relay | `swap_engine.py` `_assert_fresh_min_out_acceptable` | Parity |
| 18 | MEV protection | Solver fills are private by construction | HAVE: Flashbots (EVM), Jito (Solana) | `bot/services/compliance/flashbots_relay.py`, `bot/services/jito_api.py` | Parity |
| 19 | Limit / DCA / snipe / copy trading | NONE | HAVE | `bot/handlers/{limit_orders,snipe,copy}.py` | **Our lead** |
| 20 | HyperLiquid deposits | HAVE, nonce-mapped, deposits + withdrawals | HAVE via Across (USDC) and HyperUnit (BTC/ETH/SOL) | `bot/services/{hyperliquid_funding,hyperunit_api}.py` | Parity; Relay adds withdrawals |
| 21 | Wallet model | None (integrator's wallet) | HAVE: non-custodial, KMS envelope, Turnkey, multi-chain | `bot/services/wallet.py` | Different layer |
| 22 | Public status page | HAVE status.relay.link (see 13-status-incidents.md) | PARTIAL: internal monitoring only | `docs/deployment/monitoring.md`, `scripts/uptime_probe.py` | Trust gap for partners |
| 23 | Chat-native surface (Telegram, WhatsApp) | NONE | HAVE | `bot/handlers/*`, `api/` WhatsApp webhook | **Our lead** |

## Five biggest gaps (ours)
1. Fiat onramp: no bank-to-crypto entry point.
2. Bitcoin / TON / XRP as native chains. TON matters most for our channel. Relay as a provider closes the destination side today; origin needs signing support.
3. Universal gasless for new users. Paymasters exist only on Tempo and Starknet.
4. Public status page and integrator dashboard.
5. Integrator fee split and claim flow for third parties building on our agent API.

## Five biggest leads (ours)
1. Agent-native API with A2A, MCP, and x402 billing already shipped.
2. Token security before the buy, not a warning after.
3. Points and seasons: a retention loop Relay cannot run without owning users.
4. Order types: limits, DCA, sniping, copy trading.
5. The chat surface itself, with wallets we operate for the user.
