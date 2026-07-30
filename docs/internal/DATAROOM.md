# Suwappu — Dataroom

> Source-of-truth brief assembled directly from the codebase (contracts, bot, api-ts, gitbook).
> Every number below is cited to a file. Flagged discrepancies are noted honestly — resolve before
> publishing externally.

---

## 1. One-liner

Suwappu is cross-chain DEX/trading infrastructure for **humans and AI agents** — swap, perps,
prediction markets, and lending across 15–37 chains, reachable via Telegram, WhatsApp, Discord,
a web terminal, an iOS app, and three machine protocols (REST, MCP, A2A).

**Marketing tagline (`showcase/src/app/page.tsx`):**
"One execution workspace for terminal trading, agent APIs, wallet rails, bot commands, and
route-aware swaps."

---

## 2. Token: SUWP

**Contract:** `contracts/SUWP.sol` (ERC-20) and `contracts/SuwpOFT.sol` (LayerZero omnichain version).
Canonical chain: **Base**.

| Property | Value | Source |
|----------|-------|--------|
| Name / Symbol | Suwappu / SUWP | `SUWP.sol` |
| Decimals | 18 | ERC-20 default |
| Supply cap | **None** — emission governed by `MINTER_ROLE` (protocol multisig); minter can be revoked to freeze supply permanently | `SUWP.sol` header |
| Mint reasons | `points_claim`, `staking_emission`, `bond_vest` | `SUWP.sol`, `SuwppuBonds.sol` |
| Transparency | `totalMinted` tracked on-chain; every mint emits `Minted(to, amount, reason)` | `SUWP.sol` |
| Controls | `Pausable` (PAUSER_ROLE), `AccessControl` | `SUWP.sol` |
| Omnichain | `SuwpOFT` = OFT (ERC-20 + LayerZero). Mint only on canonical chain (Base); other chains receive via burn/mint OFT transfer. Requires ≥2 DVNs (LayerZero + Google Cloud) | `SuwpOFT.sol` |

### Emission sources (the only two ways SUWP enters circulation)

1. **Points → SUWP conversion** at **1,000 points = 1 SUWP**
   - `bot/services/staking_service.py`: `POINTS_PER_SUWP = 1000`
   - Min claim 1,000 pts; claims floored to whole-SUWP multiples; points burned off-chain, SUWP minted on Base.
2. **Staking epoch bonus emission** of **10,000 SUWP / week**
   - `bot/services/staking_service.py`: `WEEKLY_SUWP_EMISSION = Decimal("10000")`
   - Mirrored in TS schema default `suwpEmission = '10000'` (`api-ts/src/db/schema/tokenStaking.ts`).

---

## 3. Staking — `contracts/SuwppuStaking.sol` (v2)

Stake SUWP, earn **two** reward streams:

1. **USDCx streaming, real-time, via Superfluid GDA pool** — pro-rata to stake, accrues per-second
   with no claim/batch step. Protocol calls `fundStream(usdcAmount, durationSeconds)` each epoch
   (weekly) to set the pool flow rate.
2. **Weekly SUWP bonus** (the 10,000/week) — amounts pre-computed off-chain from an **epoch-start
   snapshot** and pushed via `distributeSuwpBonus(stakers[], amounts[])`, then claimed by stakers.
   Snapshot-based by design: blocks flash-stake front-running of a bonus the staker didn't hold.

**Key mechanics & safety:**
- `MIN_STAKE = 1e9` (below this, unit conversion rounds to 0).
- Pool units = SUWP / 1e9 (uint128) → supports ~340B SUWP staked.
- `emergencyUnstake()` — returns principal even if Superfluid reverts (only while paused);
  pool unit update is best-effort so an external outage can never trap principal.
- `recoverToken()` can never pull staked principal or unclaimed bonuses (`totalStaked +
  totalPendingBonuses` protected).
- Per-call `forceApprove` for USDC→USDCx wrap — no standing allowance.
- Verified live on Base Sepolia: 5,000 SUWP staked → ~0.000115 USDCx/sec (~9.94 USDCx/day).

**Live testnet addresses & verification:** see `contracts/DEPLOYMENTS.md`.

---

## 4. Bonds (Protocol-Owned Liquidity) — `contracts/SuwppuBonds.sol`

Olympus-style bonding. Users sell **SUWP/USDC Uniswap v3 LP NFTs** to the treasury and receive
discounted SUWP that vests; protocol keeps the LP permanently (POL).

| Parameter | Value | Source |
|-----------|-------|--------|
| Vesting | **7 days** (`VESTING_DURATION`) | `SuwppuBonds.sol` |
| Discount | **5%** below TWAP (`DISCOUNT_BPS = 500`); max settable 20% | `SuwppuBonds.sol` |
| Pricing oracle | **30-min Uniswap v3 TWAP** (`TWAP_PERIOD = 1800`) — anti-manipulation | `SuwppuBonds.sol` |
| Per-bond mint cap | 1,000,000 SUWP | `maxSuwpPerBond` |
| Global bond cap | 50,000,000 SUWP cumulative | `globalBondCap` |
| LP valuation | LP decomposed at **TWAP, not spot** (flash-loan overmint blocked — fixed in 2nd audit pass) | `DEPLOYMENTS.md` |
| Escape hatch | `cancelBond()` returns LP if protocol can't honor (e.g. MINTER_ROLE revoked) | `SuwppuBonds.sol` |

Requires `MINTER_ROLE` on SUWP to mint vested tokens. Uses CEI pattern + `nonReentrant` on `bond()`.

---

## 4b. Emissions policy

> **Status: PROPOSED.** The contracts today enforce **no global cap** — `SUWP.mint()` is gated only
> by `MINTER_ROLE`. The schedule below is the policy I recommend committing to publicly and enforcing
> operationally (and, ideally, in a `Minter`/emissions-manager contract) before mainnet. Numbers are
> derived from the rates already hard-coded in the code; nothing here contradicts the contracts.

### What the code already fixes
| Source | Rate (in code) | Annualized | Cap |
|--------|----------------|------------|-----|
| Staking bonus emission | 10,000 SUWP / week (`WEEKLY_SUWP_EMISSION`) | **520,000 SUWP/yr** | none today |
| Points → SUWP | 1,000 pts = 1 SUWP (`POINTS_PER_SUWP`) | demand-driven | none today |
| Bond vesting | 5% discount, 7-day vest | per-bond ≤1M | **50M global** (`globalBondCap`) |

### Proposed policy (recommended to adopt)

1. **No fixed max supply, but a hard annual emission ceiling.** Commit to a per-year mint cap
   enforced by an emissions-manager contract. Suggested **Year 1 ceiling: 5,000,000 SUWP** across
   *all* sources combined (staking + points + bonds), leaving headroom above the ~520k known
   staking floor for points/bond demand.

2. **Per-source sub-budgets (Year 1):**
   - Staking emissions: **520,000** (fixed, 10k/wk — the floor).
   - Points conversions: **≤ 2,500,000** (demand-driven, but capped; pause conversions if hit).
   - Bonds: **≤ 50,000,000 lifetime** already enforced on-chain, but **draw ≤ 2,000,000 in Year 1**
     via operational pacing.

3. **Decay schedule.** Reduce the staking emission by a fixed factor each year (e.g. **−20%/yr**:
   10k/wk → 8k/wk → 6.4k/wk …) so the curve is disinflationary and predictable. Encode the step in
   the emissions-manager.

4. **Transparency & enforceability.**
   - `totalMinted` is already on-chain and every mint emits `Minted(to, amount, reason)` — publish a
     live dashboard reading these.
   - Route **all** minting through one `MINTER_ROLE` holder (the emissions-manager contract), then
     **revoke `MINTER_ROLE` from every EOA/multisig**, so the annual ceiling is unbypassable.
   - Keep the `pause()` switch as a circuit-breaker.

5. **Freeze path.** `MINTER_ROLE` is revocable — the policy should state the conditions under which
   emissions are permanently frozen (e.g. once protocol fee revenue covers staking rewards, retire
   the SUWP staking bonus and fund stakers purely from the USDCx fee stream).

⚠️ **Engineering gap:** none of points 1–4 are enforced in code yet. There is no emissions-manager
contract and no global cap — minting is unbounded at the `MINTER_ROLE` level. Build the
emissions-manager (or at minimum a cumulative-cap modifier on `mint()`) before mainnet, or the
published policy is a promise the contracts don't keep.

---

## 5. Security posture (on-chain)

- Full toolchain run: **Slither, Aderyn, Mythril, Foundry** + coverage-guided invariant fuzzing
  (Foundry + Medusa both green) — recent commits `89d2941`, `fd4da95`.
- Two audit passes completed; fixes verified on Base Sepolia:
  - 4 critical + 7 high findings fixed in first hardened redeploy.
  - 2nd pass: TWAP LP decomposition (Bonds), removed flow-rate guard that bricked staking epoch 2.
- `bond()` CEI fix landed. Invariant tests in `contracts/test/`.
- **Pre-mainnet TODO (from `DEPLOYMENTS.md`):** transfer ownership/admin of all three contracts to
  the treasury multisig. Mainnet **not yet deployed** — testnet (Base Sepolia, chain 84532) only.

---

## 6. Points / XP engagement system

**5 tiers** (`bot/models/points.py`): Bronze (0) → Silver (1k) → Gold (5k) → Platinum (25k) →
Diamond (100k XP). Higher tiers = lower fees + (Diamond) revenue share.

**Earning (`bot/models/points.py`):** daily check-in 10 · swap 1pt/$10 · first swap of day 50 ·
referral signup 500 · referral's first swap 200 · Twitter share 25 · level-up 100 · streak 5/day ·
copy trade 10 · get copied 5.

Points are the **top of the token funnel**: earn points → convert 1,000:1 to SUWP → stake SUWP →
earn USDCx stream + more SUWP. This is the core flywheel.

---

## 7. Fees & referrals — RESOLVED (canonical model)

I traced the live code path. The fee that **actually gets charged** is the **subscription-tier**
table. The other two tables are stale/unwired.

**Canonical execution path:**
`bot/handlers/swap.py:756` → `x402_service.get_tier(user_id)` → returns `SubscriptionTier`
(falls back to FREE if subscription expired) → `fee_service.calculate_fee_with_price(tier=…)` →
`TIER_FEE_RATES[tier]`.

**✅ Authoritative swap-fee table** (`bot/services/fee_service.py`, `TIER_FEE_RATES`):

| Subscription tier | Swap fee | Monthly price |
|-------------------|----------|---------------|
| Free (default)    | **1.0%** | $0 |
| Pro               | **0.5%** | $9.99 |
| Premium           | **0.3%** | $29.99 |
| Enterprise        | **0.1%** | $99.99 |

Source: `bot/services/fee_service.py` (`TIER_FEE_RATES`), `bot/models/subscription.py` (prices).

**Referral:** referrer earns **30% of the fee** (`REFERRAL_REWARD_PERCENTAGE = 30`).

**Fee allocation (runtime):** **40% staking pool / 60% protocol treasury**
(`calculate_fee`: `staking_allocation = fee*0.40`, `protocol = fee*0.60`).

### Dead / unwired code to delete or rewire (not part of the live model)
- **XP-tier fees** (`bot/models/points.py` `get_fee_discount()`, Bronze 0.8% → Diamond 0.4%):
  defined but **never called** in the swap fee path. Display/legacy only — do **not** quote these.
- **Reward-store "Fee Discount" items** + `fee_discounts` table (`bot/models/token.py`):
  written on purchase but **never read** by `calculate_fee` — buying one has **no effect** on the
  fee charged today. Either wire it in or remove the store item.
- **Legacy flat 0.8%** (`SWAP_FEE_PERCENTAGE`): kept "for backward-compat reference only," unused.

### Bugs found while tracing — ✅ FIXED
1. **Stale comments in `FeeCalculation`** (`fee_service.py`) said "20/80 split" while the code
   computed 40/60, and the class docstring claimed "0.8% flat / 0.56% net." Comments + docstring
   corrected to the tiered model (1.0/0.5/0.3/0.1%) and the 40/60 net split.
2. **Allocation didn't reconcile with referral.** `referral_reward` is 30% of *gross* fee, but the
   `staking_allocation` (40%) and `protocol_allocation` (60%) were also computed off *gross* —
   30%+40%+60% = 130%. The 40/60 split now applies to `net_fee` (post-referral), so
   referral + staking + protocol == fee (locked by `tests/test_fee_service.py`). The fields had no
   consumers yet, so this was a latent fix made before they get wired to fund staking.
   Also fixed the user-facing `format_fee_info()`, which had advertised the legacy flat 0.8%.

---

## 8. Product surface (what's actually built)

**Chains:** gitbook claims **15+** (ETH, Base, Arbitrum, OP, Solana, Polygon, BSC, Avalanche,
Fantom, Linea, Mantle, Gnosis, Scroll, Sui, TON, Tempo). `bot/config/chains.py` defines **~37**
networks incl. Solana + TRON. ⚠️ Reconcile the public number.

**Swap routing:** 9–10 providers with priority routing + MEV protection — CoW Protocol, Socket,
Jupiter, Jito, Li.Fi, Circle CCTP (0 fee), Across (~0.04%), Wormhole, LayerZero/Stargate, Chainlink CCIP.

**Trading modules:** cross-chain swaps · limit orders · DCA · token sniping (Pump.fun/Raydium) ·
perps (HyperLiquid, 10 markets, up to 20x) · copy trading (follow ≤5) · prediction markets
(Polymarket) · lending (Morpho).

**Agent layer (3 protocols):** REST `/v1/agent/*` (50+ endpoints) · MCP server (8 tools, published
`@suwappu/mcp-server`) · A2A natural-language `/execute`. Discovery via `llms.txt`,
`.well-known/agent.json`, OpenAPI 3.1.

**Frontends:** Telegram bot (27 commands) · web terminal (`terminal.suwappu.bot`, Hyperliquid/Axiom
parity, 74 Playwright E2E tests) · WhatsApp · Discord · iOS (Expo, 49 screens) · React Mini App.

**Security features:** anti-rug engine (0–100 score, honeypot/mint/freeze checks) · tx simulation ·
KMS AES-256-GCM wallet encryption (`kms_aesgcm_v2`) · Turnkey TEE wallets · TOTP 2FA · spending
limits · withdrawal whitelisting.

**Published SDKs:** `@suwappu/sdk` 0.3.0 · `@suwappu/mcp-server` 0.5.0 · `@suwappu/openclaw` 0.2.0.

---

## 9. Infrastructure

- **Python monolith** (`api/` + `bot/`): FastAPI + Telegram bot + legacy API. Background tasks:
  fee_sweeper, alert_service, order_service, tx_poller, health_monitor, launch_detector.
- **TS API** (`api-ts/`): Hono + Effect-TS + Drizzle ORM. JWT auth, MCP, A2A.
- DB: SQLite (dev) → PostgreSQL (prod); additive runtime migrations via `_ensure_schema()` (no Alembic).
- Deploy: **Railway** (prod `main`, dev `dev`) — Docker-image build per service
  (`railway.python-api.json`, `railway.terminal.json`, `api-ts/railway.json`,
  `showcase/railway.json`; `.github/workflows/deploy-railway.yml`). The earlier AWS ECS
  Fargate setup was retired, and the stale GitHub↔Vercel project link was disabled
  (`vercel.json` → `git.deploymentEnabled: false`).

---

## 10. Status & honest gaps (read before sending out)

1. **Mainnet not deployed** — all contract addresses are Base Sepolia testnet.
2. **Multisig transfer pending** — contracts still owned by standalone testnet key.
3. **Fee model — RESOLVED** (§7): canonical = subscription tiers 1.0/0.5/0.3/0.1%; the gross-vs-net
   allocation bug is now **fixed** (§7). Dead XP-fee and reward-store-discount code still exists but
   is cosmetic — it's not in the live fee path.
4. **Chain count varies** (15+ vs ~37) across docs — pick the defensible figure.
5. **No traction metrics in code** — no users/volume/TVL claims exist in the repo; supply real
   numbers separately, don't infer them.
6. **Emissions policy DRAFTED (§4b) but NOT ENFORCED** — SUWP is uncapped + minter-governed. The
   proposed schedule needs an emissions-manager contract (or a cumulative-cap modifier on `mint()`)
   before mainnet, or the published policy is unenforceable. Only on-chain limit today: bond caps
   (1M/bond, 50M global).

---

### Primary source files

`contracts/SUWP.sol` · `contracts/SuwpOFT.sol` · `contracts/SuwppuStaking.sol` ·
`contracts/SuwppuBonds.sol` · `contracts/DEPLOYMENTS.md` · `contracts/SECURITY.md` ·
`bot/services/staking_service.py` · `bot/models/points.py` · `bot/models/subscription.py` ·
`bot/services/fee_service.py` · `bot/config/settings.py` · `bot/config/chains.py` ·
`api-ts/src/db/schema/tokenStaking.ts` · `gitbook/README.md` · `terminal/TERMINAL.md` ·
`showcase/src/app/page.tsx`
