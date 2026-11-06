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

- **Clearing is the measured value.** Sardex data: multilateral set-off alone cut net internal debt ~25%; with mutual credit ~50% ([Fleischman, Dini & Littera 2020](https://mdpi.com/1911-8074/13/12/295/xml)). Slovenia has run national trade-credit clearing since 1991 ([CIAT](https://ciat.org/slovenian-model-for-liquidity/?lang=en)). Cycles (Informal Systems) deliberately does *only* clearing: no new debt, no CCP ([arXiv 2507.22309](https://arxiv.org/pdf/2507.22309)).
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
  - **Why intermediary consent is enough:** routing A→B→C uses credit B extended to A (B's choice) and grows B's debt to C (identical to B paying C directly, which C already accepted). The only party whose risk changes without a direct action is B, so B opts in.
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
- **Gas target:** benchmark E = 10/50/100. Acceptance requires E=50 under ~1.5M gas on Base.

### 2.4 Signed intents (agent/relayer-native)

EIP-712 `Intent { action, params, nonce, deadline }` for propose/accept/pay/payPath/settle/setMyLimit, executed by anyone via `execute(intent, sig)`. ERC-1271 is supported, so smart accounts and agent wallets can sign.

This is what lets a Telegram contact accept a line or pay an IOU from chat while the bot relays without ever holding keys. It is the product described in `hyperliquid-differentiation.md`.

### 2.5 Standing (reputation substrate, not a score)

The contract exposes per-address counters: `settledVolume`, `clearedVolume`, `defaults`, `cures`, `oldestActiveLine`.

There is deliberately **no score and no token**. Research found no robust on-chain sybil-resistant reputation. L3 guarantors are the sybil resistance: real stake behind real people. Limits that grow with cleared volume (Sardex caps balances at ~10% of turnover, [Monneta](https://monneta.org/en/sardex/)) are a **client/policy** feature reading these views, not consensus logic.

### 2.6 Settlement

`settle(creditor, token, amount)` works as in v1. New is `settleFor(debtor, creditor, token, amount)`: anyone may pay down someone else's debt. That is benign, and L3 needs it. Fee-on-transfer tokens are rejected by balance-diff.

---

## 3. L2 — `SelfRepayingMarket` (AmortizingVault v2)

The productive-collateral layer. **Renamed honestly**: there is no schedule, so "self-repaying", not "amortizing".

### 3.1 Shape

- `MarketFactory` deploys **one immutable clone per market** (the immutable-args clone pattern already used in `contracts/hypercore/`). Params: collateral 4626, IRM constants, LTVs, auction params, keeper tip, guard params.
- **Each market is itself an ERC-4626** (lender shares) and an **ERC-721** (borrow positions). This is chosen over a Morpho-style singleton for composability: lender shares become standard yield-bearing collateral for L3 backing, L5 donation, or another market. Positions become transferable and can serve as backing.

### 3.2 The guarded share price (fixes the v1 core risk)

`GuardedPrice` library, shared by L2, L3 and L5:

- A checkpoint `(price, ts)` refreshes at most once per `lagWindow`. Increases are **rate-capped** (`maxGrowthPerSec`); excess growth is deferred, not dropped.
- **Borrow / withdraw-collateral** value collateral at `min(spot, checkpoint)`, which is conservative for lenders.
- **Liquidation trigger** uses the checkpoint, so it resists a transient spike or dip.
- **Amortize** credits only yield visible in the *checkpoint* price, so a donation spike can never be swept into debt repayment.

Honest limit: this hardens the read, but it is still only as good as the 4626's `totalAssets`. Market deployers must pick a sane collateral vault, and the UI should warn on thin or illiquid vaults.

### 3.3 Rates, liquidation, keepers

- **Kinked utilization IRM** with immutable constants and a **compounding index** (per-accrual linear, Compound-style). Rates spike near 100% utilization, which pulls lenders' cash back. This fixes v1's stuck-at-100% problem.
- **Dutch-auction liquidation**:
  - permissionless `flag(id)` records `unhealthySince` (and reverts if healthy);
  - `bonus(t) = min(maxBonus, minBonus + k·(t − unhealthySince))`;
  - partial liquidation with a close factor;
  - when collateral < debt, seize-all plus **immediate** bad-debt write-off against lender share price.
  - This replaces v1's fixed bonus, which overpays when healthy-ish and underpays when deep underwater. A Morpho-style pre-liquidation tier is deferred to v2.1.
- **Keeper tip on `amortize`.** An immutable `tipBps` (≤ 1%) of credited yield goes to the caller, so self-repayment actually happens instead of waiting for altruists.
- **Payoff view.** `projectedPayoff(id)` = debt / (collateral yield rate − borrow rate) from the checkpoint history. If yield is below the rate, the UI shows "debt growing" plainly.

### 3.4 Explicitly not built

Alchemix-style synthetic debt + transmuter + earmarking. That is the audit-heaviest shared accounting in this space, and v2 lends the real underlying instead.

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

Also in v2: a factory, ERC-2612 `permit`, rate bounds at deploy (reject schedules that hit v1's `e^-41` floor within 100 years), and blocking transfers to the curve itself.

**Honest priority: last.** Demand for a demurrage token is unproven outside community-currency settings. Its strongest role here is as a *funding source* for L5, or as a community unit of account for L1 lines. Build it only after L1–L3 show usage.

---

## 6. L5 — Commons routing

- **`Splitter`.** Immutable recipients and weights, pull-based, any token. Splitters can be recipients of splitters, which forms a dependency graph (Drips / deep-funding shape) **without voting**. Anyone can deploy competing splitters, so capturing one is not fatal.
- **`YieldDonor4626`.** Wraps any 4626 (including L2 lender shares). **Principal is always withdrawable.** Only the guarded-price gain above principal is claimable to an immutable splitter (the Octant v2 model).
  - Composition example: lend to self-repaying borrowers, and the interest funds open-source maintainers.
- **Where public-goods money comes from:** L4 surplus, opt-in yield donation, and an optional per-market beneficiary chosen by the market deployer at creation. **Never a protocol fee to Suwappu.**

Deliberately **not** built: quadratic funding or any identity-weighted vote. That is the sybil-capture trap, and Optimism's own data argues against it.

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
2. **Target chain for P1.** Base Sepolia (where v1 + UI live) or HyperEVM testnet (`docs/plans/hyperliquid-gateway.md` Phase 0)? The contracts need Cancun (EIP-1153 `tstore`); **HyperEVM support for this is unverified**. Recommendation: Base Sepolia first, HyperEVM once tstore is confirmed.
3. **v1 terms-swap bug.** Testnet only, no real funds. Recommendation: no v1.1 hotfix; fix in v2 P1, and add a UI warning on the v1 accept button now (it re-reads terms but can't prevent a front-run).
4. **INSURED premium market in P3**, or pure backing first? Recommendation: pure backing first. Add premiums when there's interest flow to price.

## 10. Evidence gaps (verify before relying on them)

- Slovenia and Cycles clearing percentages (no primary figure found; check AJPES via the 2020 MDPI paper).
- Exact MTCS algorithm (min-cost flow vs cycle cancelling).
- TEC/augmented-bonding-curve failure: one secondary post-mortem only.
- Alchemix v3 behaviour on yield shortfall and synthetic depeg.
- Gitcoin QF/COCM results, Drips, Protocol Guild, PoolTogether and Glo were not searched (L5 rests on Octant + OP lessons only).
- HyperEVM EIP-1153 support.
