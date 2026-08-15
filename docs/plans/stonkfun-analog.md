# StonkFun, and whether we can do it on Robinhood Chain

## What StonkFun actually is

A pump.fun-style permissionless launchpad on Solana, with one change that is the
whole product: **the quote asset is a tokenized stock**, not SOL or USDC.

- Create a fixed-supply token with a one-sided Raydium market quoted against a
  tokenized equity (SPYX, NVDAX), commodity, or currency.
- LP is permanently locked via Burn & Earn.
- **85% of trading fees in a category are paid to holders denominated in the
  stock counterpart.** Your fee income arrives as NVDAX, not as a stablecoin.
- A flywheel routes a share of v3 pool fees into buying back and burning the top
  15 tokens by market cap, weighted, every few minutes. Tokens that drop out keep
  their history and resume on re-entry.
- $STONK, 1B supply on Solana. Reported >$500k revenue, $301,971 of buyback/burn.

The insight worth stealing: **the quote asset is the product.** Pairing against
an equity means the "cash leg" of every trade appreciates, and fee income is paid
in something people want to hold. A pump.fun clone with a USDC quote leg is a
casino; the same clone with an NVDAX quote leg is a casino where the chips are
index funds.

## Can we do it on Robinhood Chain? Verified today, not assumed

Checked the live AAPL stock token `0xaF3D…93f9` (BeaconProxy) and its
implementation `0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2` (`Stock`):

- **Transfers are ungated.** `ERC20ScaledUIUpgradeable._update` is
  `super._update(from, to, value)` plus a `TransferWithScaledUI` event. No
  allowlist, no blocklist, no KYC hook, no per-address restriction. This was the
  make-or-break question and the answer is yes.
- Roles are `MINTER`, `BURNER`, `ADMIN_BURNER`, `METADATA_UPDATER`,
  `MULTIPLIER_UPDATER`, `ORACLE_PAUSER`, `TOKEN_PAUSER`. Note what is absent:
  nothing about transfer permissioning.
- `ERC20PermitUpgradeable` is inherited — EIP-2612 gasless approvals, so a
  one-tap pool entry is possible.
- 35 tickers already have live Chainlink feeds (verified earlier this project).

So the substrate permits it.

## The two risks that are real, and one of them is our moat

**1. `TOKEN_PAUSER_ROLE` is a global kill switch.** Robinhood can pause a stock
token. Every pool quoted against it freezes with it. StonkFun carries the same
risk with xStocks, so this is table stakes rather than disqualifying — but the
design has to assume it: a paused quote asset must not brick the pool, and
holders must retain an exit on the non-stock leg. Design for the pause, don't
discover it.

**2. Corporate actions break naive AMMs — and we have already solved this.**
A 10-for-1 split changes `uiMultiplier()` while raw `balanceOf` stays fixed. An
AMM quoted against a stock token that is not multiplier-aware will misprice
across every split and dividend, and arbitrageurs will take the difference out of
LPs. StonkFun on Solana has this exposure with xStocks wrappers.

We already own the fix: `RobinhoodChainlinkOracle.multiplierOf()` and the
`adjustedEntry()` / `corporateAction()` machinery in `SuwappuPositions`, plus a
Chainlink feed integration that already knows the feed answer is Total Return
Value. **A split-aware AMM on the only chain with natively licensed equities is a
genuinely defensible position**, and it is the part of this that is hardest to
copy.

## Open question that decides feasibility

**Is there a permissionless AMM on Robinhood Chain?** StonkFun leans on Raydium.
We have `lifi_diamond` configured for routing but no AMM with open pool creation
identified in the repo. If none exists we would be deploying the venue as well as
the launchpad — a much larger build, though also a much larger moat.

This is the next thing to check and I have not checked it.

## The non-technical risk, which is the biggest one

Robinhood Chain has no degen population. StonkFun works because Solana already
had pump.fun culture to borrow. Shipping the same mechanic onto an empty chain
gets an empty launchpad. Any version of this needs an answer to "where does the
first cohort come from" that is not "we built it."

Worth noting this cuts the other way too: it is the same gap identified in
`robinhood-user-journey.md`. Right now Robinhood traffic arriving on our surfaces
has nothing to *do*. A launchpad is a reason to be on the chain, and the Position
card stops being a discount on a product they do not use and becomes a fee perk
on a venue they are already trading.

## Recommendation

Do not build the launchpad yet. Do two cheap things first:

1. **Find out whether a permissionless AMM exists on RH Chain.** One afternoon.
   It determines whether this is a launchpad build or a DEX build, which is a
   10x difference in scope.
2. **Prototype the split-aware pool math** against the oracle we already have,
   and prove the mispricing an unaware pool suffers across a real split. That
   artefact is both the technical de-risk and the marketing story, and it reuses
   code that is already written and tested.

If both land, the pitch is: *the only launchpad where the quote asset is a
natively licensed equity, on the only chain where corporate actions are handled
correctly.* That is a real sentence, not a positioning exercise.
