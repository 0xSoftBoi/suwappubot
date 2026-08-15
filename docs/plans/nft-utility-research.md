# Past token gating: the card as a position, not a key

Previous version of this doc proposed tiers, access and creator perks. That is
token gating with extra steps — hold the thing, unlock the thing. It is binary,
it is flippable, every competitor ships it in a week, and it uses none of what
makes this collection unusual.

Restating what we actually built, because the design follows from it:

**A Position card is not a membership badge. It is a permanent, corporate-action-
adjusted record of a trade someone actually made, on the only chain where that
record can be trusted.** It has an entry price, a live oracle price, a return, and
a grade that moves with the market. That is a live financial object. We have been
designing it as a coupon.

## Why token gating is the wrong shape

| gating property | consequence |
|---|---|
| binary (hold / don't) | no depth — a whale and a first-timer get the identical perk |
| transferable in full | buyable, therefore mercenary; price decays as supply saturates |
| static | nothing accrues; day 1,000 identical to day 1 |
| private | the perk is invisible to everyone else, so it generates no pull |
| no sink | supply only ever grows against fixed demand |

Every one of those is fixable with what is already on-chain.

## The design: three layers, none of them "hold to unlock"

### Layer 1 — PROOF: the card is an unfakeable call

The card stamps entry price *and* the `uiMultiplier` live at that moment.
`adjustedEntry()` already reconstructs a split-adjusted entry. So for any card we
can compute a **verified return** that no screenshot can fake and no split can
distort.

This matters more than it sounds. A competitor stamping raw entry price shows a
10-for-1 split as a 900% gain. Ours is adjusted. **After the first corporate
action, we are the only leaderboard on the internet that is not lying** — and
that is a moat made of code we have already written and tested.

### Layer 2 — PRICE: fee tier is a function of proven skill, not holdings

This is the actual break from token gating.

Your fee tier is not "do you hold a card." It is a function of **the
corporate-action-adjusted performance of every card you have ever minted.** You
cannot buy the top tier. You have to have been right.

It stays consumption utility — a discount on a service, no expectation of profit
from the efforts of others — so it does not drift toward an investment contract.
And the industry is already moving here: the exchangeable layer of a token pricing
a service by the **proficiency of the holder** is the direction dynamic-NFT and
on-chain reputation design has been converging on.

Properties this buys that gating cannot:
- **Continuous, not binary.** A score, not a flag.
- **Compounding.** Every mint adds to a record that cannot be reset by selling.
- **Unbuyable.** Capital gets you a card; it does not get you a tier.

### Layer 3 — PRODUCTION: cards are consumed, not merely held

If the launchpad happens, a card is the **raw material**, not the ticket:
to open a pair quoted against NVDAX you burn a card that references NVDA.

That converts the card from a permanent key into a consumable input with a real
sink — the pivot the sustainable end of the market has already made, toward
"utility-backed sinks: upgrades, burn-for-experience, reconfiguration" instead of
passes that only ever accumulate. Demand becomes a function of launch activity
rather than of how many people want in.

## The mechanism problem this creates, and the fix

**If the track record is transferable, it is buyable, and we are straight back to
token gating.** Buy the wallet with the good record, inherit the tier.

Fix — separate the two objects:

- **The card is transferable.** It is art, it has a floor, it has a secondary
  market. Baseline fee tier travels with it.
- **The record is soulbound to the minter.** Sell the card and you keep the art's
  buyer happy but forfeit the history. Reputation is non-transferable by
  construction, which is the entire reason SBT-style records are worth anything.

That tension is a feature: **selling becomes a decision with a cost**, not a
default. It produces holding pressure without paying anyone a share of revenue.

### Closing a position — the decision that makes it a game

Let a holder **seal** a card: freeze its return permanently into their record and
retire it from live scoring.

That is a genuine game-theoretic choice, and it is the mechanic I would build
first. Hold and your score rides the market — it can still improve, it can also
give everything back. Seal and you bank it forever at today's number. Every
holder faces the same decision every trader faces, and the chain adjudicates it.
No other membership NFT has a decision in it at all.

## Adversarial analysis (the part that decides whether this works)

| attack | mitigation |
|---|---|
| **Cherry-picking** — mint 30 cards, surface only the winners | Score over the **whole portfolio**, count-normalised. A losing card cannot be hidden; it can only be sealed at a loss. |
| **Spam minting** for lottery tickets | `MAX_PER_WALLET` and mint cost already bound this; per-ticker caps already exist in config. |
| **Sybil across wallets** | Same as cherry-picking, one layer out. Cost per wallet is the mint price; score is normalised, so 10 wallets of 1 card each beat nothing. |
| **Oracle manipulation at mint** — stamp a fake-low entry | The real exposure. `UnpricedAtMint` already refuses a mint with no price; this needs a deviation bound or short TWAP at stamp time before any of the above is safe. **Open item, and it gates Layer 2.** |
| **Buying a good record** | Structurally impossible — the record is soulbound; only the card moves. |
| **Minting at a local bottom** | Not an attack. That is the skill. |

## What this unlocks that gating never could

A public leaderboard of **verified, split-adjusted calls** is a product, not a
perk. Crypto's most abundant commodity is the unfalsifiable claim to have called
something. We can settle it on-chain, for licensed equities, adjusted for
corporate actions.

Non-holders can read it. That is the acquisition funnel the journey analysis said
was missing — content that markets itself, with a mint button attached to every
row, aimed at exactly the Robinhood-app audience who already care about these 35
tickers and have no reason to care about a swap-fee discount.

## Sequencing

1. **Deviation bound / TWAP at mint.** Nothing above is safe until entry price
   cannot be manipulated. Blocks Layer 2.
2. **Score service** — portfolio-wide, count-normalised, split-adjusted, soulbound
   to the minter. Read-only, no contract changes.
3. **Public leaderboard + card page.** The credential surface and the funnel. No
   launchpad required.
4. **Seal.** One contract function, and the mechanic that makes it a game.
5. **Fee tier from score.** Replaces the flat card discount entirely — one
   ladder, one resolver, and the stacking-bug class we spent today fixing stops
   being possible by construction.
6. **Burn-to-launch**, if the AMM question in `stonkfun-analog.md` lands well.

## Still not doing

Revenue share, fee distribution to holders, or anything denominated as yield.
Reasoning unchanged and it is the strongest constraint on this whole design: we
would be distributing income from **licensed equities**, against a product whose
compliance rests on "NOT equity, NOT a security, no claim on any issuer." Every
mechanic above is deliberately consumption-side or reputational for that reason.
