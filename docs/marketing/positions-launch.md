# Suwappu Positions + Suwappu Membership — launch narrative

> **Status: code-complete, not deployed.** Neither contract is on Robinhood Chain
> (`suwappu_position_cards_contract` / `suwappu_membership_contract` are both
> `Optional[str] = None`, `bot/config/settings.py:1304-1323`). No `tokenURI` route
> exists for either collection. Nothing below presupposes a live mint.

## 1. Positioning

**Suwappu Positions** is a collectible that stamps a real, checkable entry price
on-chain at mint, then displays a live return against it. It is never a claim on
the underlying equity.

**Suwappu Membership** is the account's paid tier, made on-chain. One soulbound
token per wallet resolves Free, Pro, Premium or Enterprise when the bot reads
it. It is claimable and payable without the holder ever needing gas.

**How they relate.** Membership is infrastructure. It answers what this wallet
pays.

Positions is a status object. It answers what this wallet did, and when.

Both feed the same fee calculation. The tier rate is reduced by an active points
discount, then by the Positions discount. Both are proportional fractions and
they multiply, so no combination can reach a zero fee.

Neither perk applies on Enterprise, which is contracted pricing. The final rate
is floored at 2 bps. See `bot/services/fee_service.py:266-283`.

Two contracts, deliberately. A transferable collectible and a non-transferable
account attribute are different trust models and should not share one.

## 2. Mint page copy

**Pick a ticker. Your entry price is stamped on-chain forever.**

> Your entry price is stamped once, at mint, and never moves again.

Suwappu Positions renders a return against the price an oracle read the moment
you minted. It is a display, never a claim on the underlying equity.

| Fact | Value | Source |
|---|---|---|
| Supply | 4,444 position cards | `MAX_SUPPLY`, `contracts/SuwappuPositions.sol` |
| Priced tickers | 35 tokenized equities with a live Chainlink feed | `TICKER_COUNT` |
| Standard edition | 3,400 cards at $19 | `nft/position-cards/config.json` |
| Founders' Gold edition | 555 cards at $119, stamped on-chain per token | `nft/position-cards/config.json` |
| Secondary royalty | 2% (ERC-2981) | `contracts/SuwappuPositions.sol` |
| Chain | Robinhood Chain | n/a |

### Three reasons to mint

1. **Your entry is permanent.** There is no reveal and no random ticker. You
   choose the name, and the price stamps once, at mint.
2. **The discount is checkable.** Every holder gets a fixed cut off the Suwappu
   swap fee, not a decorative trait. The arithmetic is below.
3. **Scarcity is by name, not by luck.** Each ticker has its own cap. Popular
   names sell out first, so scarcity reflects who got there, not a random roll.

### The perk, with the arithmetic

Holding a Position lowers a wallet's swap fee by a fixed proportion. The
discount is per holder, not per card, so stacking cards does not stack it.

A standard card takes 40% off. A Founders' Gold card takes 55% off. When a
wallet holds both, the better card decides.

It scales the existing rate rather than subtracting a flat amount. That is why
it never collapses one paid tier into another, and why it never reaches zero.

| Tier | Base fee | Standard card | Founders' Gold |
|---|---|---|---|
| Free | 100 bps | 60 bps | 45 bps |
| Pro | 50 bps | 30 bps | 22.5 bps |
| Premium | 30 bps | 18 bps | 13.5 bps |
| Enterprise | 10 bps | 10 bps | 10 bps |

Enterprise is contracted pricing. A card bought on the secondary market does not
move a rate that was agreed in a contract, so the discount is not offered there
(`bot/services/fee_service.py:266`).

What a free-tier holder keeps, per $1,000 swapped:

| Edition | Saved per $1,000 | Mint price | Breakeven volume |
|---|---|---|---|
| Standard | $4.00 | $19 | $4,750 |
| Founders' Gold | $5.50 | $119 | $21,636 |

Breakeven is the mint price divided by the saving per $1,000, times 1,000. It
assumes the free tier. A paid tier saves fewer basis points per swap, so it
repays the mint over more volume.

### Why mint now

The reason to mint now is structural, not a countdown.

Your entry price is read once, at the transaction that mints your card, and
never moves again. In a rising market, waiting produces a worse entry,
permanently, by construction.

### What this does not do

A Position confers no shareholder or voting right and pays nothing to the
holder. It carries no economic exposure to the referenced equity or its issuer.
Grade tracks a displayed return. It never implies the card or its ticker will
appreciate.

The fee discount is a product perk, not a contractual entitlement. It is not
offered on Enterprise. If a Chainlink feed is stale, paused, or the sequencer is
down at mint, the card stamps no entry price and renders as `UNPRICED` rather
than inventing a basis.

## 3. Allowlist copy

**Founder and Allowlist access is earned from product use, not from a tweet.**

Founder is a free mint. Allowlist and Public are not.

| Phase | Cards | Wallet cap | Price | Earned by (any one) |
|---|---:|---:|---:|---|
| Founder | 444 | 1 | free | Gold, platinum, or diamond XP level |
| | | | | $50,000+ lifetime swap volume |
| | | | | 5+ verified referrals |
| Allowlist | 1,555 | 2 | $19 | 5+ swaps |
| | | | | $1,000+ lifetime volume |
| | | | | 1+ verified referral |
| Public | 1,845 | 5 | $19 | Open once earlier phases close |
| Founders' Gold | 555 | 2 | $119 | Open to anyone |

A team reserve of 45 cards is bounded on-chain by `RESERVE_MAX`. Allocations sum
to the 4,444 supply. A phase cannot oversell: a late mint reverts cleanly rather
than starting a gas war.

A locked phase is a snapshot, not a lockout. The bot reads the same thresholds
the mint enforces. `/cards` reports the number a wallet is short and by how much.

`allowlist_status()` (`bot/services/position_cards_service.py`) and `classify()`
(`nft/position-cards/build_allowlist.py`) use identical thresholds. Both count
verified referrals only. Copy must never say "invite N friends" because an
unverified invite does not count.

## 4. Membership copy

**Suwappu Membership is your tier, on-chain.**

Claiming it is free. One soulbound token per wallet, with no expiry and no gas
cost. It is not a subscription token. It is the subscription itself, read
directly by the bot to resolve what a wallet pays.

Paid tiers hold for 30 days per period, paid in USDG with one signature. There
is no approval transaction and no gas, because the payment carries the
authorization.

| Tier | Price per 30 days | Swap rate |
|---|---|---|
| Free | Free | 1.0% |
| Pro | $9.99 | 0.5% |
| Premium | $29.99 | 0.3% |
| Enterprise | $99.99 | 0.1% |

A membership that cost gas to claim would contradict the free tier. The rate
resolves the same way whether a wallet subscribed in Telegram or paid on-chain.

A Membership token transfers to nobody and cannot be resold. It is an account
attribute, not an asset.

## 5. Launch sequence

1. **Membership first.** No dependency on allowlist data, reuses the EIP-3009 /
   USDG rail x402 already settles on this chain, and is useful to every existing
   user on day one. The bot takes `max(db tier, on-chain tier)`, fail-open to the DB.
2. **Ship the `tokenURI` route.** Neither collection has one. No mint page can go
   live before this. A minted card with no metadata endpoint is a blank NFT.
3. **Re-verify the 35 Chainlink feeds; deploy the oracle and Positions together.**
   Deploying Positions without a live oracle stamps `entryPrice = 0` on every
   early mint.
4. **Snapshot the allowlist** (`build_allowlist.py --from-db`), then
   `configureFreePhase()` for Founder and `configurePhase()` for Allowlist and
   Public, each allocation bounded so no phase can oversell.
5. **Founder → Allowlist → Public.**
6. **`announceEnd`, then `closeMintingForever`** once the date passes — supply
   becomes provably final rather than merely promised.

## 6. What we deliberately do not claim

- **Never** "own a piece of", "shares of", "invest in", or "dividends". A Position
  is a collectible that displays a notional return against a price observed at
  mint. It is not equity, not a security, and not a derivative. It carries no
  shareholder or voting rights, pays nothing, and gives no economic exposure to
  the referenced ERC-20 or its issuer.
- **Never** imply the card or its ticker will appreciate. Grade tracks a *display*
  return; performance drives status, never a payout.
- **No fixed USD mint price on the page yet.** Phases are priced in USD cents and
  converted to wei at mint via the ETH/USD feed; no phase has been configured
  on-chain. Do not print a dollar price until it is set.
- **No countdown urgency.** The honest reason to mint now is structural.
- **No "guaranteed spot"** for any allowlist tier — allocation is bounded per
  phase precisely so a list can never outnumber its supply. Frame it as earned
  access to a phase.
- **No sequencer-downtime protection claim.** Chainlink publishes no L2
  sequencer-uptime feed for chain 4663; the check exists and self-activates when
  one does, but today it is skipped.
- **No claim the mint is live** until a real testnet mint confirms it.

## Every number, and where it comes from

Re-verified against source on 16 September 2026. The supply, phase, badge,
reserve and wallet-cap rows below were all stale from the pre-2026-08-26
numbering and have been corrected.

| Number | Meaning | Source |
|---|---|---|
| 4,444 | Positions supply | `contracts/SuwappuPositions.sol` `MAX_SUPPLY` |
| 35 | Priced tickers of ~96 tokenized equities | `TICKER_COUNT`; `nft/position-cards/README.md` |
| 40% | Proportional holder discount, standard card | `config.json` `hold_discount_fraction` |
| 55% | Proportional holder discount, Founders' Gold | `config.json` `gold_discount_fraction` |
| 60% | Hard ceiling any card discount can be tuned to | `MAX_HOLD_DISCOUNT_FRACTION_BPS`; `config.json` `max_discount_fraction` |
| 100 bps | FREE-tier swap fee | `bot/services/fee_service.py` |
| 0.1% | Floor on the points step only | `MIN_EFFECTIVE_FEE_RATE` |
| 2 bps | Absolute floor on the final charged rate | `ABSOLUTE_FLOOR` |
| none | Card and points discount on Enterprise | `bot/services/fee_service.py:266` |
| 444 / 1 / free | Founder allocation / wallet cap / price | `config.json` `mint.phases` |
| 1,555 / 2 / 1900c | Allowlist allocation / wallet cap / price | `config.json` `mint.phases` |
| 1,845 / 5 / 1900c | Public allocation / wallet cap / price | `config.json` `mint.phases` |
| 555 / 2 / 11900c | Founders' Gold allocation / wallet cap / price | `config.json` `mint.phases` |
| 20 | `MAX_PER_WALLET` hard backstop | `contracts/SuwappuPositions.sol` |
| 45 | Team reserve | `RESERVE_MAX` |
| 200 bps | Secondary royalty (ERC-2981) | `contracts/SuwappuPositions.sol` |
| gold/platinum/diamond, $50k, 5 verified referrals | Founder eligibility | `build_allowlist.py` `classify()` |
| 5 swaps, $1k, 1 verified referral | Allowlist eligibility | `build_allowlist.py` `classify()` |
| 222 / 888 | Founder / Early rank badges | `config.json` `early_mint_badge_ranks` |
| $9.99 / $29.99 / $99.99 | Pro / Premium / Enterprise per 30 days, USDG | `contracts/SuwappuMembership.sol` |
| 1.0 / 0.5 / 0.3 / 0.1% | Tier swap rates | `bot/services/fee_service.py` |

## Voice reference

The live hero copy, quoted from `showcase/messages/en.json`:

- "The full-stack trading platform for cross-chain markets."
- "Send a trade intent. Suwappu ranks every venue, shows the route, and executes only when you approve. Execution, research, and portfolio tracking live in one venue."

Sentence-level rules for this document are in [`docs/WRITING.md`](../WRITING.md).

## Market grounding

- Utility outlasted speculation through the 2022 drawdown; collections with no
  functional utility had nothing holding value once speculative demand left.
  ([CryptoSlate](https://cryptoslate.com/market-reports/the-rise-and-fall-of-nfts/))
- Retweet/Discord allowlist farming produced mercenary, low-conviction holders;
  stronger projects moved to sustained-engagement requirements. Supports gating on
  real product usage. ([Fortune](https://fortune.com/2022/02/28/what-are-nft-whitelists-and-how-to-get-on-one/))
- Current practice distinguishes transferable membership NFTs from soulbound ones.
  It recommends non-transferable where access is personal or compliance-sensitive.
  That is why Membership is soulbound.
  ([CoinGecko](https://www.coingecko.com/learn/soulbound-tokens-sbt))
- **Unverified:** no rigorous study quantifying earned vs social allowlists was
  found. Directionally supported, not proven.
