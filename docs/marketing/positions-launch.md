# Suwappu Positions + Suwappu Membership — launch narrative

> **Status: code-complete, not deployed.** Neither contract is on Robinhood Chain
> (`suwappu_position_cards_contract` / `suwappu_membership_contract` are both
> `Optional[str] = None`, `bot/config/settings.py:1304-1323`). No `tokenURI` route
> exists for either collection. Nothing below presupposes a live mint.

## 1. Positioning

**Suwappu Positions** — a collectible that stamps a real, checkable entry price
on-chain at mint, then displays a live, honest return against it. Never a claim on
the underlying equity.

**Suwappu Membership** — the account's paid tier, made on-chain: one soulbound
token per wallet that the bot reads to resolve Free/Pro/Premium/Enterprise,
claimable and payable without the holder ever needing gas.

**How they relate.** Membership is infrastructure — it answers *what does this
wallet pay*. Positions is a status object — it answers *what did this wallet do,
and when*. Both feed the same fee calculation: tier rate minus points discount
minus the flat Positions perk, floored at 0.1% (`bot/services/fee_service.py:44-49`).
Two contracts deliberately: a transferable collectible and a non-transferable
account attribute are different trust models and should not share one.

## 2. Mint page copy

**Pick a ticker. Your entry price is stamped on-chain forever.**

> Your entry price is stamped once, at mint, and never moves again.

Suwappu Positions renders a return against the price an oracle read the moment
you minted. It is a display, never a claim on the underlying equity.

| Fact | Value | Source |
|---|---|---|
| Supply | 10,000 position cards | `MAX_SUPPLY`, `contracts/SuwappuPositions.sol` |
| Priced tickers | 35 tokenized equities with a live Chainlink feed | `TICKER_COUNT` |
| Chain | Robinhood Chain | n/a |

### Three reasons to mint

1. **Your entry is permanent.** There is no reveal and no random ticker. You
   choose the name, and the price stamps once, at mint.
2. **The discount is checkable.** Every holder gets a fixed cut off the Suwappu
   swap fee, not a decorative trait. The arithmetic is below.
3. **Scarcity is by name, not by luck.** Each ticker has its own cap. Popular
   names sell out first, so scarcity reflects who got there, not a random roll.

### The perk, with the arithmetic

Holding a Position lowers a wallet's swap fee by a fixed proportion, per wallet.
Stacking cards does not stack the discount. It scales the existing rate instead
of subtracting a flat amount, so it never collapses one paid tier into another
and it never reaches zero.

| Tier | Base fee | Holder fee | Reduction |
|---|---|---|---|
| Free | 100 bps | 60 bps | 40% |
| Pro | 50 bps | 30 bps | 40% |
| Premium | 30 bps | 18 bps | 40% |
| Enterprise | 10 bps | 6 bps | 40% |

| Swap volume | Free-tier savings |
|---|---|
| $1,000 | $4.00 |
| $10,000 | $40.00 |

Breakeven volume is the mint price in dollars, divided by 4, times 1,000. That
volume in swaps repays the mint cost.

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

## 3. Allowlist copy

**Founder and Allowlist access is earned from product use, not from a tweet.**

Founder is a free mint. Allowlist and Public are not.

| Phase | Wallet cap | Earned by (any one) |
|---|---:|---|
| Founder | 3 | Gold, platinum, or diamond XP level |
| | | $50,000+ lifetime swap volume |
| | | 5+ verified referrals |
| Allowlist | 2 | 5+ swaps |
| | | $1,000+ lifetime volume |
| | | 1+ verified referral |
| Public | n/a | Open once earlier phases close |

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
   live before this — a minted card with no metadata endpoint is a blank NFT.
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
  mint — not equity, not a security, not a derivative, no shareholder or voting
  rights, pays nothing, no economic exposure to the referenced ERC-20 or its issuer.
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

| Number | Meaning | Source |
|---|---|---|
| 10,000 | Positions supply | `contracts/SuwappuPositions.sol` `MAX_SUPPLY` |
| 35 | Priced tickers of ~96 tokenized equities | `TICKER_COUNT`; `nft/position-cards/README.md` |
| 40% | Proportional holder discount | `config.json` `hold_discount_fraction` |
| 100 bps | FREE-tier swap fee | `bot/services/fee_service.py` |
| 0.1% | Floor after all discounts | `bot/services/fee_service.py` |
| 1,500 / 3 / free | Founder allocation / cap / price | `config.json` `mint.phases` |
| 4,000 / 2 / 2000c | Allowlist | `config.json` `mint.phases` |
| 4,300 / 5 / 4000c | Public | `config.json` `mint.phases` |
| 50 | `MAX_PER_WALLET` hard backstop | `contracts/SuwappuPositions.sol` |
| 200 | Team reserve | `RESERVE_MAX` |
| gold/platinum/diamond, $50k, 5 verified referrals | Founder eligibility | `build_allowlist.py` `classify()` |
| 5 swaps, $1k, 1 verified referral | Allowlist eligibility | `build_allowlist.py` `classify()` |
| 500 / 2,000 | Founder / Early rank badges | `config.json` |
| $9.99 / $29.99 / $99.99 | Pro / Premium / Enterprise per 30 days, USDG | `contracts/SuwappuMembership.sol` |
| 1.0 / 0.5 / 0.3 / 0.1% | Tier swap rates | `bot/services/fee_service.py` |

## Voice reference

- "The execution layer between intent and markets." — `showcase/src/app/page.tsx`
- "Suwappu turns a trade intent into an inspectable route and controlled
  execution across supported markets." — `showcase/messages/en.json`

## Market grounding

- Utility outlasted speculation through the 2022 drawdown; collections with no
  functional utility had nothing holding value once speculative demand left.
  ([CryptoSlate](https://cryptoslate.com/market-reports/the-rise-and-fall-of-nfts/))
- Retweet/Discord allowlist farming produced mercenary, low-conviction holders;
  stronger projects moved to sustained-engagement requirements. Supports gating on
  real product usage. ([Fortune](https://fortune.com/2022/02/28/what-are-nft-whitelists-and-how-to-get-on-one/))
- Current practice distinguishes transferable membership NFTs from soulbound ones,
  recommending non-transferable where access is personal or compliance-sensitive —
  which is why Membership is soulbound.
  ([CoinGecko](https://www.coingecko.com/learn/soulbound-tokens-sbt))
- **Unverified:** no rigorous study quantifying earned vs social allowlists was
  found. Directionally supported, not proven.
