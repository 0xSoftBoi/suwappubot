# Renewals and upgrades

## The finding that forces the question

The card is a **one-time payment that permanently substitutes for a recurring
one**, and the substitution is exact:

```
PRO 50bps × 0.60 (card) = 30bps = PREMIUM base
```

A $40 card gives a PRO subscriber ($9.99/mo) precisely what a PREMIUM
subscription ($29.99/mo) gives them. That step is **$20/mo recurring**. User
payback is **2.0 months**; over a year the card earns $40 against the $240 it
displaces — **−$200 per converted user**, and worse every year after.

This is not the ladder inversion I tested for and fixed. The ordering is correct.
The *pricing across products* is wrong: a permanent perk is priced like a
consumable. Renewals and upgrades are the mechanism that fixes it, which is why
this is the right question to be asking.

Note the shape is fine at the bottom: FREE+card is 60bps, still worse than PRO's
50, so the card does not kill the first upgrade. It kills the second one.

## What must not be done

Three anti-patterns, listed first because they are the tempting answers:

1. **Expiring utility.** "Your card stops working in 12 months, pay to keep it."
   This is the most-resented mechanic in the category. It also breaks a promise
   already written into permanent token metadata.
2. **Retroactive nerfs.** Reducing what an existing card does. Same problem,
   worse trust cost, and our metadata is immutable.
3. **Renewal as an invoice.** Any mechanic whose message is "pay again or lose
   what you bought."

The governing principle: **never expire the floor, gate the ceiling.** What was
sold stays sold, permanently. Everything *above* it is earned continuously.

## Renewals: renew the behaviour, not the subscription

The card should not renew. The **standing** it confers should — and it should
renew through activity, not payment.

### Trailing-window scoring
The score from `nft-utility-research.md` is computed over a **trailing window**,
not all history. A holder who stops trading sees their tier decay toward the
baseline the card permanently guarantees — never below it.

- Nothing is taken away: the card's floor is untouched.
- The ceiling requires being an active trader, which is the behaviour that
  actually pays us.
- It renews automatically for anyone using the product. The only people who
  "lose" anything are those generating no fee revenue.

This is the whole answer to renewals. It converts a billing problem into an
engagement mechanic, and it is legally boring — no expiry, no repurchase.

### Issuance as the recurring line
The second recurring revenue stream is **new cards**, minted as a trader takes
new positions. Which surfaces a strategic fork we have not decided:

**Is this a 10,000-piece art collection, or a position primitive?**

They are different products and the config currently says the first. A capped
10k supply makes issuance revenue one-time by construction: 10,000 × $40 = $400k
and then never again. A position primitive — one card per position taken — is
uncapped, recurring, and worth far more, but it is not a collectible and the
scarcity story disappears.

The honest resolution is probably **both, separated**: a capped, numbered Genesis
collection that carries the permanent floor and the collectible value, and
uncapped position cards minted freely thereafter that carry only the record. The
10k Genesis mint becomes the launch event; issuance becomes the annuity.

That decision belongs upstream of everything in this file.

## Upgrades: the paid actions that map to real trading

Upgrades are where recurring revenue can legitimately come from, because the user
chooses them and receives something.

### 1. Seal — free
Freeze a card's return into the permanent record (from the utility doc). Free on
purpose: it is the decision that makes the product a game, and taxing it would
suppress the behaviour that generates the leaderboard we want.

### 2. Reroll — paid, and the best of these
Burn an underwater card, pay a fee, mint a fresh entry at today's price.

This is **cutting a loss and re-entering**, which is a thing traders genuinely
want to do and currently cannot. It is revenue, it is a supply sink, and it never
reads as rent because the user initiates it and gets a new position. Priced right
it is the single highest-volume paid action here — losing positions are always
the majority of any book.

The record must retain the sealed loss. Rerolling clears the *card*, not the
history; otherwise it becomes a paid memory-hole and the leaderboard is worthless.

### 3. Merge — paid
Burn two cards on the same ticker into one with a blended entry, or two graded
cards into a higher tier. Deflationary, and it maps to averaging in.

### 4. Grade promotion — free, already half-built
`config.json` already defines Underwater / Flat / In Profit / Runner / Multiple /
Moonshot with accent colours, and the renderer already re-renders against live
price. **That ladder is currently cosmetic.** Making it carry weight in the score
turns the existing art system into a progression system for free — the
"upgrade" happens because the market moved and the holder was right.

This is the cheapest upgrade to ship and the most on-brand: the card upgrades
itself when the call works.

## Sequencing

1. **Reprice the card against the subscription step.** It currently costs $40 for
   $240/yr of displaced revenue. Either the card's tier effect shrinks, or the
   card is priced as a multi-year purchase, or the perk is capped in scope. This
   is a pricing decision and it is the most valuable item in this document.
2. **Decide the Genesis-vs-primitive fork.** Determines whether issuance is a
   one-off or an annuity, and it must be settled before supply is locked on-chain.
3. **Trailing-window scoring** — renewals, solved, no billing.
4. **Reroll** — the first paid upgrade worth building.
5. **Grade promotion into the score** — nearly free, uses what exists.

## Legal note

Everything above is consumption: the user pays for a service or an action and
receives it. No renewal creates an expectation of profit from our efforts, and
none of it distributes revenue. That constraint is unchanged and it rules out the
obvious alternative of "stake your card for a share of fees."
