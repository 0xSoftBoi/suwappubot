# Going all-in on Hyperliquid: launching "primitive contracts as a HIP-4"

*Research findings, 2026-08-31. Sources: Hyperliquid GitBook, The Block, CoinDesk, Chainstack, FalconX; repo audit of current Hyperliquid support.*

## Bottom line

**HIP-4 is real, but it is not a launch slot we can use today.** HIP-4 is Hyperliquid's
*outcome-markets* (prediction-market) primitive — fully-collateralized YES/NO binary
contracts on an on-chain CLOB. It went to mainnet on **2026-05-02**, but only in its
**Phase 1, validator-curated** form: markets are deployed by Hyperliquid/validators, not
by outside teams. **Phase 2 (permissionless builder deployment) is not live and has no
confirmed date.** So "launch our primitives as a HIP-4" is not currently possible unless
our primitive is literally a binary outcome market *and* we wait for Phase 2.

The right path depends on what "our primitive contracts" actually are — this is the
product decision that gates everything:

| If our primitive is… | The mechanism is… | Available today? | Cost / risk |
|---|---|---|---|
| A binary / outcome / prediction instrument | **HIP-4** builder deployment | **No** — Phase 2 permissionless deployment not live, no ETA | Stake reported at 500k–1M HYPE (unverified, sources conflict); slashing for bad settlement |
| A perp-style market or trading venue | **HIP-3** builder-deployed perps | **Yes** (live since Oct 2025) | **500,000 HYPE staked** (~$20M+ order of magnitude), ≥183-day lock, validators can slash up to 100% |
| Ordinary Solidity/DeFi contracts | **HyperEVM** deployment | **Yes**, fully permissionless — no HIP needed | Normal gas; chain id 999 (mainnet) / 998 (testnet) |
| A spot token | **HIP-1** ticker auction | Yes | 31-hour Dutch auction in HYPE, 500 HYPE floor |

## The HIP landscape (confirmed)

- **HIP-1** — native spot token standard; deployment gas via 31h Dutch auction paid in HYPE.
- **HIP-2** — Hyperliquidity: protocol-native two-sided orderbook liquidity for HIP-1 tokens.
- **HIP-3** — builder-deployed perpetuals, mainnet since 2025-10-13. Any 500k-HYPE staker
  can run an independent perp DEX on HyperCore (own assets, oracle, leverage caps),
  inheriting Hyperliquid's matching/margin/liquidation engine. Fee split 50/50
  deployer/protocol. By July 2026: $3.9B ATH open interest, >$25B cumulative volume,
  35%+ of platform volume. Top deployers: TradeXYZ/Unit (>90% of HIP-3 OI), Felix,
  Ventuals, HyENA, Kinetiq; Kraken reportedly testing a compliant HIP-3 DEX.
- **HIP-4** — outcome markets. Testnet March 2026, mainnet 2026-05-02 (BTC daily binaries,
  zero-fee-to-open, settle in USDH). Phase 1 = curated/validator-deployed (current).
  Phase 2 = permissionless builder deployment (**not live**). Each deployer gets ~100
  outcome slots (200 outcome tokens), reusable after settlement. Validators can slash
  deployer stake for ill-defined markets, wrong settlement, or failure to settle within
  1 week. **Stake amount unresolved**: secondary sources conflict between 500k and 1M
  HYPE — verify against the primary GitBook spec before any budgeting.

## What we already have (repo audit)

Hyperliquid is already a **production surface** for us, not greenfield:

- Perps trading live end-to-end: `bot/services/hyperliquid_client.py`,
  `hyperliquid_signing.py`, `perps_service.py`, `bot/handlers/perps.py` (up to 20x,
  TP/SL, builder-fee approval, liquidation/margin logic).
- Funding rails: `hyperliquid_funding.py` (USDC via Across) + `hyperunit_api.py`
  (native BTC/ETH/SOL via HyperUnit MPC); CCTP→HyperCore path stubbed
  (`cctp_hypercore.py`).
- Ecosystem features: staking/vault/TWAP commands (`bot/handlers/hl_ecosystem.py`),
  WS alerts (`hl_ws_alerts.py`), monitoring (`hl_ecosystem_monitor.py`).
- API + DB: `api-ts/src/services/HyperliquidService.ts`, `api-ts/src/routes/perps.ts`,
  perps/HL tables in both ORMs.
- **HyperEVM already registered** in `api-ts/src/config/chains.ts` (chain id 999,
  `HYPEREVM_RPC_URL`, fallback `https://rpc.hyperliquid.xyz/evm`).
- Docs: `docs/features/hyperliquid.md`.

**Gap:** we have **zero smart-contract tooling** — no foundry/hardhat, no deployment
pipeline, no audited in-house contracts (the only `contracts/` content is vendored
OpenZeppelin). "Launching primitive contracts" of any kind means standing up a contract
dev/audit/deploy pipeline from scratch.

## HyperEVM mechanics (relevant on every path)

- Standard EVM, permissionless deploys. Mainnet chain id **999**, testnet **998**.
- Contracts read HyperCore state (orderbook, positions, balances) via **precompiles**
  and write actions back via the **CoreWriter** system contract — both permissionless.
- A HyperEVM ERC-20 can be linked to a HIP-1 spot asset through the standard auction.

## Recommendation

1. **Decision needed (blocks everything):** define what "our primitive contracts" are.
   - Outcome/prediction instrument → target **HIP-4 Phase 2**; can't launch yet — build
     on testnet/HyperEVM in the meantime and watch for the permissionless opening.
   - Perp venue → **HIP-3** is live but requires ~500k HYPE staked ≥183 days with up to
     100% slashing risk — a treasury/legal decision, not an engineering one.
   - General DeFi contracts → **HyperEVM today**, no stake, no HIP, no gate.
2. **Lowest-risk "all-in" start:** deploy on HyperEVM (testnet 998 → mainnet 999) using
   CoreWriter/precompiles to compose with HyperCore liquidity. This leverages everything
   we already run in production and requires no HYPE stake.
3. **Verify before budgeting:** pull the primary HIP-4 GitBook spec to resolve the
   500k-vs-1M HYPE stake conflict, and confirm current HIP-3 stake terms.
4. **MONEY-PATH:** any build here touches swap execution/custody and, on HIP-3/HIP-4,
   a slashable multi-million-dollar stake — `money-path-reviewer` gate on every diff,
   and a security audit before any mainnet contract deploy.
