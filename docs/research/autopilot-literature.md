# What the literature says about our autopilot

Research pass, Aug 2026. Every entry ends with **what we change**, or says
explicitly that we change nothing and why. Papers that only confirm what we
already do are recorded so nobody re-derives them.

Sources are cited inline. Where a claim is ours rather than a paper's, it says so.

---

## 1. The headline result: LLM trading agents mostly lose to buy-and-hold

[StockBench](https://consensus.app/papers/details/f9feb25af9a6556baa4fadf0d32c6c31/)
(Chen et al., 2025) is the only contamination-free, multi-month, real-market
evaluation of LLM trading agents we found. Its finding: **most frontier models
fail to beat a simple buy-and-hold baseline**, and strong performance on static
financial Q&A does *not* predict effective trading. The same paper notes that
agents that do well tend to win on *risk management* (Sortino, max drawdown)
rather than on stock picking.

This is corroborated from the other direction by two 2026 audits:

- [Nguyen et al.](https://consensus.app/papers/details/4b99308628805ba4afdfe01af400bc79/)
  document five evaluation failures pervasive in the LLM-trading literature —
  look-ahead bias, survivorship bias, backtest overfitting, **transaction-cost
  neglect**, and regime-shift blindness — and show these "can reverse the sign
  of reported returns."
- [Yao et al.](https://consensus.app/papers/details/a1343da3c65d535786c1768412e72a53/)
  audit 30 primary studies for execution realism and conclude that "architecture
  reporting is generally clearer than the evaluation assumptions needed to judge
  whether a trading result is economically interpretable." Their worked example
  shows explicit friction and timing assumptions **materially compress**
  active-strategy results.

Note what this says about the whole category omo is in: the published claim is
almost always the un-audited one. Our differentiator is not a better model — it
is being the agent whose record survives that audit.

**What we change.** Two things.

1. **Publish a buy-and-hold benchmark next to equity.** Right now the dashboard
   shows our equity curve alone, which is the exact presentation the audits
   criticise. The honest comparison is: what would the same capital have done
   held in the base token over the same window? If we do not beat that line we
   should be visibly not beating it.
2. **Report the friction assumptions on the dashboard**, not just in code. We
   charge `paperFeeBps` per side and model impact; a reader cannot currently see
   that. Cost neglect is the single most common way these results get inflated,
   so the costs should be a published number.

---

## 2. Our paper impact model understates slippage by a factor of two

This one is a live bug, found by grounding the code against the impact
literature.

`PaperExecutor` (`api-ts/src/services/autopilot/executor.ts:46`) computes

```ts
const impact = req.amountUsd / (liquidityUsd + req.amountUsd)
```

For a constant-product pool with quote reserve `X` and token reserve `Y`, buying
with `Δx` returns `Δy = Y·Δx/(X+Δx)`, so the effective price is `(X+Δx)/Y`
against a mid of `X/Y` — an impact of exactly **`Δx / X`**.

`X` is the *quote-side* reserve, which is half the pool. But `liquidityUsd` is
total TVL: GeckoTerminal's `reserve_in_usd` (`market.ts:165`) and DexScreener's
`liquidity.usd` (`market.ts:82`) both count **both** sides. So the correct
denominator is `liquidityUsd / 2`, and the correct numerator has no `+ amountUsd`
term.

Net effect: **we model roughly half the slippage we would actually pay.** At our
`maxPoolSharePct: 1` ceiling, true one-way impact is ~2% and a round trip ~4%;
the current model says 1% and 2%.

The empirical literature is consistent with this being the right correction
rather than an over-correction. The square-root law of metaorder impact is
confirmed on crypto specifically — [Donier & Bonart](https://consensus.app/papers/details/2093fa902cbc5b4699d45cc5c6300ce2/)
reconstruct over a million Bitcoin metaorders and find square-root impact holding
across four decades of size — and [Maitrier et al.](https://consensus.app/papers/details/1f256a6b28ab52de89b732bf962d4814/)
(2025, Tokyo exchange, trader-ID data) show the law has *mechanical* rather than
informational origin, i.e. it applies to uninformed flow like ours. Square-root
impact is *more* punitive than the AMM curve at small sizes, so the AMM
formula remains the conservative-but-defensible floor. We are not switching
models; we are fixing the arithmetic of the one we have.

**What we change.** Fix the formula. Charge `2·Δx/TVL`. This is the same class
of error as the three fixed last session — all four biased the paper record
upward, none was visible without deriving it.

---

## 3. Sizing on the model's stated confidence is the wrong primitive

`llmThesis.ts:139` sizes a position as `budget × verdict.confidence`. Two
independent literatures say this is a mistake.

**Verbalized confidence is not calibrated.** LLM-as-judge systems show a
documented [overconfidence phenomenon](https://arxiv.org/abs/2508.06225) where
stated confidence materially overstates correctness; the effect is
[mechanistically traceable](https://arxiv.org/html/2604.01457) to identifiable
internal circuits, and RLHF *worsens* it. In finance specifically, the argument
is that models optimised for likelihood and human preference have a
[structural tendency](https://arxiv.org/html/2602.14233v1) to produce
plausible-sounding text over reliable uncertainty quantification. A 0.8 from the
model is not an 80% hit rate, and nothing in our system has ever checked whether
it is.

**Overbetting is catastrophically asymmetric.** The fractional-Kelly result
(MacLean, Thorp & Ziemba) is that a ~10% error in the estimated edge can produce
a ~50% overbet, that full-Kelly drawdowns of 50–80% are routine along the path,
and that half-Kelly keeps ~75% of the growth rate for a large reduction in both
variance and estimation-error sensitivity. Underbetting only grows slower;
overbetting past a threshold makes the long-run growth rate *negative*.

Multiplying a hard budget by an uncalibrated, systematically-inflated scalar is
sizing on an unvalidated edge estimate.

**What we change.** In order:

1. **Measure the calibration before trusting it.** We already store `confidence`
   on every decision and the outcome on every closed position. Nobody has ever
   joined them. Ship a reliability curve — stated confidence bucket vs realised
   win rate — as a first-class dashboard panel. If the model says 0.8 and hits
   0.4, that is the most interesting number on the site, and it is one omo
   cannot show because it does not publish per-decision confidence at all.
2. **Compress the sizing map** to a fractional-Kelly-shaped floor and cap rather
   than raw linear scaling, so a confident-but-wrong model cannot express a full
   budget. Do this *after* (1), calibrated against our own record.

---

## 4. Our screening features are the weak ones; the predictive ones are on-chain behaviour

[MELT](https://arxiv.org/html/2602.13480v2) labels 41,470 Solana memecoins by
realised post-migration drawdown and benchmarks 122 on-chain features.
Distribution alone is worth stating: **84.13% high-risk, 4.53% low-risk.**

Feature-ablation result: dropping **market-activity** features (transaction
counts, trader participation, wash-trade signals) causes the largest performance
degradation, followed by **bundle statistics** — concentration measured *after
clustering coordinated accounts*. Model-guided selection cut losses by 34
percentage points versus random. Best AUPRC was 0.5729, which is the honest
framing: this is a real edge, not a solved problem.

Compare our `Candidate`: price, liquidity, volume, market cap, price changes,
holder count, and a security verdict. We have **no** trader-participation
measure, **no** wash-trade signal, and our concentration measure (`topHolderPct`)
is un-clustered — the exact naive version the paper's bundle features improve on.
A deployer splitting across 20 fresh wallets defeats it completely.

Our system prompt already tells the model "turnover far above the pool's depth is
more often wash trading than demand" — but we never give it the data to apply
that, because we pass volume without unique-trader counts.

Separately, [SolRugDetector](https://arxiv.org/pdf/2603.24625) identified 76,469
rug pulls among 100,063 tokens issued in H1 2025 using only on-chain transaction
and state data, and Solidus Labs reports 98.7% of Pump.fun launches show
pump-and-dump behaviour with under 2% reaching a major DEX.

**What we change.** Add unique-buyer / unique-seller counts and a
buyers-per-volume ratio to `Candidate`. GeckoTerminal's pool payload already
carries per-window transaction and buyer/seller counts, so this is a parsing
change in `market.ts`, not a new data source. Clustered-holder analysis is a
larger piece of work — it belongs to the Python `token_intel` service, and is
recorded here as scoped-but-not-started rather than quietly dropped.

---

## 5. We cannot yet claim our track record means anything, and should say so

The autopilot publishes a live P&L. The relevant statistics are Bailey & López de
Prado's: the [Probabilistic Sharpe Ratio and Minimum Track Record Length](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551),
and the [Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf),
which corrects a Sharpe for selection bias under multiple testing, sample length,
skew and kurtosis. The [Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)
framework covers the case where many configurations were tried.

Minimum Track Record Length answers precisely the question a visitor to the
dashboard is asking: *how long must this run before the number is
distinguishable from luck?* For a strategy with our trade frequency and the
fat-tailed, strongly-skewed return distribution of memecoins, that length is
long — non-normality inflates it, and MinTRL is explicitly derived to account
for skew and kurtosis rather than assuming them away.

**What we change.** Compute PSR and MinTRL from our own realised trade returns
and publish both, with a plain-language verdict: *"this record is not yet long
enough to distinguish skill from luck — N of M trades."* Every competitor in
this category publishes a number with no error bar. Publishing the error bar,
and flagging our own record as insufficient while it is, is the strongest
possible statement of the thing we are actually selling.

---

## 6. Confirmed as already correct — no change

Recorded so these are not re-litigated.

- **Multi-agent debate architectures** ([TradingAgents](https://consensus.app/papers/details/e7ae4968482e5773b718765f4182ddaf/),
  [FinMem](https://consensus.app/papers/details/5651cdce424e54bea80bc7f0e5469351/))
  report gains, but the [coordination survey](https://consensus.app/papers/details/4b99308628805ba4afdfe01af400bc79/)
  presents its Coordination Primacy Hypothesis as explicitly *falsifiable and
  not yet validated*, noting the evaluation infrastructure to test it "does not
  yet exist." Its Coordination Breakeven Spread metric asks whether coordination
  adds value net of transaction costs. Our single-judge design is the right
  default until our own costs are honest enough to measure a spread against.
- **Structured output constraining the model to judgement only** matches
  [Lopez-Lira's](https://consensus.app/papers/details/b894705b527a54edac8e989636ba1626/)
  market-simulation design, where agents "submit standardized decisions using
  structured outputs and function calls while expressing their reasoning in
  natural language." Our stronger version — identity and size set by our code,
  never the model — is what makes a hallucinated ticker unexpressible.
- **Refusal being cheap and common** is supported by StockBench's finding that
  the agents that succeed do so on risk management. Our thin exit gate and
  "hold costs nothing" prompt line stay.

---

## Ranked backlog

| # | Change | Why it ranks here |
|---|--------|-------------------|
| 1 | Fix the AMM impact factor of 2 (§2) | A live bug biasing the published record upward. Small diff. |
| 2 | PSR / MinTRL honesty panel (§5) | Turns our main claim into a published statistic. Nobody else does it. |
| 3 | Buy-and-hold benchmark line (§1) | The one comparison that decides whether the agent is worth running. |
| 4 | Confidence reliability curve (§3) | Measures a scalar we already bet on and have never validated. |
| 5 | Unique-buyer / wash-trade signals (§4) | Highest-value features per the ablation; parsing-only change. |
| 6 | Recalibrate sizing map (§3) | Blocked on #4 — needs our own calibration data first. |
| 7 | Clustered-holder concentration (§4) | Real work in `token_intel`. Scoped, not started. |

Items 1–5 are actionable now. 6 is deliberately sequenced behind its evidence.
7 is honestly out of scope for this pass.
