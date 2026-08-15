# Reading Robinhood's chain docs properly

Read `docs.robinhood.com/chain/{stock-tokens, building-with-stock-tokens,
stock-token-apis}` in full and checked every claim against the live API. Four
findings, one of which was a live bug in our contract.

## 1. We were double-applying the multiplier — fixed

Robinhood's integration guide is explicit:

> "The Chainlink price already includes the corporate-action multiplier
> (dividends, splits), so the value you read is the token's full price —
> **don't apply the multiplier yourself.**"

`SuwappuPositions.adjustedEntry()` applied it anyway: `entryPrice × then / now`.
Both entry and current price come from that same multiplier-adjusted feed, so
both are TOKEN prices and are directly comparable. A corporate action does not
move them relative to each other — a 4:1 split takes shares-per-token to 4 while
the per-share price quarters, leaving the token price continuous.

`RobinhoodChainlinkOracle.sol:25` already said this in a comment — "already
multiplier-adjusted, so it must NOT be scaled by `uiMultiplier()` again" — and
the neighbouring contract did it anyway.

**Not theoretical.** Live `currentMultiplier` values today:

| ticker | multiplier | phantom return we would have shown |
|---|---|---|
| CRWD | 4.000000000000000000 | **+300%** (4:1 split) |
| SGOV | 1.002981519346766532 | +0.298% |
| ORCL | 1.002210914971013375 | +0.221% |
| AAPL | 1.000566080061092436 | +0.057% |
| ASML, MU, DELL | ~1.0001 | +0.01% |

**Six of this collection's own 35 tickers already carry a multiplier above 1e18**,
so the error was live from the first mint. CRWD shows the ceiling: a split makes
it a +300% fabrication on a position that has not moved.

Fixed: `adjustedEntry` → `entryBasis`, which returns the stamped entry unchanged
and documents why. Added `sharesPerToken()` — the correct use of the stamped
multiplier, a *quantity* change (4e18 = one token now backs 4× the shares), never
a price adjustment.

The tests were pinning the bug. `test_a_split_does_not_fabricate_a_catastrophic_loss`
re-quoted the mock feed to $10 after a 10:1 split, which models a raw share-price
feed Robinhood does not publish. Replaced with tests that model the real feed,
plus a new one for reinvested dividends — the case where the old code erased a
*genuine* gain rather than inventing a fake one.

## 2. Direction is confirmed, and it only goes one way

`underlying shares = raw token amount × uiMultiplier ÷ 1e18`, per **ERC-8056
(Scaled UI Amount Extension)** — a named standard, not a Robinhood quirk.

The multiplier therefore only ever **rises**, for both splits and reinvested
dividends. Confirmed empirically: CRWD at exactly 4.0 after a 4:1 split, AAPL and
ORCL creeping up from cash dividends. `/corporate-actions` shows these as
`CORPORATE_ACTION_TYPE_CASH_DIVIDEND` with a rate — AAPL 0.27, ORCL 0.50, INTU
1.20.

This closes the "direction unverified — do not deploy to mainnet" blocker that
has been open all project. The answer turned out to be that the adjustment should
not exist at all.

## 3. Three capabilities we are not using

- **`newUIMultiplier()` + `effectiveAt()`** — a *pending* multiplier with an
  effective timestamp. Corporate actions are visible **before** they land. That
  is a design opportunity (warn holders, show a countdown) and a mint-timing
  attack surface (mint immediately before a known multiplier change), and it
  belongs in the oracle-manipulation work already gating the fee-tier layer.
  `/assets` exposes the same thing as `pendingMultiplier`.
- **`balanceOfUI()` / `totalSupplyUI()`** — share-denominated views, so we never
  need to do that arithmetic ourselves.
- **`/corporate-actions` REST** — processed actions with multiplier context.
  A backfill source, and the way to prove `sharesPerToken` against real history.

## 4. The jurisdictional problem with the traffic thesis

The stock-tokens page carries a legal restriction: **the United States and
certain other countries are prohibited.** Mint/burn additionally requires KYB
onboarding, but only for Authorized Participants — ordinary holders are
unrestricted.

That is consistent with what I found on-chain (`_update` has no allowlist,
blocklist or KYC hook; stock tokens are "standard ERC-20s and can be transferred
and held in any wallet"), so the *technical* conclusion in `stonkfun-analog.md`
stands.

But it undercuts the traffic thesis in `robinhood-user-journey.md`. "Robinhood
app users" as a source means **Robinhood Europe** users, not the US retail base.
That is a materially different, much smaller audience, and it changes who the
mint page is written for, which languages matter, and whether US-targeted
marketing is appropriate at all.

Worth confirming with counsel before any campaign spend. It is the cheapest
possible thing to get wrong expensively.
