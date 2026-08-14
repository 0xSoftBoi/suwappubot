# Giving the Position card real utility

Research question: how to make the card worth holding, for someone who is not
already a Suwappu user. Today its only utility is a discount on Suwappu swap
fees — a product cold Robinhood traffic has never used. The utility has to be
reachable on day one or it is not utility, it is a coupon for a shop they have
not visited.

## The finding that should drive the design

There is a hard line running through every model below, and it is legal, not
product:

| | mechanism | exposure |
|---|---|---|
| **Consumption** | pay less for a service you use | low |
| **Investment** | receive a share of what the platform earns | high |

A fee discount is consumption. You buy a thing more cheaply. There is no
expectation of profit derived from the efforts of others, so the fourth Howey
prong is simply absent.

A revenue share is an investment contract in all but name. The SEC's practical
posture has collapsed toward finding an investment contract wherever there is
(1) an investment of money and (2) profits that depend on a promoter's efforts,
and NFTs specifically structured to distribute profits are the most exposed
shape there is.

**This is why we should not copy StonkFun's headline mechanic.** Paying holders
85% of category trading fees is the single most attractive thing on their page
and the single worst thing for us to imitate. They are distributing fees on
Solana meme pairs. We would be distributing fees on **licensed equities**, from a
product whose entire compliance posture rests on the sentence "this is NOT equity,
NOT a security, and confers no claim on any issuer." A revenue share aimed at
holders undercuts that in a way no disclaimer repairs — and the disclaimer is
load-bearing, it is in the contract, the metadata, and the card art.

Take their structure. Do not take their distribution.

## What to give instead

Four utilities that are all consumption-side, and all reachable before the holder
has any Suwappu history.

### 1. The card sets a fee TIER, not a fee discount
Hyperliquid's model is instructive: tiers derive from both staking and 30-day
volume, and maker rebates settle in USDC as usable margin rather than as points.
Two properties worth copying:

- **Tier is reachable two ways.** Volume alone gets you there; the card
  accelerates it. A cold user gets value on trade one, and the card is a
  shortcut rather than a gate. Our current design is a gate.
- **The benefit is denominated in something spendable**, not in a promise.

Concretely: the card should map to a tier in the same table subscriptions map to,
not apply a separate multiplier bolted onto the side. That also removes the class
of bug we spent today fixing — one ladder, one resolver, no stacking of
independently-calibrated perks.

### 2. Creator-side utility, which works on day one
The pump.fun fee redesign ties creator fees to market cap — 0.3% for small
tokens down to 0.05% above ~98k SOL — explicitly rewarding staying power over
pump-and-dump.

If we build the launchpad, the card's most valuable perk is not a trading
discount at all: it is **a better creator split or reduced launch cost**. That is
utility for someone who has never swapped once, which is precisely the audience
we cannot currently serve. It is also consumption, not profit-sharing.

### 3. Priority access, not profit
Early access to new launches, first claim on a phase, higher wallet caps. Access
is the most legally boring utility that people actually value, and it is what
membership NFTs have converged on — roughly 80% of NFT volume is now attached to
memberships, yield rights, or tokenized access rather than pure speculation.

### 4. The card as a portable credential — the genuinely novel one
Every other item on this list is copyable by any competitor in a week. This one
is not, and it is already built.

The card stamps **an entry price on-chain, permanently, with the corporate-action
multiplier that was live at that moment**. That is a verifiable, tamper-proof
track record of a call someone actually made — not a screenshot, not a claim.
Nobody else can issue that, because nobody else is on a chain with natively
licensed equities and a working `uiMultiplier()` path, and we have already
written and tested the adjustment machinery.

Reputation is a utility. "I minted NVDA at $118 and the chain says so" is worth
more to a trader's identity than four basis points, and it costs us nothing per
holder. It is also the only utility here that appreciates with the holder's own
skill rather than with our revenue — which keeps it firmly outside investment-
contract territory while being the most emotionally valuable thing we can offer.

## The hybrid, stated plainly

**The card is a tier key, not a coupon.** One card, recognised across every
surface: cheaper swaps in the bot, a better creator split on the launchpad,
priority in launch phases, and a permanent on-chain record of the position it
was minted against.

What makes people hold rather than flip is that the tier persists only while they
hold it, and that the credential is theirs specifically. Neither requires paying
anyone a share of revenue.

## What I would not do

- **No revenue share, no fee distribution to holders, no "yield".** Covered above.
- **No points-for-airdrop scheme.** It buys mercenary volume that leaves the day
  the airdrop lands, and it implies a future token, which drags the whole
  structure back toward the investment side of the table.
- **No utility that only exists after they are already a customer.** That is the
  present design and it is the thing being fixed.

## Sequencing

1. Collapse the card into the tier table (removes the stacking-bug class, and is
   a prerequisite for everything else).
2. Ship the credential surface — a public page rendering a card and its
   on-chain entry price. Cheap, needs no launchpad, and is the differentiated
   story.
3. Creator-side perks land with the launchpad, if the AMM question in
   `stonkfun-analog.md` comes back favourably.
