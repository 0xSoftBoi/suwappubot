# Relay (relay.link) competitive study — executive summary

Dates: 2026-09-07 to 2026-09-08. Method: live probes of `api.relay.link`, a full crawl of the 139 docs pages, a 40,000-request sample of their public request feed, on-chain reads of their Base contracts, their npm SDK and widget inspected and rendered locally, the status-page incident feed, and primary-source press. Marketing numbers are labelled as Relay's own. Every number below has a file behind it in this folder.

## What Relay is
A solver-filled, intent-based cross-chain execution layer built by Reservoir Tools, Inc. (Peter Watts CEO, Jason Maier COO, Julien Genestoux VP Eng; ~$43M raised, Series B $17M in Feb 2026 from Archetype and USV). An app posts a quote; the user deposits into a `RelayDepository` contract on the origin chain; one solver wallet pays out on the destination chain within a second or two; Relay's own settlement chain (Sovereign SDK on Celestia DA) credits the solver after an oracle attests the fill and an MPC allocator signs the withdrawal. They sell to wallets, marketplaces and trading bots, not to end users. Public claims: $20B+ volume, 100M+ transactions, 85+ chains, "#1 transaction source on Base".

## What we measured
| Fact | Value | File |
|---|---|---|
| Live chains | 61 (52 EVM + Solana, Bitcoin, TON, Tron, XRP, HyperLiquid, Lighter, Eclipse) | 04 |
| Fee, stable-to-stable at $50K–$1M | 0.0095% (~1 bp); published schedule: bridge 0%, stable 0.01%, major 0.06%, minor 0.15%, plus $0.02 flat | 04, 15 |
| Fill time | quoted 1–6 s; observed median 1 s, p90 2 s | 04, 06 |
| API-level throughput | ~1,400 requests/min, ~$760K/min → ~2M requests and ~$1.1B/day extrapolated | 06 |
| Externally indexed bridge volume | $79M/day (DefiLlama) | 14 |
| Median ticket | $36 (p90 $800, p99 $9K) | 06 |
| Success / refund | 93.1% / 6.8% in the 40K sample; Solana same-chain 99% refunded in that window | 06 |
| Solvers | 2 addresses; one EOA fills 97.7%, holding ~$3.7M USDC + ~300 ETH on Base | 06, 10 |
| Integrator concentration | fomo 77% of requests, 65% of notional; Solana↔BSC and Solana↔Robinhood are 81% of routes | 06 |
| Dominant token | `4Stock`, an unverified BSC token: 22.6% of all requests | 06 |
| Integrator app fees | 78% of requests carry one, modal 45–50 bps; ~$3.3M/day across integrators at run rate | 06 |
| Incidents | 25 in 20 days, mostly upstream RPC/chain degradation; "API 100% uptime" banner regardless | 13 |
| SDK adoption | 51.5K weekly npm downloads for the SDK, 2.8K for the widget | 11 |
| Auth | quotes work keyless (50/min); `referrer` needs a key; their SDK and widget set it by default, so they fail keyless | 04, 11, 16 |
| Fiat | MoonPay onramp exists in the widget package, undocumented | 15 |
| Revenue share | needs KYB and $10M+/month through Relay; 0–34% then 0–67% of their fee | 15 |

## Where they beat us
1. Price: ~1 bp at size against Across's ~4 bp.
2. Reach: every chain we support plus Solana, Bitcoin, TON, Tron, XRP, HyperLiquid, with Solana as a first-class origin.
3. Integrator levers we lack: gasless execution (EIP-7702 via Uniswap Calibur), fee sponsorship with partial `subsidizationBps`, gas top-up, deposit addresses, cross-chain contract calls, HMAC-signed webhooks, self-serve key dashboard.
4. Distribution: Phantom, MetaMask, OKX, Rainbow, OpenSea, Coinbase, Li.Fi, Rango, Bungee, plus the depository's verified-domain list (Oku, Superbridge, KyberSwap, ShapeShift, Highlight, RocketX).
5. UX craft: one-number cost disclosure `$24.85 (-0.59%)`, quote before wallet connect, time and gas as icons, two-sided Deposit/Fill receipts with permanent links.

## Where they are exposed
1. One solver EOA and one MPC signer are the whole network; `SOLVER_CAPACITY_EXCEEDED` and `SOLVER_BALANCE_TOO_LOW` are live failure modes and the 08-30 "liquidity shortage" incident was real.
2. One app (fomo) is three quarters of flow, in memecoins and an unverified "stock" token, on a corridor (Robinhood Chain) that already needed a honeypot warning.
3. Same-chain Solana was 99% refunds in our window with no incident posted.
4. No user relationship, ~1K Discord, no token, no points; they are invisible by design.
5. Agent story is a 4-star undocumented MCP repo; no x402.
6. Public request feed retires 24 Nov 2026 and v3 needs keys; transparency is closing.
7. The depository contract carries a Blockscout "scam" reputation flag (automated, likely from drainer flows) that users may see in explorers; `execute` can move any balance the allocator signs for.

## What we built (this branch)
- **Relay as provider `relay` in the swap engine** (`bot/services/relay_api.py`, wired in `swap_engine.py` and `router.py`; settings `RELAY_ENABLED`, `RELAY_API_KEY`, `RELAY_APP_FEE_RECIPIENT`, `RELAY_APP_FEE_BPS`). Races Across, Li.Fi, Socket and the rest on every EVM-origin cross-chain quote, executes approve → deposit, attaches our app fee in USDC. Hardened after an adversarial money-path review: fail-closed min-out, step validation against the approved quote (chain, token, approve amount, native value, deposit target), approve-receipt check, no receipt wait on the deposit, gas buffer and balance check, keyless rate limit. 46 tests pass; live quotes verified; execution not yet run with a funded wallet.
- **Market intel tooling**: `scripts/research/relay_firehose.py` (works until November), on-chain depository event monitoring plan (10), and a local render harness for their widget (16).

## Recommended moves, in order
1. Ship the Relay provider behind `RELAY_ENABLED` with `RELAY_APP_FEE_BPS` at 45–50, the going rate for bots on Relay. Keep same-chain Solana on Jupiter, never Relay.
2. Make TON ↔ everything a headline route. Relay added TON in June and it is 0.0% of their flow; we live inside Telegram.
3. Market "agent-native cross-chain" now: agent routes, A2A, MCP, x402 are shipped here and absent there.
4. Adopt their three disclosures in `/s` and the webapp: output USD with the percent lost, time and gas as icons, Deposit/Fill receipt with a permanent link.
5. Turn token security into the promise "we block honeypots before you buy" on Robinhood Chain, BSC and Solana memes, the exact corridor where Relay's users are getting refunded.
6. Scope gasless for zero-balance users via EIP-7702 delegation (their Calibur path) as a MONEY-PATH project with its own review.
7. Publish per-provider health on a public status page; their green banner over 11-hour Robinhood stalls is a trust gap we can take.
8. Publish a "best Telegram trading bot 2026" comparison page the way they publish "best crypto bridge 2026".

## Files
| File | What |
|---|---|
| `01-technical.md` | Lifecycle, settlement, solvers, vaults, gasless, sponsorship, deposit addresses, HL, Solana, webhooks, SDK, contracts, builder codes, API surface, gaps |
| `02-business.md` | Company, funding, traction, customers, token, model, fee schedule, revenue share, competitor table, news, risks, opportunities |
| `03-marketing-sales.md` | Positioning, ICPs, developer GTM, sales motion, content, brand, community, lessons |
| `04-live-api-probe.md` | Hands-on API findings, auth gating, fee curve, response shapes |
| `05-integration-spec.md` | The build spec we implemented |
| `06-firehose-intel.md` | 40,000-request market sample with throughput, routes, integrators, fees, failures |
| `07-changelog-timeline.md` | 18 months of shipping cadence |
| `08-api-reference.md` | Every endpoint, field, enum and guide, digested from the full docs crawl |
| `09-protocol-features-kit.md` | Protocol components, vaults, features, SDK/Hooks/UI, full changelog |
| `10-onchain-forensics.md` | Depository source and behaviour, solver inventory, explorer reputation |
| `11-sdk-internals.md` | What the SDK sends, execution flow, 7702/Calibur, npm adoption |
| `12-feature-matrix.md` | 23 capabilities, Relay vs Suwappu with file evidence |
| `13-status-incidents.md` | Incident history and what it says about their reliability |
| `14-primary-sources.md` | Verbatim quotes with URLs; corrections to earlier claims |
| `15-product-ux.md` | End-user flow, fee display, widget props, onramp, support, sentiment |
| `16-widget-render.md` | Their SwapWidget rendered locally; design language; what to copy |
| `docs-crawl/` | Text of all 139 docs pages |
| `probe/` | Raw JSON: chains, quotes, incidents, 40K-request sample (gzip) |
| `screenshots/` | Docs, status page, and widget captures with extracted text |
