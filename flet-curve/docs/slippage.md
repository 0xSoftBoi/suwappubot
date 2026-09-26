# Where the slippage defaults come from

The app fills the slippage box in for you. This is how those numbers were
arrived at, because "0.5% seems fine" is what it replaced and the reasoning
is worth more than the constants.

    deposit / withdraw:   fee + 0.005%
    swap:                 0.2 * fee

`fee` is the pool's own, read from `fee()` — or `dynamic_fee(i, j)` on the
StableSwap-NG pools, which price each pair separately. Curve states fees as
a fraction of 1e10, so 1_500_000 is 0.015%.

Everything below was measured against mainnet: read-only calls through a
node for the quotes, and [titanoboa](https://github.com/vyperlang/titanoboa)
forks for the deposits, so the transactions really ran and really reverted.

## Why a swap and a deposit differ

`get_dy` is not an estimate. It is the same arithmetic `exchange` runs,
fee included, so the only thing a swap's tolerance has to cover is the pool
moving between the quote and the block. A fifth of the fee does that.

`calc_token_amount` is an estimate, and on some implementations it is
computed **fee-free** — it tells you what you would get if the deposit paid
no imbalance fee, and then the deposit pays one. A `min_mint` built from
that quote is therefore too high, and the transaction reverts.

## a = one fee

A deposit spread across the coins in the pool's current proportions pays no
imbalance fee at all; a fully single-sided one pays the most. Curve charges
`base_fee * N / (4(N-1))` on each coin's distance from the balanced split,
which for a fully single-sided deposit into a two-coin pool converges on one
whole base fee as the pool skews. That is a ceiling, not a fitted number.

Measured, by depositing on a fork and bisecting `min_mint` until
`add_liquidity` stopped reverting — 44 pools, sizes from 0.001% to 10% of
the pool:

| pool | implementation | fee | needed | ×fee |
| --- | --- | --- | --- | --- |
| cvxCrv/Crv | `factory` | 0.150% | 0.13696% | **0.91** |
| sdCRV/CRV | `factory` | 0.250% | 0.22392% | 0.90 |
| 3pool | `main` | 0.015% | 0.00952% | 0.63 |
| alETH/frxETH | `factory` | 0.040% | 0.00537% | 0.13 |
| msETH/WETH | `factory` | 0.040% | 0.00220% | 0.05 |
| everything else | `crvusd`, `stableswapng`, `factory_tricrypto`, `twocryptong`, `crypto` | — | 0.00012% | 0.00 |

Two things fall out of that table. The pools that need anything are the old
StableSwap implementations, whose `calc_token_amount` predates the
fee-inclusive rewrite; every modern pool mints *exactly* what it quoted, at
every size, so `min_mint` = the quote goes through untouched. And the spread
among the old ones — 0.05× to 0.91× — is how imbalanced each pool already
is, which is why the ceiling rather than the average is the thing to use.

0.00012% is the resolution of the bisection, not a measurement.

## b = 0.005%

Fitting `a` and `b` together across those 44 pools puts `b` at **zero** —
the smallest slope that covers everything at `b = 0` is 0.913. That is not
because staleness costs nothing; it is because a cross-section of pools
measured at one moment has no time axis in it at all.

So it was measured separately, by asking the archive: quote at the block you
would have quoted at, land at the block you land in.

| | worst drop |
| --- | --- |
| all 44 pools, five-block gap, quiet market | 0.00022% |
| TricryptoUSDC, three-block gap, volatile market | 0.0173% |
| stable pools, hundred-block gap | ≤0.002% |

It is bursty rather than pool-shaped, and 0.005% covers the quiet case
outright. The bursty case is covered by the fee term instead: the pools that
lurch are the ones charging enough for `a * fee` to absorb it — TricryptoUSDC
allows 0.035% against that 0.0173% — while the pools whose fees are too
small to help are the pegged ones, which do not lurch.

That is the whole reason to keep `a` above zero. Solve the same 44 pools for
the smallest slope at a given constant:

| b | smallest a that still covers everything |
| --- | --- |
| 0.000% | 0.913 |
| 0.002% | 0.900 |
| **0.005%** | **0.880** |
| 0.010% | 0.846 |
| 0.050% | 0.580 |

cvxCrv/Crv binds every one of them. Flatten `a` to zero and `b` has to
become 0.137% — that pool's entire shortfall — which every pegged pool would
then be handed. Keeping the fee term is what lets the constant stay small.

## Metapools, through a zap

Depositing an underlying coin into a metapool is two deposits: into the
base pool, then into the metapool with the LP it just minted. It pays both
pools' fees, so that is what the tolerance is:

    deposit / withdraw, underlying:   meta fee + base fee + 0.005%

Measured the same way — 99 deposits over the ten largest Ethereum
metapools with a zap, every underlying coin, sized at 0.1%, 1% and 10% of
that coin's reserve, comparing what the zap minted against what it had
just quoted a moment earlier:

| pool | meta + base | allowed | worst shortfall | of allowance |
| --- | --- | --- | --- | --- |
| alUSD/3Crv | 0.055% | 0.060% | 0.06035% | **1.01** |
| msUSD/FRAXBP | 0.050% | 0.055% | 0.04691% | 0.85 |
| MIM/3Crv | 0.055% | 0.060% | 0.04870% | 0.81 |
| FRAX/3Crv | 0.055% | 0.060% | 0.04554% | 0.76 |
| STBT/3Crv | 0.055% | 0.060% | 0.04413% | 0.74 |
| LUSD/3Crv | 0.055% | 0.060% | 0.03039% | 0.51 |
| PWRD/3Crv | 0.055% | 0.060% | 0.02866% | 0.48 |
| wibBTC/sBTC | 0.080% | 0.085% | 0.02958% | 0.35 |
| World Liberty USD1 | 0.011% | 0.016% | 0.00000% | 0.00 |
| MUSD/USDC/USDT | 0.011% | 0.016% | 0.00000% | 0.00 |

The two NG pools quote exactly, like the NG pools' own `calc_token_amount`
— zero shortfall at every coin and every size. The old factory zaps
inherit their pools' fee-free estimate, and pay it twice, once in each
pool: they cluster at three quarters of the two fees together.

The one row over the line is alUSD/3Crv at 10% of 3pool's USDT reserve —
a deposit some forty times the metapool's own size, where what is being
measured is price impact rather than an estimator's error. It is the same
caveat as everywhere else here: no constant covers a deposit large enough
to move the pool it is entering.

Withdrawals through the zap came back exact in every case measured, in
both dialects, so the same figure is generous on that side.

## Measuring this yourself

Two traps, both of which produced confident wrong answers here first:

**Quote after funding, not before.** `boa.deal` on a share-based token
changes its exchange rate, and the pool prices deposits through that rate.
Quoting before dealing measures the harness: it made ETH+/ETH look like it
under-minted by 30× its fee and strUSD/trUSD by 12×, with the error growing
linearly in deposit size — which is the tell, since a fee-shaped error does
not scale that way. Quoting after funding, both are exact at every size.

**A round trip does not isolate the estimator.** Quoting a deposit and then
quoting the withdrawal of that LP back out mixes the deposit estimate's
error with the withdrawal's real fee, and cannot separate them. It gave
"about one fee" for pools that turn out to need nothing.

The scripts are not committed — they are a few dozen lines each against a
local node, and the numbers above are pinned as a regression test in
`tests/test_actions.py::test_the_line_covers_every_measured_pool`.

## What the constants come out as

| pool | fee | deposit / withdraw | swap |
| --- | --- | --- | --- |
| Strategic USD Reserves | 0.001% | 0.006% | 0.0002% |
| PayPool | 0.010% | 0.015% | 0.002% |
| 3pool | 0.015% | 0.02% | 0.003% |
| TricryptoUSDC | 0.030% | 0.035% | 0.006% |
| cvxCrv/Crv | 0.150% | 0.155% | 0.03% |
| YB tBTC | 1.000% | 1.01% | 0.2% |

The figure shown in the box is rounded **up** to three significant digits:
a floor displayed tighter than the one calculated is a floor that reverts.

And it is a suggestion, not a policy — the moment the box is typed in it
belongs to whoever typed in it, and nothing overwrites it after that.
