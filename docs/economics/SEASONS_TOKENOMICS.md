# Suwappu Seasons — Tokenomics & Monetary Constitution

> **Status:** committed economic design for the convertible-points seasons program.
> The constants in §4 are the *monetary constitution* — they are pre-committed and
> should change only by a deliberate, announced governance act, never silently. The
> credibility of the issuance rule is itself part of the token's value
> (Kydland–Prescott time-consistency; Buchanan constitutional economics).

This document is grounded in the GMU/public-choice tradition (Tullock rent-seeking,
Buchanan constitutional economics, Tabarrok/Cowen transfer-seeking) and monetary
economics (Friedman's k-percent rule, Bitcoin's halving, the quantity theory).

---

## 1. What the program is, economically

Points earned in a season convert **pro-rata** to a fixed per-season token pool:

```
user_tokens_k = Pool_k · (user_points_k / total_points_k)
```

This rule is **exactly a Tullock contest** with the proportional / lottery contest
success function `p_i = e_i / Σ e_j`, where the prize `V` is the dollar value of
`Pool_k` and a user's "effort" `e_i` is the points they accumulate.

### 1.1 The unavoidable result: rent dissipation

With `n` free-entering, risk-neutral farmers and linear cost `c` per point, the
symmetric Nash equilibrium is:

```
e*  = (n−1)/n²  · (V/c)        individual points
S*  = (n−1)/n   · (V/c)        total points minted
C*  = (n−1)/n   · V            total $ farmers spend
D(n)= (n−1)/n                  fraction of the pool dissipated  → 1 as n → ∞
```

| n | dissipated `(n−1)/n` |
|---|---|
| 2 | 50% |
| 10 | 90% |
| 100 | 99% |
| ∞ | **100%** |

**Caps do not change `D`.** Raising the cost `c` (min-swap size, daily caps) only
changes the *quantity* of effort, not the *fraction* of the pool competed away.
The dissipation fraction is independent of `c`. So caps are hygiene, not the model.

### 1.2 The only real lever: where the dissipated cost flows

Decompose the cost of a farmed point: `c = c_external + c_protocol`.

- `c_external` — gas to validators, bridge fees, wash-trade slippage to LPs/MEV,
  opportunity cost. **Pure deadweight.** (Blast: launch-day crash to ~$0.02, TVL
  −97%; friend.tech: token −98%. Points rewarded activity whose cost left the system.)
- `c_protocol` — **fees paid to Suwappu** to earn the points.

> **Self-funding-airdrop theorem.** If points are denominated in fees paid to the
> protocol (`points_i = α · fees_paid_i`), the dissipated rent is *recouped as
> protocol revenue*: `R = c_protocol · S* = (n−1)/n · V → V`. The program pays for
> itself out of the very farming it induces, and **Sybil-splitting becomes neutral**
> — 100 fake wallets paying the same total fees as one real whale earn the same
> points at the same cost, so detection is optional. (Hyperliquid is the live proof:
> points were earned via fee-paying perps volume; the token *appreciated*.)

**This is why Suwappu season points are denominated in fees paid, not raw volume.**
Raw-volume points reward wash trading whose cost is slippage paid to *third parties*
— the deadweight corner. Fee-denominated points put the dissipation in our treasury.

---

## 2. Earning rule (within a season)

```
season_points_from_swap = SEASON_POINTS_PER_FEE_USD · fee_paid_usd · multiplier
```

- **Fee-denominated** (§1.2): the productive, Sybil-neutral, self-funding core.
- `SEASON_POINTS_PER_FEE_USD = 100` (100 points per $1 of protocol fee).
- Engagement grants (daily check-in, streak, referral activation) are **small,
  capped** season-point bonuses on top — they are *not* fee-backed, so they are
  bounded by the daily cap (5,000 pts/user/day) and referral cap (10,000 pts/season)
  to keep the program's value fee-backed in aggregate. Check-in *streaks* are a
  deliberate **time-weighting** device (reward sustained, not snapshot, activity —
  the retention lever that separates genuine users from mercenary farmers).
- **Multipliers** (level × streak, capped 1.75×): in a pro-rata pool a *uniform*
  multiplier cancels out (everyone ×k ⇒ identical shares). Our multipliers are
  *non-uniform* (favor high level + long streak), so they **redistribute toward
  loyal users without inflating token supply** (the pool is fixed). They are a
  loyalty/retention transfer, not an emission.

Anti-farm hygiene (necessary, not sufficient): min-swap $5 (kills dust wash trades),
daily cap, referral cap, action allowlist. The *real* anti-farm is that points cost
real fees.

---

## 3. Emission across seasons (inflation control)

A single fixed pool has no within-season nominal inflation (shares only). The
inflation problem is **across seasons**: a sequence of pools dilutes circulating
supply. We control it with a **pre-committed, finite-N geometric (disinflationary)
schedule** — the airdrop analogue of Bitcoin's halving / Curve's −15.9%/yr / a
Friedman k-percent rule that *declines*.

```
Pool_k = A · (1 − δ) / (1 − δ^N) · δ^(k−1)        k = 1..N   (sums exactly to A)
π_k    = Pool_k / Σ_{j<k} Pool_j                  season-over-season inflation
```

`π_k` is strictly decreasing → 0. Each season's flow is `δ` of the prior → the
stock-to-flow ratio rises every season (Bitcoin's mechanism).

**Revenue cap (demand-peg).** Applied at settle/TGE so emission growth < demand
growth (the Hyperliquid lesson):

```
effective_Pool_k = min( Pool_k ,  γ · realized_fee_revenue_k / token_price )
```

We record `realized_fee_revenue_usd` per season now so this cap is computable at TGE
(it is inert pre-price). `γ = 2.0` (emit at most 2× of the season's fee revenue).

**Sell-pressure.** `SellPressure_k = φ · effective_Pool_k · Price_k`. We suppress the
sell-through `φ` with **vesting** (40% liquid at claim, 60% linear over the next two
seasons) and a **velocity sink** (staked tokens/points earn a next-season multiplier).
`season_snapshots` already carries `claimed`/`claimed_at`/`claim_tx_hash` for this.

---

## 4. The committed constants (monetary constitution)

| Parameter | Value | Rationale |
|---|---|---|
| Token max supply | 1,000,000,000 SUWP | genesis |
| Program allocation `A` | **30%** = 300,000,000 | between HYPE (31%) and the Jito/ARB/OP 10–19% band |
| Seasons `N` | **8** | multi-season cadence smooths sell pressure (OP/Ethena) |
| Decay `δ` | **0.75** (−25%/season) | between Bitcoin's −50% and Curve's −16% |
| Revenue multiple `γ` | **2.0** | self-throttle in weak seasons |
| Points per fee $ | **100** | fee-denominated earning |
| Vesting | 40% at claim, 60% over 2 seasons | suppress sell-through φ (Jito pattern) |

### The 8-season schedule (1B supply, A = 300M, δ = 0.75)

Seasons are **weather-named and labeled by official company fiscal quarter** — each
season *is* one fiscal reporting quarter, so the disinflationary emission lands on the
same cadence as quarterly token reports. The **company fiscal year starts at the summer
launch**, so the beta = **Q1 FY26**; weather names cycle Summer → Fall → Winter → Spring
and a new fiscal year begins each summer. 8 seasons = 8 quarters = **2 years** (FY26 Q1 →
FY27 Q4). The calendar window (Jul–Sep, etc.) drives the weather name; the **Q-label is
the fiscal quarter**, not the calendar quarter.

| k | Season | Fiscal Q | Window | Pool_k | % supply | Cumulative | Inflation π_k |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | Summer 2026 | Q1 FY26 | Jul 1 – Oct 1 2026 | 83,343,790 | 8.33% | 83,343,790 | — (genesis) |
| 2 | Fall 2026 | Q2 FY26 | Oct 1 2026 – Jan 1 2027 | 62,507,842 | 6.25% | 145,851,632 | 75.0% |
| 3 | Winter 2027 | Q3 FY26 | Jan 1 – Apr 1 2027 | 46,880,882 | 4.69% | 192,732,514 | 32.1% |
| 4 | Spring 2027 | Q4 FY26 | Apr 1 – Jul 1 2027 | 35,160,661 | 3.52% | 227,893,175 | 18.2% |
| 5 | Summer 2027 | Q1 FY27 | Jul 1 – Oct 1 2027 | 26,370,496 | 2.64% | 254,263,671 | 11.6% |
| 6 | Fall 2027 | Q2 FY27 | Oct 1 2027 – Jan 1 2028 | 19,777,872 | 1.98% | 274,041,543 | 7.8% |
| 7 | Winter 2028 | Q3 FY27 | Jan 1 – Apr 1 2028 | 14,833,404 | 1.48% | 288,874,947 | 5.4% |
| 8 | Spring 2028 | Q4 FY27 | Apr 1 – Jul 1 2028 | 11,125,053 | 1.11% | 300,000,000 | 3.9% |

**Total 300,000,000 (30.0% of supply), disinflating monotonically 75% → 3.9%.**

> The current **Summer 2026** season is **k = 1** (**Q1 FY26**), pool 83,343,790 SUWP.
> `season_schedule(k)` derives the weather name, fiscal-quarter label, and calendar
> window deterministically from the season index (fiscal year anchored at the summer
> launch). Tuning: hold `A` and `N`, sweep only `δ` — the `(1−δ)/(1−δ^N)` factor
> renormalizes automatically.

---

## 5. Reference implementation

```python
A     = 0.30 * MAX_SUPPLY            # 300_000_000
N     = 8
DELTA = 0.75
NORM  = A * (1 - DELTA) / (1 - DELTA**N)

def season_pool(k):                                  # k = 1..N
    return NORM * DELTA**(k - 1)

def season_inflation(k, circ_prev):                  # π_k
    return season_pool(k) / circ_prev if circ_prev > 0 else None

def season_points_from_swap(fee_paid_usd, multiplier):
    return 100.0 * fee_paid_usd * multiplier         # fee-denominated, self-funding

def user_allocation(k, user_points, total_points):
    return season_pool(k) * (user_points / total_points)
```

---

## 6. One-paragraph summary

Suwappu's pro-rata points program is a Tullock contest that will dissipate the pool
no matter what — so we denominate points in **fees paid**, which routes that
dissipation into our treasury (self-funding) and neutralizes Sybils. Across seasons
we emit on a **pre-committed, finite-N geometric schedule** (A=30%, N=8, δ=0.75) that
is disinflationary by construction (75%→3.9%), revenue-capped so emission tracks
demand, and vested to suppress sell pressure. The commitment to the rule is itself
the point: a credible, non-discretionary issuance constitution earns a lower
inflation-risk premium than "we'll decide later."

*Theory: Tullock 1980 efficient rent-seeking; Buchanan–Tollison–Tullock,
Toward a Theory of the Rent-Seeking Society; Tullock, The Transitional Gains Trap;
Kydland–Prescott 1977, Rules Rather than Discretion; Friedman's k-percent rule.
Empirics: arXiv 2312.02752, 2503.14316; Hyperliquid, Jito, Curve, Blast, friend.tech,
LayerZero, Ethena tokenomics (2023–2026).*
