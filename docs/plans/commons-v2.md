# Suwappu Commons v2 — an ownerless credit-clearing network

Status: **design, not built** · 2026-11-06 · supersedes nothing yet (v1 stays deployed on Base Sepolia)
Inputs: four research passes (mutual credit, yield-backed lending, curves + public-goods funding, critical v1 review) + direct source verification of the v1 findings. Every v2 contract is MONEY-PATH: money-path-reviewer + security-auditor per phase, independent audit before any mainnet.

---

## 0. TL;DR

v1 is three sound but **disconnected** bricks (TimeCurve, AmortizingVault, MutualCredit). They share no interfaces, the vault's "amortizing" claim overstates the code, MutualCredit has a real terms-swap bug, and the curve's surplus is trapped with no recipient. As built, they are three demos, not a Commons.

v2 turns them into **one system with five immutable layers**, each standalone so a failure stays local:

| Layer | Contract | Job | Builds on v1 |
|---|---|---|---|
| L1 Clearing | `CommonsClearingHouse` | bilateral credit lines + **verified multilateral clearing** + opt-in routing + signed intents | MutualCredit |
| L2 Collateral | `SelfRepayingMarket` (+ factory) | yield-bearing collateral repays its own debt; markets are ERC-4626 so they compose | AmortizingVault |
| L3 Backing | `CreditBacking` | guarantors stake L2 shares behind a debtor; explicit loss waterfall on default | new |
| L4 Issuance | `DemurrageCurve` | bonding curve whose time-decay releases a **provably solvent surplus** to a beneficiary | TimeCurve |
| L5 Commons | `Splitter`, `YieldDonor4626` | mechanical, vote-free public-goods routing; principal-preserving yield donation | new |

The thesis in one line: **credit extended person-to-person, cleared multilaterally, backstopped by collateral that pays for itself, with the system's natural surplus routed to public goods by fixed rules and never to us.**

Build order: **L1 → L2 → L3 → L5 → L4.** L1 comes first because it is the documented flagship (chat-based credit lines, agent underwriting: `docs/research/hyperliquid-differentiation.md:55-65`). Clearing is also the only mechanism here with measured real-world value.

---

## 1. Why v2, and why this shape

### 1.1 What v1 actually is (verified against source)

| Finding | Severity | Evidence |
|---|---|---|
| **Terms swap on accept.** `acceptLine(proposer, token, myLimit)` commits to no terms. The proposer can `cancelProposal` (status → Closed) and re-`proposeLine` (allowed over Closed) with `feeRate=MAX`, `grace=0`, and the accept lands on the new terms. | **High** (real bug on the deployed testnet contract) | `SuwappuMutualCredit.sol:119-175` |
| Interest accrual ignores credit limits, so balances can exceed the agreed limit. | Medium (by-design debatable; untested) | `SuwappuMutualCredit.sol:336-346`; invariant suite only runs `feeRate=0` |
| Same-block default: `grace=0` lines can be demanded and defaulted in one block. A demand can be re-issued to reset the clock. `defaults[]` is one global, sybil-inflatable counter. | Medium | `SuwappuMutualCredit.sol:91` |
| `netCycle` is single-cycle, O(n²) duplicate check, no incentive. Cycles must be found off-chain, so in practice nobody calls it. | Mechanism gap | `SuwappuMutualCredit.sol:223-237`, `MAINNET_READINESS.md:101-104` |
| Vault security = one external 4626 `convertToAssets` read (LTV, liquidation, seize, yield). No lag, cap or sanity check. | High *if* the 4626's `totalAssets` is manipulable; plain 4626 donations are real value | `SuwappuAmortizingVault.sol:192,264,270` |
| "Amortizing" has no schedule or maturity. Repayment = whatever yield is. Yield below the rate means debt grows. One fixed simple rate for all time; at 100% utilization lenders are stuck (`InsufficientCash`). | Mechanism gap + overclaim | `:310-338`, `:159` |
| Underwater liquidation *works*, but only if the liquidator repays ≈ `value/(1+bonus)`. The terminal UI repaid full debt, which made it unprofitable. **Fixed** in PR #1104 (`e7bbfd29`). | UI bug (fixed) | `:256-290` |
| Curve surplus (decay + sink) has no recipient; `totalSunk` is just a counter. Linear shape only. | Mechanism gap | `SuwappuTimeCurve.sol:131` |
| Tests: 37 unit + stateful invariants + 3 happy-path fork tests. **No** hostile-4626 fuzz, **no** MutualCredit lifecycle/interest invariants, **no** Medusa harness for the primitives (`MedusaHarness.sol` targets Staking). | Coverage gap | `test/Primitives*.t.sol` |

### 1.2 What the research says matters

- **Clearing is the measured value: roughly 10–25% of debt cleared with zero new money.**
  - **Italy (Cycles):** in a simulation on anonymised Italian invoices (1.28M invoices, 760k firms, Dec 2020), "nearly 10% of the debt is in cycles and can still be cleared" with zero liquidity ([arXiv 2507.22309](https://arxiv.org/abs/2507.22309) §2.3, Fig. 10). This is the closest analogue to L1's pure clearing.
  - **Sardex:** clearing alone cut *net internal debt* ~25% on 2019 B2B data (3,199 firms, 138k invoices, €31M). The "~50% with mutual credit" figure uses a *simulated* 2%-of-turnover credit line, and the data covers only the ~10% of trade done in Sardex credits ([Fleischman, Dini & Littera 2020](https://mdpi.com/1911-8074/13/12/295), abstract + p.6).
  - **Slovenia:** annual cleared obligations were ~14–17% of reported obligations in 1992–94. This is derived from the same paper's Fig. 1; there is no per-round figure.
  - **Cycles' solver:** Cycles deliberately does *only* clearing, and its default solver MTCS is **min-cost max-flow**, with non-unique optima. Design for multiple valid solver answers.
- **Off-chain solver, on-chain verifier** is the production pattern. Circles v2 computes max-flow off-chain (pathfinder2) and the contract executes a verified flow matrix ([docs](https://aboutcircles.github.io/circles-contracts-v2/advanced-topics/path-based-transactions)).
- **On one chain, multi-hop is atomic.** One tx updates every edge, so there are no HTLCs and no stuck payments (contrast Interledger/Lightning, [Blitz, USENIX'21](https://www.secpriv.tuwien.ac.at/fulltext/publik_295254.pdf)).
- **Credit fails on concentration and unclear first loss.** Maple/Orthogonal ($36M, one pool ~80% hit) and Goldfinch (~$18M) failed this way. Make the loss waterfall explicit and write down immediately.
- **Oracle-free lending wants Morpho-Blue minimalism + Ajna-style auctions.** Use immutable per-market params, Dutch-auction liquidation bonus, kinked/adaptive IRM ([Morpho IRM](https://docs.morpho.org/morpho/concepts/irm)). **Virtual shares don't protect a lender who prices collateral off someone else's 4626** ([OZ](https://www.openzeppelin.com/news/a-novel-defense-against-erc4626-inflation-attacks)). Defend the read yourself.
- **Shared pro-rata accumulators are where audits find criticals.** Alchemix v3's earmark/cover accounting drew multiple critical/high Immunefi submissions (e.g. [#57582](https://reports.immunefi.com/alchemix-v3/57582-sc-critical-calling-earmark-one-block-apart-skips-the-block-s-earmark-value), [#56740](https://reports.immunefi.com/alchemix-v3/56740-sc-critical-unbounded-liquidation-fee-allows-theft-of-shared-collateral)). Prefer index + per-position snapshots.
- **Public-goods funding that lasts is mechanical and principal-preserving.** Octant donates yield and keeps principal ([growthepie](https://www.growthepie.com/quick-bites/octant-v2-migration)). Optimism's own retro: open voting became popularity contests, and metrics/rules worked better ([OP lessons](https://gov.optimism.io/t/lessons-learned-from-two-years-of-retroactive-public-goods-funding/9239)). Augmented-bonding-curve exit tributes create reflexive sell pressure (TEC post-mortem, *weakly sourced*).

### 1.3 Design principles (inherited + sharpened)

1. **No owner, no upgrade, no governance, no oracle, no protocol fee.** Unchanged from v1.
2. **Each layer is a standalone immutable contract** with narrow interfaces. L1 works with no L2/L3, and L3 failing cannot corrupt L1 balances.
3. **Untrusted computation off-chain, cheap verification on-chain** (solvers for clearing and routing).
4. **Consent is explicit and hashed.** Every term a party is bound by is in a signed or committed hash.
5. **Explicit loss ordering, immediate write-down, no hidden pro-rata state.**
6. **Agent- and relayer-native.** EIP-712 intents for every user action, so the Telegram bot, agents (A2A/MCP) and relayers can drive it without custody.

---

## 2. L1 — `CommonsClearingHouse` (MutualCredit v2)

The core product: credit lines between people who trust each other, **plus a clearing engine that makes the network worth joining.**

### 2.1 Lines

```
Line { limitLo, limitHi        // credit each side extends (max the OTHER may owe it)
       int256 balance          // >0: hi owes lo (v1 convention kept)
       feeRate, grace          // fixed at accept
       flags                   // CLEARABLE (default on), INSURED (see L3)
       lastAccrual, demandTs, demandBy, status, nonce }
```

- **Terms hash (fixes the v1 bug).** `proposeLine` bumps `nonce` and stores `termsHash = keccak(feeRate, grace, proposerLimit, flags, nonce)`. `acceptLine(proposer, token, myLimit, termsHash)` reverts unless it matches. Re-proposing invalidates every outstanding accept.
- **Limits are yours to move.** `setMyLimit(counterparty, token, newLimit)` at any time, no consent needed: it is your own credit. Lowering below current exposure only blocks *new* debt (Sardex-style de-risking without closing the line).
- **Interest vs limits, made explicit.** Principal growth (pay, route, clear) is limit-checked. Accrued interest may exceed the limit (debt is debt), but the line enters `OVER_LIMIT`, which blocks new principal until it is back under. Invariant: `principal ≤ limit` always.
- **Demand / default hardening.** `grace ≥ MIN_GRACE` (immutable, e.g. 1 day). A demand can't be re-issued while one is open. Default records are **per (debtor, creditor, token)**, and cures are recorded too.

### 2.2 Payments and routing

- `pay(to, token, amount)` on a direct line, unchanged.
- `payPath(token, address[] path, amount, maxTotalFee)` is **atomic rippling** across existing lines. Each intermediary `i` must have opted in via `setRoutingPolicy(token, enabled, feeBps)` and is paid its fee in credit on the outgoing leg.
  - **Consent is per outbound line, not per token (corrected after money-path review).**
    - The original argument was "B's debt to C grows, which is identical to B paying C directly". It is **wrong**, because C's limit is unilateral and can be raised after acceptance.
    - Attack: a colluding C raises its limit, then routes a large amount through B. That moves B's debt onto C's terms (up to 50% APR, 1-day grace), and C can default B against its guarantors once L3 exists.
    - Fix shipped in P1: each intermediary sets `routeCap[node][to][token]`. Routing may only grow B's debt to C up to the cap B chose for *that* line. The default is 0.
  - **Failure handling:** if any leg would exceed a limit, the whole tx reverts. A path that changed since it was solved just reverts (no partial state, no HTLCs).
  - Paths are found off-chain (max-flow over public line state). Suwappu runs one solver; anyone can run others.

### 2.3 Clearing (the engine)

```
clear(token, Edge[] edges)   Edge { debtor, creditor, amount }
```

The contract checks, in O(E):
1. Each edge's line is `CLEARABLE` (consented at accept), and `amount ≤ owedBy(debtor, creditor)` *after* earlier edges in the same call. Edges apply sequentially against live state, so duplicate edges can't over-net (this replaces v1's O(n²) duplicate scan).
2. **Conservation:** for every node, Σ in = Σ out. This is tracked with a transient-storage net map plus a touched-node list, and must all be zero at the end.

The result is a circulation: every participant's net position is unchanged, and gross debt falls by Σ amounts. It generalises `netCycle` to many cycles at once, and the solver is untrusted.

- **Why `CLEARABLE` consent exists:** legs can carry different fee rates, so netting changes who earns interest. Parties agree to that once, at line acceptance.
- **Incentive:** debtors save interest, and clearing is cheap on an L2. v2 core pays no solver tip (a tip pool is shared pro-rata state, see §1.2). Suwappu runs the reference solver as a service.
- **Gas (measured, cold storage via `vm.cool`, P1 build):**

  | Edges | First-ever clear | Steady state (standing slots already set) |
  |---|---|---|
  | 10 | 453k | 248k |
  | 50 | 2.08M | 1.23M |
  | 100 | 3.66M | 2.45M |

  Steady state is ~24.5k gas/edge, and a regression past 27k/edge fails the suite. First-ever clears pay the 0→non-zero `standing` SSTOREs. Even E=100 is a small fraction of a Base block.

### 2.4 Signed intents (agent/relayer-native)

EIP-712 `Intent { action, params, nonce, deadline }` for propose/accept/pay/payPath/settle/setMyLimit, executed by anyone via `execute(intent, sig)`. ERC-1271 is supported, so smart accounts and agent wallets can sign.

This is what lets a Telegram contact accept a line or pay an IOU from chat while the bot relays without ever holding keys. It is the product described in `hyperliquid-differentiation.md`.

### 2.5 Standing (reputation substrate, not a score)

The contract exposes per-address counters: `settledVolume`, `clearedVolume`, `defaults`, `cures`, `oldestActiveLine`.

There is deliberately **no score and no token**. Research found no robust on-chain sybil-resistant reputation. L3 guarantors are the sybil resistance: real stake behind real people. Limits that grow with cleared volume (Sardex caps balances at ~10% of turnover, [Monneta](https://monneta.org/en/sardex/)) are a **client/policy** feature reading these views, not consensus logic.

### 2.6 Settlement

`settle(creditor, token, amount)` and `settleFor(debtor, creditor, token, amount)` let anyone pay down someone else's debt, which L3 needs.

- **Settlement is pull-based (review fix).** Tokens move payer → contract and credit `claimable[creditor][token]`, and the creditor later calls `withdraw(token, to)`.
  - A creditor can therefore never make repayment revert (receive hooks, blacklists) and then claim default.
  - A blacklisted creditor can withdraw to another address.
- `payer == creditor` is rejected, so there are no free round-trips to farm standing.
- Fee-on-transfer tokens are rejected by balance-diff.
- A creditor may `writeOff` a debt. This closes a Defaulted line, stops its interest and frees the key; it is recorded in standing.
- Standing counters are **per (address, token)** and explicitly self-dealable (sybils can farm volume for gas). Readers must weight them by counterparties they independently trust.

---

## 3. L2 — `SelfRepayingMarket` (AmortizingVault v2)

The productive-collateral layer. **Renamed honestly**: there is no schedule, so "self-repaying", not "amortizing".

### 3.1 Shape

- `MarketFactory` deploys **one immutable clone per market** (the immutable-args clone pattern already used in `contracts/hypercore/`). Params: collateral 4626, IRM constants, LTVs, auction params, keeper tip, guard params.
- **Each market is itself an ERC-4626** (lender shares) and an **ERC-721** (borrow positions). This is chosen over a Morpho-style singleton for composability: lender shares become standard yield-bearing collateral for L3 backing, L5 donation, or another market. Positions become transferable and can serve as backing.

### 3.2 The guarded share price (fixes the v1 core risk)

`GuardedPrice` library, shared by L2, L3 and L5. It is modelled on **Aave CAPO**, the production design for capping exchange-rate collateral ([README](https://raw.githubusercontent.com/bgd-labs/aave-capo/main/src/contracts/README.md)):

```
maxPrice(t)  = snapshot.price + maxGrowthPerSec · (t − snapshot.ts)
price(t)     = min(spot, maxPrice(t))
```

- **The snapshot must roll itself.** CAPO's lesson is that a cap only works if the snapshot is refreshed. Aave's sUSDe snapshot went 458 days stale and the cap drifted 52% above realised yield ([LlamaRisk, Apr 2026](https://governance.aave.com/t/direct-to-aip-capo-snapshotratio-update-across-aave-v3/24854)). With no governance here, the snapshot rolls permissionlessly: once `t − snapshot.ts ≥ MIN_SNAPSHOT_DELAY` (CAPO uses 7–14 days), any interaction sets `snapshot = (price(t), t)`. That is the *capped* value, never a raw spot spike, so the guard can never go stale and never ratchets up on a donation.
- **Parameters:** `maxGrowthPerSec` is immutable per market. CAPO's real settings are 8–11%/yr for LSTs and sDAI. Pick conservatively, since a market can't be retuned and a new market is the only fix.
- **Borrow / withdraw-collateral / liquidation** all use `price(t)`. Downward moves pass through immediately, which is conservative for lenders.
- **Amortize** credits only yield visible in `price(t)`, so a donation spike can never be swept into debt repayment.

The incidents this defends against, and the rule each one adds:

| Incident | Mechanism | Defense adopted |
|---|---|---|
| Hundred Finance, Apr 2023, ~$7M ([Halborn](https://halborn.com/blog/post/explained-the-hundred-finance-hack-april-2023)) | Donation into an *empty* market inflated the exchange rate | **Factory seeds every market atomically at creation** (dead shares) |
| Sonne, May 2024, ~$20M ([CertiK](https://www.certik.com/blog/sonne-finance-incident-analysis)) | Same bug; attacker front-ran a staged seeding | Seeding in the **same tx** as creation, never staged |
| Raft, Nov 2023, ~$3.3M ([CoinDesk](https://www.coindesk.com/tech/2023/11/10/defi-platform-raft-suffers-33m-exploit-but-hacker-likely-takes-a-loss-on-the-attack)) | Donation + rounding manipulated an index rate | Rate growth cap + virtual offset |
| Resupply, Jun 2025, ~$9.6M ([Ackee](https://ackee.xyz/blog/resupply-hack-analysis/)) | Lender read a just-inflated 4626 `pricePerShare` live | **This is exactly v1's read path.** The capped `price(t)` fixes it |
| Euler, Mar 2023, ~$197M ([Zellic](https://www.zellic.io/blog/euler-finance-exploit-analysis)) | `donateToReserves` skipped the health check, so self-made bad debt | **Health check on every balance-reducing action** (a cap would not have helped) |

Morpho's own oracle reads 4626 conversions live and warns that "vaults that can receive donations shouldn't be used" ([source](https://raw.githubusercontent.com/morpho-org/morpho-blue-oracles/main/src/morpho-chainlink/MorphoChainlinkOracleV2.sol)). v2 builds the guard in rather than relying on deployer care.

Honest limit: the guard bounds how fast the read can *rise*, but a 4626 whose `totalAssets` can be made to *fall* or lie is still dangerous. The UI warns on thin, illiquid or unknown collateral vaults.

### 3.3 Rates, liquidation, keepers

- **Kinked utilization IRM** with immutable constants and a **compounding index** (per-accrual linear, Compound-style). Rates spike near 100% utilization, which pulls lenders' cash back. This fixes v1's stuck-at-100% problem.
  - Reference point from Morpho's deployed AdaptiveCurveIRM ([ConstantsLib](https://raw.githubusercontent.com/morpho-org/morpho-blue-irm/main/src/adaptive-curve-irm/libraries/ConstantsLib.sol)): 90% target utilization; rate-at-target bounded to 0.1%–200% APR; steepness 4, so the absolute ceiling is **800%** at 100% utilization.
  - v2 starts with a *static* kink (no adaptive state, so no extra accumulator to audit). An adaptive curve is a v2.1 candidate.
- **Dutch-auction liquidation**:
  - permissionless `flag(id)` records `unhealthySince` (and reverts if healthy);
  - `bonus(t) = min(maxBonus, minBonus + k·(t − unhealthySince))`;
  - partial liquidation with a close factor;
  - when collateral < debt, seize-all plus **immediate** bad-debt write-off against lender share price.
  - This replaces v1's fixed bonus, which overpays when healthy-ish and underpays when deep underwater. A Morpho-style pre-liquidation tier is deferred to v2.1.
- **Keeper tip on `amortize`.** An immutable `tipBps` (≤ 1%) of credited yield goes to the caller, so self-repayment actually happens instead of waiting for altruists.
- **Payoff view.** `projectedPayoff(id)` = debt / (collateral yield rate − borrow rate) from the checkpoint history. If yield is below the rate, the UI shows "debt growing" plainly.

### 3.4 Explicitly not built

Alchemix-style synthetic debt + transmuter + earmarking.

Alchemix v3 charges **no ongoing borrow APR** because its debt is a self-minted synthetic whose peg is held by Transmuter redemptions (1:1 into MYT after a term, a 0.50% redemption fee, time-weighted earmarking). Its liquidation backstop is a 95% LTV ([ALEA](https://www.alearesearch.io/reports/deep-dives/alchemix-v3)). Its Immunefi competition logged many critical/high findings in exactly that earmark/redeem accounting ([reports](https://reports.immunefi.com/alchemix-v3)).

v2 lends *real* lender money instead, so it must charge interest. That means yield below the rate makes debt grow. This is the honest trade: no synthetic peg to defend, but no free self-repayment either. The UI's payoff projection makes it visible.

---

## 4. L3 — `CreditBacking` (connects L1 ⇄ L2)

This is what turns trust-only credit into underwritten credit, without oracles or a score.

### 4.1 Backing

- A **guarantor** deposits 4626 shares (typically L2 lender shares, so they keep earning while backing) into a slot `(debtor, token)` with a cap and an optional creditor allow-list.
- The **debtor** may post a **self-bond** (first loss, signals skin in the game).
- The **mutual pool** is open 4626 deposits that back any `INSURED` line, with a per-claim cap (% of pool) and a per-debtor cap. Concentration caps are the Maple lesson.

### 4.2 Loss waterfall (on an L1 default)

Once L1 records `markDefault(debtor, creditor, token)`, the creditor calls `claim(...)`. The owed amount is paid, in order, from:

1. the debtor's self-bond,
2. named guarantors, pro-rata within their caps,
3. the mutual pool, up to its caps.

Shares are redeemed to the line token, which must equal the 4626 asset. `CreditBacking` then calls L1 `settleFor`, which cures the line. Each payer receives a **recourse record** (debtor owes the guarantor/pool), visible in standing.

Write-down is immediate, and there are no cumulative pro-rata accumulators beyond per-slot balances.

### 4.3 Who pays for insurance

Lines flagged `INSURED` at accept route an agreed `premiumBps` of the **creditor's interest** to the mutual pool. Creditors buy coverage with part of their yield, and pool LPs earn it.

This is a priced market, not a subsidy, and it's agreed in the terms hash. It's the Sardex/joint-liability idea made explicit. It ships in phase 3 only if L1 interest flows are proven in testnet use. Otherwise the pool starts as pure backing.

---

## 5. L4 — `DemurrageCurve` (TimeCurve v2)

v1's decaying multiplier already makes the reserve exceed what's needed to buy everyone back. v2 **releases that excess** instead of trapping it:

```
obligation(t) = (1 − sink) · m(t) · ∫₀ˢ (base + slope·x) dx       // cost to redeem ALL supply now
surplus(t)    = reserve − obligation(t) − margin  ≥ 0
release()     → sends surplus to an immutable beneficiary (any address; typically an L5 Splitter)
```

The solvency invariant `reserve ≥ obligation(t)` holds after every release, by construction (round obligation **up**, plus a dust margin).

Because `m(t)` decays, `obligation` shrinks continuously and surplus accrues. The decay is effectively **transparent demurrage that funds the beneficiary**, the way Circles runs a known demurrage rate.

Unlike an augmented bonding curve's exit tribute, nobody is penalised for leaving, so there is no exit spiral. The cost is a known, published rate on holding.

The evidence on exit tributes:
- **Token Engineering Commons** wound down, and holders now claim pro-rata through an official shutdown contract ([CommonsBuild/tec-shutdown](https://github.com/CommonsBuild/tec-shutdown)).
- A third-party post-mortem (secondary, not official) reports what happened on its ABC ([analysis](https://gitea.jeffemmett.com/jeffemmett/TEC-analysis/raw/branch/dev/docs/synthesis.md)):
  - 2,217 sells vs 398 buys, and price down 88% by Dec 2023;
  - ~330k xDAI of lifetime exit tribute, which "couldn't offset the drain";
  - by Q1 2025, tribute of ~$3.6k a quarter against ~$42k of costs.

An ABC used mainly as an exit, funded by taxing that exit, starves exactly when it is used.

Also in v2: a factory, ERC-2612 `permit`, rate bounds at deploy (reject schedules that hit v1's `e^-41` floor within 100 years), and blocking transfers to the curve itself.

**Honest priority: last.** Demand for a demurrage token is unproven outside community-currency settings. Its strongest role here is as a *funding source* for L5, or as a community unit of account for L1 lines. Build it only after L1–L3 show usage.

---

## 6. L5 — Commons routing

- **`Splitter`.** Immutable recipients and weights, pull-based, any token. Splitters can be recipients of splitters, which forms a dependency graph (Drips / deep-funding shape) **without voting**. Anyone can deploy competing splitters, so capturing one is not fatal.
- **`YieldDonor4626`.** Wraps any 4626 (including L2 lender shares). **Principal is always withdrawable.** Only the guarded-price gain above principal is claimable to an immutable splitter (the Octant v2 model).
  - Composition example: lend to self-repaying borrowers, and the interest funds open-source maintainers.
- **Where public-goods money comes from:** L4 surplus, opt-in yield donation, and an optional per-market beneficiary chosen by the market deployer at creation. **Never a protocol fee to Suwappu.**

Deliberately **not** built: quadratic funding or any identity-weighted vote. That is the sybil-capture trap, and Optimism's own data argues against it.
- Even Gitcoin needed a collusion-resistant variant (COCM, [Miller, Weyl & Erichsen 2022](https://ethresear.ch/t/collusion-resistance-and-plurality-in-quadratic-mechanisms-paper-summary/14545)).
- Gitcoin sunset Grants Stack in May 2025 because ~$3M/yr of spend outran ~$1M/yr of revenue ([gov.gitcoin.co](https://gov.gitcoin.co/t/focusing-gitcoins-future-sunsetting-grants-stack-eol-may-2025/20333)).
- Fixed, mechanical splits have no operating cost to fund.

Precedents for the splitter design:
- **Drips** splits chain into networks with only a per-account receiver cap (200) and no depth limit ([Drips.sol](https://raw.githubusercontent.com/drips-network/contracts/07c39242edfe3c3ea6fad5808fd8f92b5e48a715/src/Drips.sol)). v2's Splitter keeps a receiver cap for gas.
- **Protocol Guild** routes donations through irrevocable linear vesting into a split contract, but that split is DAO-mutable ([docs](https://protocol-guild.readthedocs.io/en/latest/02-onchain-architecture.html)). v2's splitters are immutable by design: new weights mean a new splitter.

**Yield donation is not a deposit magnet. Use it as a layer, not a product.**
- PoolTogether's no-loss TVL fell from a $236M peak to ~$5–8M once incentives ended ([DefiLlama](https://defillama.com/protocol/pooltogether), [OP analysis](https://gov.optimism.io/t/incentive-impact-analysis-pooltogether/6553)).
- Glo Dollar (yield to GiveDirectly) remains small.
- Octant v2's architecture is the model to copy: yield-donating 4626 strategies, with **unharvested yield absorbing losses first so principal is protected** ([Gitcoin proposal](https://gov.gitcoin.co/t/proposal-gitcoin-x-octant-yield-powered-matching-pilot/25065)). `YieldDonor4626` adopts that loss order.
- So `YieldDonor4626` wraps deposits people make *for their own reasons* (L2 lending, L3 backing). It does not try to attract deposits on charity alone.

---

## 7. How the layers compose (one walk-through)

1. Ana and Ben (Telegram contacts) open a mUSD line via signed intents relayed by the bot (L1). Ana extends 500, Ben extends 200, `CLEARABLE + INSURED`.
2. Ben's business partner Cleo backs Ben with 300 worth of L2 lender shares (L3). She keeps earning lending yield while backing.
3. Ben pays Dan through Ana, who opted into routing at 10 bps (L1 `payPath`).
4. A solver finds Ana→Ben→Dan→Ana debts and clears 120 off every leg in one `clear()` (L1). Nobody's net position moves, and gross debt falls.
5. Ben later defaults on 80. Ana claims: Ben's self-bond pays first, then Cleo's backing, and Ben's line is cured via `settleFor` (L3). Ben now owes Cleo, and that recourse is on his public record.
6. Cleo's lender shares sit in a `YieldDonor4626`, so their yield streams to a Splitter funding an open-source wallet library (L5).

---

## 8. Build plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **P1** | L1 ClearingHouse + EIP-712 intents + GuardedPrice lib (unused by L1, shared later) | Unit + **stateful invariants with interest and the full lifecycle** (propose/cancel/accept/pay/payPath/clear/demand/default/cure/close). `clear()` conservation invariant. Medusa harness. Gas benchmarks. money-path-reviewer + security-auditor clean. Base Sepolia deploy, client + terminal UI updated. |
| **P2** | L2 MarketFactory + SelfRepayingMarket | **Hostile-4626 suite**: same-block donation, round-against-us, illiquid `maxWithdraw`, sudden loss. Auction liquidation invariants. Lender solvency invariant (Σ claims ≤ cash + debt − realised bad debt). Reviews. Deploy. |
| **P3** | L3 CreditBacking (+ INSURED premium if P1 usage justifies it) | Waterfall ordering invariant. Caps never exceeded. L1 balances unaffected by any L3 failure (isolation test). Reviews. |
| **P4** | L5 Splitter + YieldDonor4626 | Principal-always-withdrawable invariant. Reviews. |
| **P5** | L4 DemurrageCurve | Solvency-after-release invariant over random warps incl. extreme decay. Reviews. |
| Gate | Independent external audit + testnet soak + bug bounty | Required before *any* real funds. This is `MAINNET_READINESS.md`'s bar, unchanged. |

Each phase ships its contract, `@suwappu/primitives-client` ABIs, and a terminal `/commons` panel together. The v1 contracts stay deployed and the UI keeps a "v1 (legacy)" tab until v2 parity.

---

## 9. Decisions needed

1. **Framing.** The docs call this "the credit layer of Hyperliquid"; you called them "public good contracts". Recommendation: they're the same thing. Ownerless credit infrastructure *is* the public good, and L5 makes the funding claim literal. Use "Commons" publicly.
2. **Target chain for P1.** Base Sepolia (where v1 + UI live) or HyperEVM testnet (`docs/plans/hyperliquid-gateway.md` Phase 0)?
   - **HyperEVM's Cancun opcodes are now verified on-chain** (2026-11-06). A raw `eth_call` of creation code doing TSTORE→TLOAD and MCOPY returned `0x…2a` on both mainnet (`rpc.hyperliquid.xyz/evm`) and testnet. A control call errored with `StackUnderflow`, which shows real execution. Hyperliquid's docs state "Cancun hardfork without blobs".
   - Both chains are viable. Recommendation: **Base Sepolia first** (existing UI and client), then HyperEVM testnet in the same phase. Pin `evm_version = "cancun"` and re-probe if HyperEVM announces a later fork.
3. **v1 terms-swap bug.** Testnet only, no real funds. Recommendation: no v1.1 hotfix; fix in v2 P1, and add a UI warning on the v1 accept button now (it re-reads terms but can't prevent a front-run).
4. **INSURED premium market in P3**, or pure backing first? Recommendation: pure backing first. Add premiums when there's interest flow to price.

## 10. Evidence ledger (gap-verification pass, 2026-11-06)

| Claim | Verdict | Basis |
|---|---|---|
| HyperEVM supports TSTORE/TLOAD/MCOPY | **VERIFIED on-chain** | Our own `eth_call` probes on mainnet and testnet (§9.2) |
| Sardex: clearing alone −25% net internal debt | **VERIFIED** (2019 data; the 50% figure is simulated) | JRFM 2020 abstract + p.6 |
| Pure clearing removes ~10% of debt at zero liquidity | **VERIFIED** (simulation on real Italian data, not a live pilot) | arXiv 2507.22309 Fig. 10 |
| Slovenia per-round clearing share | **NOT FOUND**. Only annual ratios ~14–17% (1992–94, derived) | JRFM 2020 Fig. 1 |
| MTCS algorithm | **VERIFIED**: min-cost max-flow, non-unique optimum | arXiv 2507.22309 §2.3 |
| Trustlines "failed on adoption" | **UNVERIFIED**. Repos simply went quiet ~2023; no post-mortem exists | GitHub org |
| Circles stale-path handling | **NOT FOUND**. Our "stale path just reverts" is an inference to test | Circles SDK docs |
| Alchemix v3: no borrow APR, transmuter peg, 95% LTV liquidation | **VERIFIED** (via ALEA paraphrase of the docs) | §3.4 |
| Alchemix v3 bad-debt / insolvency handling | **NOT FOUND** | — |
| 4626 / exchange-rate exploits (Hundred, Sonne, Raft, Resupply); Euler is a *different* bug class | **VERIFIED** (loss figures partly secondary) | §3.2 table |
| Morpho IRM ceiling | **VERIFIED**: 200% at target, 800% absolute; "1200%" **REFUTED** | ConstantsLib.sol |
| Aave CAPO growth cap + snapshot-staleness failure | **VERIFIED** | CAPO README + LlamaRisk |
| TEC wind-down | **VERIFIED** (official shutdown contract). Sell-pressure figures are secondary | §5 |
| Gitcoin Grants Stack sunset, COCM paper | **VERIFIED**. Quantified sybil-loss figures **NOT FOUND**; circulating "16k/44k" and "60%" figures are unreliable and must not be cited | §6 |
| Drips mechanism / Protocol Guild mechanism | **VERIFIED**. Their funding totals are secondary only | §6 |
| PoolTogether TVL collapse after incentives | **VERIFIED** | §6 |
| Octant v2 loss-absorbing yield architecture | **VERIFIED** (secondary; official docs unreachable). Cumulative totals **NOT FOUND** | §6 |

Still open, and none of them blocks P1: Circles `operateFlowMatrix` revert semantics (read the Hub source), official Octant v2 docs, and Euler v2 / Silo rate-provider caps.
