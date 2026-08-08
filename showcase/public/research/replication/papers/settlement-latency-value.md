# What Is a Minute of Cross-Chain Execution Worth? Pricing Latency Without Confusing ETA for Finality

**Tsolmondorj Natsagdorj (0xSoftBoi)**  
Suwappu Research  
8 August 2026

*What this is: a quantitative policy-calibration paper built around Suwappu's own cross-chain routing rule. Current source allows a sufficiently faster route to replace the score winner when both timing inputs are trusted, the faster route's score is no more than 10 basis points worse, and its provider ETA is less than half the winner's. We ask what that 10bp ceiling means economically. The answer is deliberately narrow: at the 3.65% SOFR observation for 6 August 2026 and a simple ACT/360 convention, 10bp equals 9.863 days of financing carry. Minute-scale financing carry is therefore far too small, by itself, to calibrate a 10bp speed concession. The paper does **not** say faster routing is worth zero, estimate production savings, or treat a provider ETA as legal settlement finality.*

*Suwappu builds the routing infrastructure whose policy is examined here. The code observation, assumptions, arithmetic, limitations, and replication files are released so the critique can be reproduced. Full disclosures are in Section 9.*

---

## Executive summary

- **The 10bp rule is a policy ceiling, not an empirically estimated value of time.** In the [8 August source snapshot](https://github.com/0xSoftBoi/suwappubot/blob/52d901923a725e7440693ba050733def13d71895/bot/services/swap_engine.py#L492-L589), the speed tiebreak is cross-chain only. Both timing inputs must be provider-reported under the router's trust flag; the candidate ETA must be strictly less than half the score winner's ETA; and its score may be at most 0.001 below the winner on the same scoring basis.

- **Pure USD financing carry cannot explain a 10bp concession over minutes.** The latest SOFR observation available when this paper was written is **3.65% for 6 August 2026** ([FRED series sourced from the Federal Reserve Bank of New York](https://fred.stlouisfed.org/series/SOFR)). The New York Fed describes SOFR as a broad overnight Treasury-secured cash-borrowing measure and applies actual calendar days with a 360-day year to its SOFR averages and index ([rate methodology](https://www.newyorkfed.org/markets/reference-rates/additional-information-about-reference-rates)). On a simple ACT/360 basis, 10bp equals **9.8630 days** of 3.65% carry.

- **The scale gap is large.** One minute of 3.65% simple carry is 0.000704bp. Five minutes is 0.003520bp. Sixty minutes is 0.042245bp. The 10bp policy ceiling is therefore **14,202.7×, 2,840.5× and 236.7×** those financing amounts, respectively. At a hypothetical $1m USD-equivalent winner-score value, five minutes of simple SOFR carry is about **$0.35** while 10bp is **$1,000**.

- **That does not prove the faster route is overpriced.** It proves that *financing carry is not the missing valuation model*. Faster delivery can reduce market exposure, failure/retry cost, liquidity and operational exceptions, or satisfy an explicit service-level preference. Those terms must be measured or budgeted. This paper has no joined production quote-to-outcome dataset with which to estimate them.

- **ETA, funds availability, reconciliation and finality are different endpoints.** The CPMI glossary defines final settlement as an irrevocable and unconditional transfer/discharge at a legally defined moment ([CPMI glossary](https://www.bis.org/cpmi/glossary.pdf)). The FSB's cross-border-payment speed target separately measures crediting/availability and reconciliation ([G20 targets](https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/cross-border-payments/g20-targets-for-enhancing-cross-border-payments-2/)). A bridge or aggregator ETA is useful operational evidence; it is not, without an explicit rule, evidence of legal finality.

- **The implementable replacement is a measured willingness-to-pay curve for speed.** Keep security/finality eligibility as constraints, value the quote-score concession on a consistent economic basis, estimate route-class outcome costs from decision and completion telemetry, and run the calibrated rule in shadow mode before it can steer. The present 10bp number can remain a hard ceiling while the evidence needed to justify any portion of it is collected.

The central conclusion is not "speed is cheap." It is more precise: **a universal bps price for speed is not supported by a minute-scale funding-cost argument.** If an execution desk wishes to spend basis points for minutes, the value must come from a documented risk, outcome, or service preference other than cash carry alone.

## 1. Research question and evidence ledger

The research question is deliberately falsifiable:

> Does minute-scale USD financing carry provide an economically plausible calibration for Suwappu's current 10bp cross-chain speed-tiebreak ceiling?

For the 3.65% benchmark and the current policy, the answer is no. That answer is arithmetic conditional on the stated inputs. It is not a claim that every faster route should lose.

| Claim | Evidence state | Basis |
|---|---|---|
| Router may trade up to 10bp of winner score for a trusted-time route with ETA < ½ winner ETA | **SOURCE-VERIFIED** | Immutable Suwappu source snapshot linked above |
| SOFR benchmark = 3.65%, value date 6 Aug 2026 | **SOURCE-VERIFIED** | FRED observation; source listed as Federal Reserve Bank of New York |
| ACT/360 convention | **SOURCE-VERIFIED** | New York Fed SOFR averages/index methodology |
| 10bp = 9.8630 days of simple carry at 3.65% | **MODEL / REPRODUCED** | Closed-form arithmetic; released standard-library script; key outputs independently evaluated in Wolfram Language |
| 10bp is the economically optimal speed premium | **NOT ESTABLISHED** | No causal or realized-outcome calibration in this study |
| Faster provider ETA implies earlier legal finality | **NOT ESTABLISHED** | ETA and finality are different concepts and no legal-finality mapping is tested |
| The tiebreak improves realized user outcomes in production | **UNVERIFIED** | No production replay or joined execution-outcome sample is used |

This distinction matters. Repository source can establish the decision rule. A rate source can establish the benchmark input. Arithmetic can establish the scale comparison. None of those, singly or together, establishes realized customer welfare.

## 2. The decision rule under test

Current routing first chooses a value winner. When the evidence gates support output pricing and gas, the score can be net of trusted gas converted into output-token units; when those gates fail, selection falls back to gross quoted output. The speed tiebreak then operates on **the same score basis that produced the winner**.

For a cross-chain order, let:

- `S_w` = score of the initial winner;
- `S_f` = score of a faster candidate;
- `T_w` and `T_f` = their trusted provider ETAs; and
- `b` = 0.001, the 10bp concession ceiling.

Ignoring the source's additional exclusions and deterministic tie ordering, the candidate can displace the winner only if:

`T_f < T_w / 2` and `0 <= (S_w - S_f) / S_w <= 0.001`.

Three details prevent over-reading that inequality.

**First, 10bp is relative to winner score, not automatically to input notional.** If the score is in output-token units, a dollar illustration requires a contemporaneous economic value for those units. This paper therefore uses `V` for the *USD-equivalent economic value of the winner score* when it gives dollar examples. It does not say a $1m input order necessarily has a $1,000 speed budget.

**Second, "trusted" is a provenance label, not a forecast-accuracy result.** The source currently marks timing as trusted when it is provider-reported for the relevant adapters and excludes several hard-coded duration estimates from the tiebreak. That is a good evidence boundary, but the paper does not test whether provider ETAs are calibrated.

**Third, the policy is intentionally discontinuous.** A candidate at exactly half the winner ETA does not qualify; one just below half can. A candidate 10.01bp worse does not qualify; one exactly 10bp worse can. Those cutoffs are auditable controls, but auditability is not evidence that the thresholds maximize expected value.

The rest of the paper asks what one possible justification—financing carry—can contribute to that threshold.

## 3. A minimal value-of-time model

Let:

- `V` = USD-equivalent economic value of the winner score;
- `Δt` = minutes saved by the faster route;
- `r` = annual simple funding benchmark as a decimal;
- `b` = maximum score concession as a decimal (`0.001` here); and
- the money-market year = 360 days = 518,400 minutes.

The maximum dollar-equivalent score concession is:

`Policy cap ($) = b × V`.

Simple financing carry over the time saved is:

`Carry ($) = V × r × Δt / 518,400`.

Dividing the first by the second removes `V`:

`Policy cap / carry = b × 518,400 / (r × Δt)`.

The annual simple rate that would make the full 10bp concession equal financing carry over `Δt` is:

`Implied annual rate = b × 518,400 / Δt`.

And the time needed for 3.65% simple carry to accumulate to 10bp is:

`Break-even days = b × 360 / r = 9.8630137 days`.

That last result is the core calibration. A tiebreak designed for routes whose duration differences are measured in minutes is spending from a ceiling equal to almost ten days of the selected financing benchmark.

SOFR is useful here because it is public, transaction-based and reproducible. It is **not** asserted to be Suwappu's own cost of funds, a user's opportunity cost, a bridge risk premium, or the correct hurdle rate for every institution. It is a clean cash-carry benchmark against which to test one narrow economic story.

## 4. Results: minutes do not generate 10bp of cash carry

**Table 1. 10bp ceiling versus simple financing carry at 3.65% SOFR**

| Minutes saved | Simple carry (bp) | 10bp / carry | Annual simple rate implied by full 10bp | Carry on $1m score value |
|---:|---:|---:|---:|---:|
| 1 | 0.000704 | 14,202.74× | 51,840% | $0.07 |
| 5 | 0.003520 | 2,840.55× | 10,368% | $0.35 |
| 10 | 0.007041 | 1,420.27× | 5,184% | $0.70 |
| 30 | 0.021123 | 473.42× | 1,728% | $2.11 |
| 60 | 0.042245 | 236.71× | 864% | $4.22 |

The released CSV contains the unrounded values. The key outputs were separately evaluated in Wolfram Language and agree with the standard-library replication script to the displayed precision.

![A log-scale line chart showing the ratio of the 10bp policy ceiling to simple SOFR financing carry for one, five, ten, thirty, and sixty minutes saved. The ratio falls from 14,203 times at one minute to 237 times at sixty minutes.](/research/latency-carry.svg)

The $1m example makes the interpretation concrete. Five minutes of simple 3.65% carry is approximately **$0.35** on $1m. The full 10bp score concession is **$1,000** on a $1m USD-equivalent score value. The conclusion is not that a five-minute improvement can never be worth $1,000. The conclusion is that **$999.65 of that hypothetical willingness to pay would need an explanation other than the modeled cash carry**.

The result is also insensitive to modest changes in the funding benchmark. From the closed-form expression, even a 10% annual simple rate would require **3.6 days** to accumulate 10bp. At an extreme 100% annual simple rate, 10bp is still **8.64 hours** of simple carry. The minute-scale conclusion does not depend on fine precision in a 3.65% observation.

## 5. What can make faster execution worth more than carry?

A serious value-of-speed function is broader than financing cost. A useful decomposition is:

`W_speed = carry + expected market-exposure loss avoided + expected failure/retry loss avoided + liquidity/operations cost avoided + explicit service-level value`.

Only the first term is quantified in this paper. The rest are hypotheses until outcome data support them.

### Market exposure

If a slower route leaves the user economically exposed to a moving destination asset or forces a later hedge, shorter completion time can reduce implementation shortfall. The right quantity is not "minutes × a universal volatility number." It is the difference in the conditional distribution of realized cost between route choices, measured against a timestamped benchmark.

### Failure, retry and exception cost

A route that is nominally fast but fails more often can be worse than a slower reliable route. Conversely, if a faster route materially reduces timeout, retry, manual-repair, or stuck-liquidity incidence, those avoided losses can be economically larger than funding carry. They require route-level outcome data, not quote-time ETA alone.

### Liquidity and operating constraints

Faster availability can matter to a treasury that must recycle balances, meet a cutoff, fund another obligation, or limit operational queues. Those constraints can create nonlinear value around deadlines. If they matter, the policy should encode the deadline or liquidity state explicitly instead of silently proxying it through a global 10bp constant.

### Settlement method and finality

Speed and settlement risk must not be collapsed into one metric. The [CPMI glossary](https://www.bis.org/cpmi/glossary.pdf) makes final settlement a legally defined moment. [PFMI Principle 8](https://www.bis.org/pfmi/help/principleid.htm) separately emphasizes clear and certain final settlement and, where necessary or preferable, intraday or real-time completion.

The distinction is visible in conventional markets. The BIS's June 2026 analysis of the 2025 Triennial Survey reports that 90% of average daily FX settlement used methods that eliminate or mitigate FX settlement risk while 10%, about $1.4tn, remained on gross bilateral settlement; it also notes that payment-versus-payment eliminates FX principal settlement risk but does not by itself eliminate replacement-cost or liquidity risk ([BIS Quarterly Review](https://www.bis.org/publ/qtrpdf/r_qt2606c.htm)). That evidence is about wholesale FX, not crypto bridges. Its relevance here is conceptual: **the settlement mechanism can change the risk independently of the stopwatch**.

The [FSB's G20 cross-border-payment targets](https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/cross-border-payments/g20-targets-for-enhancing-cross-border-payments-2/) make a similar measurement point from another angle: the wholesale speed target specifies when a payment is credited and separately requires reconciliation. This paper does not claim that target governs Suwappu. It uses the framework to show why a latency policy needs a named start event and a named completion event.

For Suwappu, `estimated_time` should therefore be described as **provider-reported route duration evidence**. Calling it "settlement time" without a route-specific definition would overstate what the field proves.

## 6. From a heuristic to a calibratable execution control

The current 10bp / half-time rule has two virtues: it is deterministic and simple to audit. The next version should preserve those virtues while making the willingness to pay observable.

### 6.1 Keep risk eligibility outside the price function

Before valuing speed, define whether a route is eligible at all: supported asset and chain, approved provider/bridge class, required security properties, transaction limits, compliance policy, and the operational/finality endpoint the desk accepts. A faster route should not buy its way through a hard risk limit by offering a better ETA.

### 6.2 Normalize the economic concession

For each quote race, persist the initial winner and candidate on the exact scoring basis used by the router. When a credible output-USD mark exists, compute:

`score_concession_usd = (S_w - S_f) × output_usd_price`.

When that conversion is not credible, retain the native-unit concession and do not fabricate a dollar TCA result. This mirrors the current router's useful principle that untrusted gas evidence should not be promoted into precision.

### 6.3 Measure a route outcome, not an ETA claim

Each decision needs a durable `decision_id`, policy version and four clocks where they are technically observable:

| Field | Purpose |
|---|---|
| `decision_at` | Quote/routing decision timestamp |
| `submitted_at` | Transaction or route submission timestamp |
| `funds_available_at` | Destination funds meet the documented usability condition |
| `finality_observed_at` + `finality_definition` | A separately defined technical/legal-finality proxy, only when the system can support that claim |

For every candidate, retain provider, raw output, score, gas input and trust status, provider ETA and trust status, and the benchmark price used for any conversion. For the chosen route, join realized output, realized fee/gas, failure/retry state, time to usable funds, exception handling, and the benchmark price at predeclared horizons.

The [BIS Markets Committee report on FX execution algorithms](https://www.bis.org/publ/mktc13.pdf) is useful methodology here without being a regulatory mapping. Its TCA discussion emphasizes accurate timestamps across the trade life cycle and outcome measures such as slippage, market impact and rejected trades. A cross-chain router needs the analogous join between **decision evidence and realized outcome**.

### 6.4 Estimate the non-carry terms by route class

Once there is sufficient outcome coverage, estimate at minimum:

- provider-ETA calibration: median and tail absolute error, plus percentile coverage;
- time-to-usable-funds distributions by route class and relevant size band;
- failure/retry probability and expected repair cost;
- implementation shortfall conditional on elapsed time and asset class;
- explicit treasury cutoff/SLA penalties where the user has supplied them; and
- separate finality/risk states rather than treating speed as their proxy.

The result can be a versioned allowed-premium curve. In bps of normalized score value:

`allowed_speed_bps = min(10bp, carry_bps(Δt) + approved_measured_risk_premium_bps + explicit_SLA_bps)`.

The formula is a governance template, not an estimated coefficient from this paper. An unmeasured risk premium should not enter as a guessed number merely to make the equation close.

### 6.5 Shadow the policy before letting it steer

Run the proposed calibrated rule on the same quote races without changing the winner. Compare its counterfactual choices with the existing heuristic and then with realized outcomes. Promote it only when predeclared coverage, timestamp completeness and outcome-quality checks pass. That produces a correction path: a parameter can be challenged with evidence rather than defended because it is already in production.

## 7. Falsification and decision thresholds

This paper is designed to be superseded by better data.

**The narrow financing conclusion would change** if the stated inputs or formula were wrong. The inputs are pinned, the formula is closed form, the outputs are reproduced in CSV and SVG, and the key values were independently evaluated in Wolfram Language. Changing from 3.65% to another funding benchmark changes the result linearly and can be rerun in one script constant.

**The policy assessment would change** if joined route outcomes show that the expected non-carry loss avoided by faster trusted-time routes is persistently large enough to justify the concession. For a given route class and size band, evidence that `expected avoided loss + carry + explicit SLA value >= score concession` would support paying that concession. Evidence materially below it would support a lower threshold.

**The use of ETA would change** if provider-reported durations are poorly calibrated. If an ETA source cannot predict the defined usability endpoint with acceptable error and coverage, it should lose steering authority even though its provenance is "trusted."

**The endpoint would change** if a bank or treasury requires a different definition of completion. A route that makes tokens visible in a destination wallet before they are usable, reconciled, or considered final under the relevant policy has not necessarily satisfied the same business objective.

This gives the control a clean governance question: *what observed cost or explicit preference pays for each basis point of speed premium?* A route can still be chosen for speed, but the answer becomes reviewable.

## 8. Reproducibility and limitations

The complete replication for this paper is small by design:

- `code/settlement_latency_value.py` — standard-library calculation plus deterministic CSV/SVG generation;
- `data/settlement_latency_value.csv` — the five scenario rows used in Table 1; and
- `/research/latency-carry.svg` — generated from those rows, not manually redrawn.

Run from `showcase/public/research/replication`:

```bash
python3 code/settlement_latency_value.py
```

No API key, RPC endpoint or network call is required. The SOFR observation is pinned to its value date so future runs do not silently rewrite a historical paper. Source currency should be checked separately if the study is re-dated.

The main limitations are intentional and material:

1. **No production TCA sample.** This paper does not measure how often the tiebreak fires, what order values it affects, whether the selected route is actually faster, or whether it improves realized output.
2. **SOFR is a benchmark, not a firm-specific funding curve.** Credit, liquidity, capital, collateral, client and balance-sheet costs are outside the 3.65% input.
3. **Winner score is not synonymous with input notional.** Dollar examples require an economic conversion of the scoring unit; the router's 10bp comparison itself is relative to winner score.
4. **Scenario minutes are a calibration grid, not observed route pairs.** The table should not be read as the empirical distribution of Suwappu route savings.
5. **Provider ETA is not legal finality.** This paper measures no jurisdiction-specific legal settlement point and makes no claim that a bridge's completion semantics meet one.
6. **Non-carry value is unestimated.** Market exposure, failure, retry, liquidity, operating exceptions and SLA preferences are the variables a production calibration must measure next.
7. **Source observations are versioned.** A later routing policy can change. The immutable commit link defines the implementation perimeter for this edition.

## 9. Sources and disclosures

Primary institutional sources:

- Federal Reserve Bank of New York, [SOFR data and methodology](https://www.newyorkfed.org/markets/reference-rates/sofr) and [additional reference-rate information](https://www.newyorkfed.org/markets/reference-rates/additional-information-about-reference-rates).
- Federal Reserve Bank of St. Louis FRED, [SOFR series](https://fred.stlouisfed.org/series/SOFR), sourced from the Federal Reserve Bank of New York; 6 August 2026 observation = 3.65%.
- CPMI, [Glossary of terms used in payments and settlement systems](https://www.bis.org/cpmi/glossary.pdf), including final settlement and settlement lag.
- CPMI-IOSCO, [PFMI Principle 8 settlement finality](https://www.bis.org/pfmi/help/principleid.htm).
- BIS Markets Committee, [*FX execution algorithms and market functioning*](https://www.bis.org/publ/mktc13.pdf), used for TCA measurement design by analogy.
- BIS, [*Uncovering FX settlement risk: new measures from the 2025 BIS Triennial Survey*](https://www.bis.org/publ/qtrpdf/r_qt2606c.htm), June 2026; used to distinguish settlement method from elapsed time.
- Financial Stability Board, [G20 targets for enhancing cross-border payments](https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/cross-border-payments/g20-targets-for-enhancing-cross-border-payments-2/), used to distinguish crediting/availability from reconciliation.

Implementation source:

- Suwappu, [`bot/services/swap_engine.py` at commit `52d901923a725e7440693ba050733def13d71895`](https://github.com/0xSoftBoi/suwappubot/blob/52d901923a725e7440693ba050733def13d71895/bot/services/swap_engine.py#L492-L589).

*Disclosures: Suwappu builds cross-chain execution infrastructure and this paper evaluates Suwappu's own routing policy. That creates an obvious commercial and authorship interest; the paper therefore treats source code as a case study, publishes the adverse result that financing carry does not justify the existing ceiling, and does not infer production performance. No provider named in the routing source reviewed this paper before publication. Wolfram was used as an independent arithmetic check, not as peer review or evidence about routing outcomes. This is research, not investment advice, a legal-finality opinion, a regulatory best-execution determination, or a claim that conventional FX rules apply to crypto routing.*
