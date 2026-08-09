# Onchain Atlas alignment — double down + how to plan what's next

Source: [onchainatlas.org](https://www.onchainatlas.org/) — 491 reviewed experiments (2011–2026),
a live fee leaderboard (`/fees/`, 1,382 fee-reporting protocol families, DefiLlama-sourced,
rolling 7d, hourly refresh), and a "Request for Startups" idea engine (`/studio/`).

Two things matter to us:

1. **`/fees/` is a demand map.** It ranks *user fees paid* — not TVL, not token price, not
   narrative. It is the closest public proxy for "where are people actually willing to pay."
2. **`/studio/` is a planning method**, not a list. Five funnels for deriving a product from a
   documented failure. We should adopt the method, not copy the ideas.

Atlas snapshot used here: 09 Aug 2026, 22:05 UTC.

---

## 1. Where we already sit on the top-10 fee leaders

| # | Protocol | 7d fees | Our coverage | Evidence |
|---|----------|---------|--------------|----------|
| 1 | Tether | $112.0M | **Deep** | USDT across the chain set (~57 files), TRON leg via `bot/services/sunswap_api.py` |
| 2 | Circle | $44.5M | **Deepest** | USDC (~203 files), CCTP v1/v2 (`cctp_api.py`, `cctp_relayer.py`, `cctp_generic_relayer.py`, `cctp_hypercore.py`), Aave-on-Base savings (`bot/handlers/savings.py`) |
| 3 | Pump.fun | $23.9M | **Real** | `bot/services/sniping/pump_fun_api.py`, `launch_detector.py`, `snipe_executor.py`, `raydium_monitor.py`, rug auto-sell (`token_security/rug_service.py`) |
| 4 | Uniswap | $16.9M | **Deep** | `univ3_fork_api.py` + aggregator fan-out (0x, 1inch, Kyber, CoW, LiFi, OKX, Jupiter) |
| 5 | Canton | $10.6M | **None** | Permissioned institutional rails — no retail swap surface. Correctly out of scope. |
| 6 | Hyperliquid | $9.5M | **Deep** | `hyperliquid_client.py`, `hyperliquid_signing.py`, `hyperliquid_funding.py`, `hl_ws_alerts.py`, `hl_ecosystem_monitor.py`, `perps_service.py` |
| 7 | Lido | $8.2M | **Token-only** | LDO/stETH exist in `bot/config/tokens.py`; `staking_service.py` is SUWP staking, not an LST product. **Gap.** |
| 8 | Axiom | $6.9M | **None — and it's us** | A trading terminal earning $6.9M/wk in fees. Not an integration target: it is the proof our category monetizes, and the bar. |
| 9 | Tron | $6.8M | **Deep** | ~48 files, SunSwap, TRON in the compliance screening spine |
| 10 | Polymarket | $6.8M | **Deep** | `polymarket_api.py`, `polymarket_v2_order.py` (CLOB V2), `bot/handlers/predict.py`, `predict_monitor.py` |

**Headline: we already route to 7 of the 10 highest fee-generating protocols in crypto.**
That is the asset. The strategic error would be to read this table as "add Canton and Lido."
Breadth is not the gap — of the three misses, one is out of scope (Canton), one is a competitor
(Axiom), and only one is a genuine product gap (Lido/LSTs).

---

## 2. Double down — four depth plays on what we already have

Ranked by (fee-pool size we already touch) × (work already in the repo).

### D1. Own the stablecoin corridor (Tether + Circle = $156.5M/wk, 43% of the top 10)
We have both issuers' rails and a working CCTP fleet. What's missing is that the corridor is a
*capability*, not a *product*. Nobody opens the bot to "use CCTP."

- Make "send/hold/earn dollars across chains" a first-class surface, not a swap side effect.
- One balance for USDC and one for USDT, chain-abstracted, with the bridge leg hidden.
- Route the savings product (`handlers/savings.py`, currently Aave-on-Base USDC) off a single
  dollar balance rather than a chain-specific one.
- Owner: `bot-dev` + `webapp-dev`. Money-path review required.

### D2. Turn execution intelligence into a promise (Uniswap $16.9M + the whole routing surface)
`execution_scorer.py` (realized-vs-quoted bps vs markout bps, cleanly separated) and
`execution_benchmark.py` (k-anonymous cohort percentiles) already compute the hard part. Today
they are analytics. Nobody else in the category can make an execution *claim* and back it with
per-fill evidence.

- Ship a per-swap execution receipt: quoted vs realized, in bps, with the cohort percentile.
- Then the strong version: a stated tolerance, and automatic compensation from the fee account
  when a fill misses it. This is Atlas's own "Untried Combination" thesis (bonded solvers +
  measurable guarantees + automatic compensation) — and we are unusually close to it.
- Owner: `bot-dev`, then `money-path-reviewer` (opus) before anything pays out.

### D3. Finish the launch/memecoin loop (Pump.fun $23.9M, ↑7.6% — the only top-5 riser)
We have detection, sniping, dev-watch and rug auto-sell. The loop is strongest where it is
already differentiated: not "buy faster" (Axiom wins that), but "get out safely."

- Push rug auto-sell + `token_intel/dev_watch.py` to the front of the product, not the settings.
- Position exit quality is the wedge against terminal competitors, not entry latency.

### D4. Close the Lido gap properly ($8.2M/wk, and it feeds D1)
Liquid staking is the one real product hole in the top 10. Do not add a "Lido integration" —
add a yield surface where LSTs are one option alongside the existing Aave/Morpho savings path.

- Reuses `handlers/savings.py`, `morpho_api.py`, `starknet_yield.py`.
- Smallest scope that closes it: stETH/wstETH mint + redeem on the existing savings screen.

**Explicitly not doing:** Canton (permissioned, no retail surface) and an "Axiom integration"
(it is a competitor, not a venue).

---

## 3. How to plan new features — adopt Atlas's five funnels

Atlas's `/studio/` framework: every idea starts from **a documented failure**, composes
**proven primitives** (no breakthrough R&D), and targets a **narrow, measurable outcome**.
That is a better intake filter than our current "what should we build next."

Applied to what is actually in this repo:

| Funnel | The question | Our candidate | Already in repo |
|---|---|---|---|
| **Open problem** | What documented failure is still unsolved? | Bridge/route legs that strand funds mid-flight — user is left holding an intermediate asset with no recourse | `bot/services/bridge/`, CCTP relayers, `withdraw_reconciler.py` |
| **What comes next** | What is the credible successor to a working primitive? | Portable execution reputation: our per-fill scoring becomes a user-visible, exportable record of venue reliability | `execution_scorer.py`, `execution_benchmark.py` |
| **Moonshot** | What if one hard assumption holds? | Agent-executed trading under user-set constitutional limits — if intent parsing is reliable enough to be trusted with bounded funds | `nl_intent_service.py`, `nl_deterministic_parser.py`, `x402_service.py`, `api-ts` agent routes |
| **Untried combination** | Which proven primitives have never been composed? | Bonded execution: stated tolerance + measured fill + automatic compensation (this is D2's strong form) | `execution_scorer.py` + `fee_service.py` + `points_service.py` |
| **Live signal** | What recent protocol change creates a new opening? | Chain-abstraction refunds — auto-compensate when a routed transaction fails partway, using the reconciler we already run | `withdraw_reconciler.py`, `tx_poller.py`, CCTP relayer fleet |

Note the convergence: three of five funnels land on the same asset — **we measure execution and
nobody else does.** That is the signal to trust. D2 is the highest-conviction build on this page.

### Intake rule to adopt

Before a feature enters the backlog, it must answer, in ≤3 lines:

1. **The documented failure** — what breaks today, with evidence (a user report, a failed tx, a
   fee number). Not "competitors have it."
2. **The primitives** — which *existing* things compose into the fix. If it needs new research,
   it is a moonshot and gets labelled as one, not smuggled in as a sprint item.
3. **The measurable outcome** — the single number that moves. If it can't be stated, the feature
   isn't specified yet.

Anything that fails all three is a wish, not a plan.

### Cadence

- **Weekly:** re-pull `/fees/`. Track where our supported protocols sit and what entered the top
  20. A protocol rising while we have zero coverage is a signal; a protocol falling while we have
  deep coverage is a cost question.
- **Monthly:** re-run the coverage matrix in §1 and re-rank the depth plays in §2.
- Atlas's own caveat applies and should apply to us: these are editorial hypotheses. The fee
  leaderboard is user payments — not protocol revenue, not profit, not a market forecast.

---

## 4. Suggested sequence

1. **D2 execution receipts** (read-only surface first — no payout, no money-path risk) — proves
   the claim before we bond it.
2. **D1 unified dollar balance** — biggest fee pool we already touch, largest UX delta.
3. **D3 exit-first launch loop** — cheapest, and it defends the fastest-growing top-5 category.
4. **D4 LST yield on the savings screen** — closes the only real top-10 gap.
5. **D2 strong form (bonded compensation)** — only after 1–4 and a full `money-path-reviewer` pass.
