# Suwappu Gateway: Arrow Finance's product shape, on Hyperliquid rails

*2026-08-31 · Status: blueprint, phases 0-1 actionable now.
Gold-standard reference: https://www.arrowfinance.io/ — "the gateway to trade, earn,
borrow, launch, and manage your on-chain portfolio" on Robinhood Chain: swap
(best-price liquidity), borrow (mint aUSD against crypto/stocks/ETFs at 55-90% LTV,
"no sale, no taxable event"), launch (tokens w/ auto liquidity), earn + terminal.
Companion research: `docs/research/hyperliquid-differentiation.md` (credit-layer
thesis), `docs/research/hyperliquid-hip4-primitives.md` (mechanisms),
`contracts/DEPLOY_HYPEREVM.md` (deploy runbook).*

## Why this maps cleanly

Arrow's bet: be the ONE integrated home for a chain's incoming users, own execution
end-to-end, no external aggregators. That is exactly our stated goal ("own the
infrastructure and fees, kill external dependencies"), and Hyperliquid is a better
host than Robinhood Chain: HyperCore gives us a native orderbook to execute against
(no DEX aggregation needed at all), Unit gives native BTC/ETH/SOL collateral, and
staked HYPE gives yield-bearing collateral. Our repo's test mocks (`MockUSDG`,
`MockStockToken`, `RobinhoodChainlinkOracle`) show we already studied Arrow's
collateral model — this formalizes it on HL.

## Pillar map: Arrow → Suwappu-on-Hyperliquid

| Arrow pillar | Their mechanism | Ours on HL | Status |
|---|---|---|---|
| **Swap** | Best-price aggregation on Robinhood Chain | `SuwappuRouter` on HyperEVM executing against the HyperCore spot orderbook via CoreWriter + precompiles. No aggregator, our fee switch (bps to treasury). | **To build** (pillar-1 contract) |
| **Borrow** | Mint aUSD against crypto/stocks/ETFs, 55-90% LTV | Fixed-rate **amortizing** borrow via `SuwappuAmortizingVault` against ERC-4626 staked-HYPE (and later Unit-asset 4626s). Differentiator vs. Felix/HyperLend/HypurrFi: fixed schedule, predictable payments — the enterprise ask. Same "no sale, no taxable event" story. | Contract done; needs vetted 4626 + audit |
| **Launch** | Token deploy w/ automatic liquidity | `SuwappuTimeCurve` launchpad (decay + sell-sink) with optional HIP-1 spot-asset linkage for graduation to the native orderbook. | Contract done; ships quiet, not headline |
| **Earn** | Yield vaults (coming soon) | Already LIVE in the bot: HLP/user vaults, HYPE staking, TWAP (`/vault`, `/stake`). Add AmortizingVault lender side. Arrow hasn't even shipped this — we lead here. | Live (bot); surface in webapp |
| **Terminal / Manage** | Pro tools (coming soon) | Bot + webapp + `terminal/` + portfolio (`/p`). | Live |
| *(no Arrow equivalent)* | — | **MutualCredit** p2p credit lines in chat + **agent gateway** (A2A/MCP/x402 + MPC signer). Our moat beyond Arrow-parity. | Contracts/rails exist; wire-up to build |

Stablecoin note: Arrow's core is minting their own aUSD. A Suwappu stable (suUSD) is
the Phase-4 decision, NOT the start — Felix already runs a Liquity-style CDP on HL,
and a stable is a regulatory/peg-defense commitment. Fixed-rate borrow of existing
stables delivers Arrow's user promise without that liability. Revisit after Phase 2
traction. (Original-vision check per CLAUDE.md: this is a deliberate scope call to
surface, not silent shrinkage — flagging it here for an explicit go/no-go.)

## Phases

- **Phase 0 (unblocked now):** deploy MutualCredit + TimeCurve to HyperEVM testnet
  998 per `contracts/DEPLOY_HYPEREVM.md`; wire a minimal `/credit` chat flow.
  Blocked only on a funded testnet deployer key.
- **Phase 1 — Swap (own the execution):** design + build `SuwappuRouter.sol`
  (CoreWriter IOC orders against HyperCore spot, slippage bound, fee bps, permanent
  parameter immutability to match our primitives' ethos). Route bot/api-ts swap
  paths for HL through it behind a feature flag. MONEY-PATH: `money-path-reviewer`
  + `/audit` before any mainnet use.
- **Phase 2 — Borrow:** identify/vet a staked-HYPE ERC-4626 (Kinetiq-class LST
  vault) as collateral; deploy AmortizingVault against it; `/borrow` in chat +
  webapp. Marketing claim "first fixed-rate amortizing loans on HL" only after the
  verification debts in the differentiation doc are cleared.
- **Phase 3 — Launch:** TimeCurve launchpad UX + HIP-1 graduation path.
- **Phase 4 — decisions:** suUSD stable go/no-go; HIP-3 venue (500k HYPE stake)
  go/no-go; tokenized-equity collateral once HL equity exposure is investable
  on-chain.

## Immediate blockers (user input needed)
1. Funded HyperEVM testnet deployer key (Phase 0 is otherwise ready).
2. suUSD stable: park or pursue (recommendation: park until Phase 4).
3. Confirm Phase-1 router fee level intent (bps to treasury) — parameter will be
   immutable.
