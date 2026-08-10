# Onchain Atlas alignment — hardened

> **v2 (09 Aug 2026).** v1 of this doc took the Atlas fee leaderboard at face value. Adversarial
> research broke that reading. This version keeps the conclusion but replaces the reasoning, and
> the conclusion is now *stronger* — it survived a falsification pass that killed two of the four
> original plays.

Source: [onchainatlas.org](https://www.onchainatlas.org/) — 491 reviewed experiments (2011–2026),
a live fee leaderboard (`/fees/`, 1,382 protocol families, DefiLlama-sourced, rolling 7d), and a
"Request for Startups" idea engine (`/studio/`). Snapshot: 09 Aug 2026, 22:05 UTC.

---

## 0. What changed from v1, in one table

| v1 claim | Verdict after research | Now |
|---|---|---|
| "We route to 7 of the top 10 fee leaders" | **Misleading.** 4 of the 10 aren't app fees at all | Rewritten — §1 |
| D1 unified dollar balance | **Partly obsolete.** Circle Gateway shipped this as free infra (Aug 2025) | Rescoped — §3 |
| D2 execution receipts | **Confirmed** (zero competitors do it) — but the metric behind it was mislabelled | Shipped, corrected — §3, §3.0 |
| D3 exit-first launch loop | Holds | Kept — §3 |
| D4 Lido / LSTs | **Killed.** Worse yield, worst-documented integrator economics of the three | Dropped — §3 |

---

## 1. The fee leaderboard is not a demand map (and the correction matters)

Atlas ranks DefiLlama "fees." DefiLlama defines fees as "total fees paid by users," but applies
that single label across economically incompatible events. Breaking down the top 10:

| # | Protocol | 7d fees | Signal quality | Why |
|---|---|---|---|---|
| 1 | Tether | $112.0M | **Artifact** | Reserve/T-bill yield on backing assets — no user pays this at point of use |
| 2 | Circle | $44.5M | **Artifact** | Same; Circle's own filings are ~95–99% interest income |
| 3 | Pump.fun | $23.9M | **Legitimate** | Discretionary launch/trade fees |
| 4 | Uniswap | $16.9M | **Legitimate** | Discretionary swap fees |
| 5 | Canton | $10.6M | **Artifact** | Permissioned settlement *chain* — gas, not an app fee |
| 6 | Hyperliquid | $9.5M | **Legitimate** | Perp taker fees |
| 7 | Lido | $8.2M | **Borderline** | Protocol cut of staking yield; disclosed, but not a per-use payment |
| 8 | Axiom | $6.9M | **Legitimate — and the direct comparable** | Solana trading terminal, our category |
| 9 | Tron | $6.8M | **Artifact** | Chain gas |
| 10 | Polymarket | $6.8M | **Legitimate** | Prediction-market fees |

**~71% of the top-10 sum ($174M of $246M) is reserve yield or chain gas, not app demand.**
Only ~$64–72M is "a user chose to pay for this product." Comparing a settlement chain to a
memecoin launchpad in one column is a category error, and it's the #1, #2, #5 and #9 slots.

Confidence: high on Tether/Circle/Canton/Tron (traced to DefiLlama's own adapter definitions);
medium on the Lido call.

### What this changes

1. **The v1 headline "7 of 10" was inflated.** The honest version: of the 6 legitimate app-fee
   entries, **we cover 5** (Pump.fun, Uniswap, Hyperliquid, Polymarket, and Uniswap's routing
   surface); the 6th is Axiom, a competitor. That is a *better* fact than the v1 version, because
   it's about products users chose rather than float we happen to touch.
2. **Do not use gross fees as the planning input again.** Use take-rate × DAU, or retained app
   revenue (Token Terminal separates fees from earnings; Artemis publishes app revenue). Gross
   fees systematically rewards non-discretionary flow — exactly the flow a trading product
   cannot capture.
3. **Axiom should weigh far more than rank 8 suggests.** It is the only entry in the list that is
   the same product as ours.

---

## 2. The competitive read — where the category actually is

Evidence from a parallel scan of Axiom, Photon, BullX, Trojan, Banana Gun, Maestro, GMGN, Bloom,
Sigma, Vector, plus Jupiter Mobile and Phantom as the wallet-side threat.

**Axiom went from ~2% to ~72% of Solana bot volume in ~9 months** — fastest app to $200M revenue
on Solana. Its moat, ranked by evidence strength, is **incentive design, not technology**: a
Hyperliquid-style points program against a widely-assumed (unconfirmed) airdrop, plus a fee
undercut (0.5–0.75% vs the category's 1%) with volume-scaled rebates. Speed is at parity —
Photon and BullX are also ~400–450ms. **There is no technical moat in this category.**

Two openings fall out of that:

### Opening A — nobody publishes execution quality. Nobody.
Searches for "price improvement," "execution receipt," "slippage refund," and "best execution"
returned **zero** results tied to Axiom, Photon, BullX, Trojan, Banana Gun, Maestro, GMGN, Bloom,
or Sigma. The entire category markets on *milliseconds* and *fee %* — never on realized-vs-quoted
price. Closest analogues are one tier away and weaker: 1inch Fusion discloses resolver spread in
the order preview (a marketing claim, not a per-trade receipt), and Uniswap has published
*research* on measuring price improvement via order-flow auctions. Neither is a consumer receipt.

### Opening B — "multi-chain" in this category means "Solana plus some EVM"
Trojan reaches ETH via deBridge, not native execution. Maestro claims 14 chains with **no unified
session** — each chain is a silo, on stacked subscription + per-trade fees. GMGN/Bloom/BullX are
genuinely multi-chain but Solana-first in feature depth. Banana Gun has the strongest real unified
cross-chain UX and is still EVM+Solana only. Sigma is EVM-only, no Solana.

**No competitor bundles cross-chain swaps + perps + prediction markets + sniping + yield in one
product.** Axiom bundles swap+snipe+perps but stays Solana-centric. Jupiter Mobile bundles
swap+perps+prediction markets+lending but is Solana-only. Our 45-chain/19-provider position is
unmatched in the scanned set.

Also worth logging: **Coinbase acquired Vector.fun and wound it down (Nov 2025)** — a major
CEX/wallet player bought into this category rather than building. That is both an exit-comp
data point and a competitive warning.

---

## 3. Revised plays

### P1 — Execution receipts, then bonded execution. **Highest conviction, and cheaper than we thought.**

Three independent lines converge here: Atlas's "Untried Combination" funnel (bonded solvers +
measurable guarantees + automatic compensation), the competitive gap in Opening A, and — the
finding that changes the cost estimate — **the pipeline is already built, running in production,
and exposed over HTTP, with no client calling it.**

Repo recon:

| Piece | Status |
|---|---|
| `execution_scorer.py` — marks at 5m/1h/24h horizons | **Live.** Started `api/main.py:378`, stopped `:506`, health-monitored `:1020`. 120s loop, 50 swaps/pass |
| `execution_benchmark.py` — k-anonymous cohort percentiles (MIN_COHORT_USERS=5, enforced in the query layer) | **Live** |
| `SwapExecutionMark` table — `realized_vs_quoted_bps`, `markout_bps`, UNIQUE(swap_id, horizon) | **Exists**, `bot/models/swap.py:197–245` |
| `SwapRouteCandidate` — every rejected aggregator route, `quoted_to_amount_usd`, `was_selected` | **Exists**, `:119–195`. Counterfactual data nobody else has |
| `GET /execution/benchmark` — auth-gated, returns percentile + cohort + `suppressed:true` below the floor | **Live**, `api/webapp.py:5123–5160` |
| Any client calling it — webapp, mobile, bot handlers, api-ts | **ZERO.** grep returns nothing |

So the honest status is: **we built the hard half, shipped it to production, and never drew the
UI.** The differentiator the entire competitive scan says nobody has, we are already computing
and throwing away.

Two real gaps before P1a is done, both small but load-bearing:

1. **There is no per-swap receipt.** The live route is *pair-level* (`from_token`, `to_token`,
   `window_days`) — "how do you do on this pair vs peers," not "here is what happened on this
   fill." The receipt is new surface on top of existing marks.
2. **The headline metric is mislabelled and measures something else entirely.** Found while
   building P1a; it is serious enough to have its own section — see **§3.0** below. Short version:
   `realized_vs_quoted_bps` contains no realized fill data, so quote-vs-fill accuracy is currently
   unmeasurable and P1b is blocked on data collection, not on spec.

The cost / markout split is what the receipt actually ships: what the trade cost to cross,
kept apart from what the market did afterwards. `markout` is the genuinely measured half, and
market-maker desks decompose exactly this way internally — standard practice, correctly named
(multi-horizon markout is the term of art) — and **it is published to end users nowhere, in
crypto or TradFi.** The intended third component, fill-vs-quote accuracy, needs §3.0 built first.

Staging:
- **P1a (read-only):** per-swap execution receipt. **Shipped** — `execution_receipt.py`,
  `GET /webapp/execution/receipt/{swap_id}`, Receipt buttons on `/hx`. No payout, no money-path
  risk.
- **P1b (bonded):** stated tolerance up front, automatic compensation when a fill misses it.
  Needs a spec before any builder touches it (see §3.1) and `money-path-reviewer` (opus) sign-off.
- Cross-chain is where this bites hardest — slippage and bridge risk are worst there and user
  trust is lowest, which is exactly where we have coverage nobody else does (Opening B).

#### 3.0 CORRECTION (found while building P1a): the metric does not measure what it is named

`swap_execution_marks.realized_vs_quoted_bps` **contains no realized fill data.** The scorer
computes it as `_bps(swap.to_amount_usd, swap.from_amount_usd)`, and both sides are written once
in `execute_swap()` (`swap_engine.py:3803–3806`) from the *quote's expected* amounts. Nothing in
the codebase ever updates `to_amount_usd` with the amount actually received — grep confirms it.

So the figure is the **quoted round-trip cost** of a trade: DEX spread + price impact + our own
platform fee + priced-in bridge fees. It is a real number. It is not a measure of execution
quality, and it cannot answer "did we deliver the quote."

This supersedes the quote-timing gap noted earlier in this section — that was the smaller half of
the problem. Consequences:

1. **P1a shipped describing cost, not fill accuracy.** The receipt renders `quoted_cost_bps` and
   explicitly disclaims fill-accuracy measurement. The near-miss was real: FREE-tier fee alone is
   100 bps, so a naive rendering would have told nearly every user "you received ~100 bps less
   than quoted — that gap is ours," accusing ourselves of a fill failure on evidence of our own
   disclosed fee. A regression test pins the wording.
2. **`markout_bps` is unaffected and remains genuine.** It compares live observed prices across
   horizons, so post-fill drift is real measurement. The honest half of the pipeline.
3. **The cohort percentile ranks quoted cost**, not execution skill. Still a usable signal — worse
   routing and larger size do cost more — but the benchmark's own docstrings overclaim.
4. **P1b is blocked on data that does not exist**, not on spec. Bonded compensation needs realized
   fill amounts parsed from on-chain receipts, per chain. That is a real project (per-chain log
   parsing across 45 chains), not a refinement. Nothing may pay out off the current number.

**The competitive gap in §2 is unchanged and arguably widens** — nobody publishes execution
quality partly because measuring it properly is harder than it looks. We now know exactly what it
costs us to get there.

#### 3.1 P1b is novel, but the novelty is the *combination* — and it has teeth

Prior-art sweep verdict: **not already done, but close enough that a competitor could ship a
weaker version fast.** The three legs each have partial precedent; nobody has fused them.

- **CoW Protocol EBBO** is the closest bonded price-quality mechanism in crypto: fills worse than
  a baseline-router reference produce a violation certificate, solver has 72h to reimburse, else
  deny-list → DAO Snapshot vote → bond slashed. But it is **governance-adjudicated, solver-
  initiated, and benchmarked against a DAO-defined router set** — not automatic, not instant, not
  against a tolerance the *user* chose. CoW Explorer does show per-order surplus vs limit price.
- **0x's 2021 "Hidden DEX Costs"** report is the closest analogue to our leg (a): 673k trades,
  worst-acceptable vs quoted vs realized price, found ~33% negative slippage. Aggregate research,
  not a live receipt, no markout split, no percentile, no compensation.
- **UniswapX/1inch Fusion** price improvement exists only in third-party academic work
  (~4bps PI at $200k on UniswapX), not shown in-product.
- **MEV Blocker / Flashbots Protect** refund ~90% of captured MEV automatically — that is
  MEV revenue-sharing, not compensation for missing a stated bound.
- **Across / UMA-style bonds** secure liveness and factual correctness, explicitly not fill price.
- **LI.FI/Jumper-class bridge aggregators** reportedly compensate negative bridge slippage in
  native token, vested over weeks. *(UNVERIFIED — their docs 403'd; only `SLIPPAGE_EXCEEDED` and
  failure-refunds confirmed.)*
- **TradFi**: SEC Rule 605/606 give *monthly/quarterly venue-level aggregates* (price improvement
  per share, effective/quoted spread, realized spread at intervals); Robinhood and IBKR publish
  these. MiFID II went the other way — **RTS 28 was formally deleted** and RTS 27 deprioritized as
  "hardly read." Note what that means: the periodic aggregate report is a format regulators tried
  and abandoned for being unreadable. **Per-fill, real-time, individual receipts have never been
  done for retail — in crypto or TradFi.** That gap is the opportunity and the warning.

Hazards to design against, before a line of code:
- **Benchmark manipulation.** Whatever "quoted price" we snapshot becomes a target we can quietly
  widen to always look good, and that sophisticated users can game by inducing bad quotes to
  trigger payouts. EBBO is contentious even at DAO speed.
- **Which number triggers the payout.** If compensation fires on missed bps without accounting for
  markout, we pay out on fills that got a worse price *because* they avoided toxic flow. We
  separate the two for display; the *trigger* must also pick one, explicitly. This is the money-
  path detail that decides whether the mechanism is solvent.
- **Standing liability.** Instant automatic payout is precisely what nobody has made economically
  comfortable — CoW adjudicates slowly, LI.FI vests. Needs a funded pool, a bonded underwriter,
  or tolerance that widens with volatility.
- **Cohort integrity.** Percentiles need a hard-to-game cohort (pair × size bucket × chain ×
  volatility regime). Nobody has solved this publicly for retail crypto swaps.

Existing rebate primitives to build the payout on: `fee_service.py` runs tier fees
(FREE 1.0% / PRO 0.5% / PREMIUM 0.3% / ENTERPRISE 0.1%, sent as `platformFeeBps`), and already
has two crediting paths — referee first-5-swaps rebate (`:183–192`) and points-based fee discount
floored at 0.1% (`:134–152`). **No execution-quality compensation exists.** The floor logic is a
useful precedent: fees never go negative.

### P2 — Exit-first launch loop (Pump.fun, $23.9M, the only top-5 riser at ↑7.6%)
We have `sniping/pump_fun_api.py`, `launch_detector.py`, `snipe_executor.py`, `dev_watch.py` and
rug auto-sell. Entry latency is a losing fight — Axiom/Photon/BullX are at parity and it isn't a
moat for any of them. **Exit quality is the wedge.** Promote rug auto-sell and dev-watch from
settings to the front of the product.

### P3 — Stablecoin corridor, rescoped: consume, don't build
**Circle Gateway shipped in Aug 2025** — a Circle-run CCTP v2 primitive giving a single spendable
USDC balance across 7 chains in <500ms, free, as infrastructure. Maintaining our own relayer fleet
to approximate this is now redundant engineering.

- Gateway is **USDC-only**; Circle has not extended it to USDT. The USDT equivalent is **USDT0**
  (Tether + LayerZero OFT, burn-and-mint, $50B+ cumulative transfers by late 2025).
- So: **the unification UX is still ours to own; the bridging infra underneath it is not.**
  Evaluate replacing custom CCTP relayer maintenance with Gateway (USDC) + USDT0 (USDT).
- Caveat, and it is load-bearing: **no retail usage numbers for chain abstraction were found
  anywhere** — every source was infra-vendor marketing. Particle Network, a leading vendor,
  publicly asked "is chain abstraction still relevant?" Treat demand as unproven. This is why P3
  is third, not first.

### Killed: Lido / LSTs
Base ETH staking yield has compressed to ~2.3–2.8% APY while stablecoin yield on Aave and Morpho
— both already integrated — runs 5–8%+. Marginal ETH staking demand is now institutional (yield
ETFs), not retail. And Lido has no documented integrator fee-share, versus Aave's explicit
20%-of-protocol-fees referral program. Worse yield, worse economics, new risk surface
(slashing, depeg), wrong audience. **Do not build. Deepen Aave/Morpho stablecoin yield instead.**

### Still not doing
Canton (permissioned, no retail surface). An "Axiom integration" (it is a competitor, not a venue).

---

## 4. The planning method — Atlas's five funnels, kept

The `/studio/` framework survives the research pass intact, because it is a *method*, not a
claim: start from a documented failure, compose proven primitives (no breakthrough R&D), target
a narrow measurable outcome.

| Funnel | The question | Our candidate | Already in repo |
|---|---|---|---|
| Open problem | What documented failure is still unsolved? | Routed legs that strand funds mid-flight, with no recourse | `bot/services/bridge/`, CCTP relayers, `withdraw_reconciler.py` |
| What comes next | What's the credible successor to a working primitive? | Portable, exportable execution reputation across venues | `execution_scorer.py`, `execution_benchmark.py` |
| Moonshot | What if one hard assumption holds? | Agent-executed trading under user-set constitutional limits — *if* intent parsing earns that trust | `nl_intent_service.py`, `nl_deterministic_parser.py`, `x402_service.py` |
| Untried combination | Which proven primitives were never composed? | Bonded execution (= P1b) | `execution_scorer.py` + `fee_service.py` + `points_service.py` |
| Live signal | What recent protocol change opens something? | Chain-abstraction refunds when a routed tx fails partway | `withdraw_reconciler.py`, `tx_poller.py` |

### Intake rule

Before anything enters the backlog, in ≤3 lines:
1. **The documented failure** — with evidence (user report, failed tx, fee number). Not
   "competitors have it."
2. **The primitives** — which *existing* pieces compose into the fix. If it needs new research,
   label it a moonshot; don't smuggle it in as a sprint item.
3. **The measurable outcome** — the single number that moves.

Fails all three → it's a wish, not a plan.

### Cadence
- **Weekly:** re-pull `/fees/` — but read only the *app-fee* entries (§1). Track Axiom especially.
- **Monthly:** re-run §1 and re-rank §3.
- Atlas's caveat applies to us too: editorial hypotheses, not facts. And now our own caveat:
  gross fees ≠ demand.

---

## 5. Sequence

1. **P1a execution receipts** (read-only) — the one thing no competitor has, on a pipeline already
   running in production with zero clients. Highest ratio of differentiation to work on this page.
2. **P2 exit-first launch loop** — cheapest, defends the fastest-growing legitimate fee category.
3. **Record realized output amounts** — parse the actual received amount from on-chain
   receipts and persist it, so quote-vs-fill becomes measurable at all (§3.0). This is the real
   prerequisite for every execution-quality claim, and it is per-chain work, not a small fix.
4. **P3 corridor rescope** — evaluate Circle Gateway + USDT0 as rails; ship unified-balance UX on
   top. MONEY-PATH review required.
5. **P1b bonded compensation** — only after 1–4. Spec first (`suwappu-lead`): quote-snapshot
   methodology, cohort definition, whether the trigger is slippage-bps or markout-adjusted, and
   the payout funding source. Then `money-path-reviewer` + `security-auditor` (benchmark gaming)
   *at spec stage*, before implementation.

## Resolved / open

Resolved this pass: the fee-signal critique (§1), the competitive gap (§2), P1's true cost
(§3/P1 — backend live, no client), P1b's novelty (§3.1), and the Lido kill.

Still open:
- **No retail usage evidence for chain abstraction exists** — every source found was infra-vendor
  marketing. P3 rests on an unproven demand assumption; that is why it is fourth.
- Axiom's token/airdrop is **unconfirmed** by the company. If the points flywheel is the whole
  moat, its share is more fragile than 72% suggests — and post-TGE is our opening.
- Per-protocol revenue for Trojan, Banana Gun, Maestro, Bloom, Sigma unverified; pull DefiLlama
  dashboards directly if precise numbers are needed for a deck.
- LI.FI's negative-slippage rebate is unverified against primary docs (their site 403'd).
