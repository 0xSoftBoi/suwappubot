# Relay changelog timeline (from https://docs.relay.link/changelog, read 2026-09-07)

What their shipping cadence tells us: roughly 2–4 API/SDK changes per week, a hard tilt toward non-EVM (Solana, Bitcoin, TON, Tron, XRP, HyperLiquid, Lighter) and toward integrator monetization (app fees, fee sponsorship, builder codes, gasless).

## 2026
| Date | Change | Why it matters to us |
|---|---|---|
| 09-01 | Signature endpoints deprecated; offline quote verification via `@relay-protocol/settlement-sdk` | Protocol v2 is hardening; integrators can verify quotes without trusting the API |
| 08-26 | `/authorize` rate limit scoped per (API key, wallet) | Keyed access is the real product |
| 08-19 | `GET /requests/v3` referrer filtering needs an API key | Their integrator analytics are moving behind auth |
| 08-13 | Solana same-chain 1232-byte tx limit; `subsidizationBps` partial fee sponsorship | Sponsorship is a first-class lever we don't have |
| 08-07 | `/intents/status/v3` adds `failReason`, `refundFailReason`, `MANUAL_REFUND_REQUIRED` | Some refunds are manual; a support burden they carry |
| 08-04 / 07-22 | `GET /requests/v2` deprecated, **retired 2026-11-24**, rate limits ramp down until then | Our `scripts/research/relay_firehose.py` stops working then; v3 needs a key |
| 07-28 | 503/`PRICE_FETCH_FAILED` reclassified retryable; `/requests/v3` at 20 rps | They still have pricing hiccups |
| 07-21 | **Breaking**: SDK/UI Kit move to `/requests/v3` with API-key proxy required | Frontend integrators now must run a proxy |
| 07-10 | Base wallet blocked from Robinhood Chain | Robinhood Chain is ~1/3 of their live flow (see 06-firehose-intel.md) |
| 06-30 | **TON support** live | Telegram-native chain; direct threat/opportunity for a Telegram bot |
| 06-26 | **Sui removed** | They prune chains without volume |
| 05-29 | Solana cross-chain 1232-byte quote rejection | Solana route complexity is a real constraint |
| 05-28 | Bitcoin deposits go `pending` on mempool observation | BTC-in UX is fast |
| 05-21 | HyperLiquid nonce-mapping EIP-712 v2 | Deep HL integration (we route HL via Across today) |
| 05-15 | New fail enums: `DOUBLE_SPEND`, `TRANSACTION_TOO_LARGE`, `SOLVER_BALANCE_TOO_LOW` | Solver liquidity can bottleneck |
| 04-28 | Same-chain swaps under $0.05 rejected | Micro-swap floor |
| 04-24 | Lighter wallet adapter | Perps DEX deposits |
| 04-21 | EIP-5792 atomic batching in SDK | Approval+deposit in one user action |

## 2025
| Date | Change |
|---|---|
| 12-17 | SDK/UI Kit/Hooks on `/quote/v2` |
| 12-10 | HyperLiquid direct deposits; Phantom on Monad + HyperEVM |
| 10-29 | Tron adapter |
| 10-02 | Breaking: transaction steps revamp |
| 09-02 | UI Kit on React 19 |
| 08-25 | Relay rebrand across packages |
| 08-12 | WebSocket support |
| 06-18 | Dune → Sim for balances; USD input toggle in widget |
| 03-20 | Sui support (removed 2026-06) |
| 03-10 | Tron support |
| 02-10 | OnrampWidget + `useTokenPrice` |
| 01-21 | Multi-wallet + custom recipient |

## Signals
- **Non-EVM is the growth vector.** 8 of the notable launches in 18 months are non-EVM VMs. Our stack is EVM + Solana.
- **They monetize the integrator, not the user.** App fees (bps on input), fee sponsorship, builder codes, gasless: every lever is for an app that embeds Relay. That is also the door for us: we can be that app.
- **They are locking down data.** Public firehose retires in November 2026 and v3 needs keys. Capture what we need before then.
