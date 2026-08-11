# Suwappu Positions — 10,000 live position cards on Robinhood Chain

**Pick a ticker. Your entry price is stamped on-chain forever. The card shows your
live P&L.**

## Why the previous design didn't work

This replaces "Suwappu Fills", which nobody would have minted:

| Problem | Fix |
|---|---|
| −5 bps is a **$0.50 coupon** per $1k swapped; you'd need ~$60k of volume to recoup a mint | Flat **−40 bps** for any holder — **$4.00 per $1k**, recouped in ~$4k of volume |
| The ticker — the only emotional hook — was **randomly assigned** | **You choose your ticker.** No lottery, no "I got XNDU" |
| Rarity was a **trait roll** | Status is **earned**: grade follows your actual return, rank follows how early you minted |
| The art was a **fake random-walk chart** of a trade that never happened, frozen forever | The card draws **only real numbers** — your stamped entry vs the live oracle price |
| No reason to mint **now** rather than later | Your entry basis is stamped at mint and **never changes**. In a rising market, waiting costs you permanently |

## The price oracle — resolved, not stubbed

Robinhood Chain publishes **official Chainlink price feeds** for its Stock Tokens
([docs](https://docs.robinhood.com/chain/oracles-and-price-feeds/)). `contracts/RobinhoodChainlinkOracle.sol`
reads them. What the research established, all verified live on chain 4663 on 2026-08-11:

| Finding | Consequence |
|---|---|
| **Only 35 of the ~96 tokenized equities have a feed** | The collection covers **only the 35 priced tickers**. A position on an unpriced ticker could never show a return |
| Standard `AggregatorV3Interface.latestRoundData()`, all **8 decimals**, heartbeat **86400s** | `decimals()` is still read per feed and normalised to 1e18, per Robinhood's guidance not to hardcode |
| The answer is **Total Return Value** — share price **×** corporate-action multiplier — already applied | The oracle must **not** scale by `uiMultiplier()` again. A card's return is a total-return figure, dividends included |
| Stock Tokens expose `oraclePaused()` and `uiMultiplier()` (NVDA returned `false` and `1e18`) | `oraclePaused()` is checked as an advisory signal; staleness stays the primary defence |
| Robinhood Chain is an **Arbitrum Orbit L2**; the docs require an L2 Sequencer Uptime check | **Chainlink publishes no sequencer uptime feed for 4663** (zero directory entries matching sequencer/uptime). The check is implemented and enforces itself the moment one is set; until then it is skipped, since a guessed address would zero every card |
| Equity feeds are quoted **`<TICKER>/USD`**, not USDG | Cards display USD. A `USDG/USD` feed exists (`0x61B7e5650328764B076A108EFF5fa7282a1B9aD2`) if a USDG-denominated variant is ever wanted |
| Feeds are **24/5** and go quiet over weekends | `maxAge` defaults to **3 days**, so cards don't blank every weekend |

> **This is a DISPLAY oracle. Do not use it to value collateral.** The generous
> `maxAge` is correct for a collectible's displayed P&L and wrong for anything that
> liquidates. `priceOf` never reverts — every failure returns `0`, which the card
> renders honestly as `UNPRICED`, because a reverting oracle would brick minting.

Feed addresses were taken from Chainlink's directory and then **each aggregator was
called on-chain**, cross-checking its own `description()` against the ticker — because
Robinhood's docs warn that a matching name/ticker does **not** identify a canonical
asset. Re-run that check any time:

```bash
python3 nft/position-cards/verify_feeds.py            # exit != 0 if any feed fails
python3 nft/position-cards/verify_feeds.py --refresh  # also re-pull Chainlink's list
```

## Why this can only exist on Robinhood Chain

Chain 4663 is the only place real-world equities trade as ordinary ERC-20s **with
official on-chain price feeds**. A card bound to a live equity price is not buildable on
a chain that has no equities on it. Everything else is drawn from what this repo already
verified on-chain:

| On the card | Comes from |
|---|---|
| Ticker, company, ERC-20 address, decimals | `bot/config/tokens.py::ROBINHOOD_EQUITIES` — Robinhood's canonical registry, spot-verified with `eth_getCode`/`symbol()`/`decimals()` |
| Entry + current price in **USDG** | Chain 4663 has **no USDC**; the anchor is Paxos USDG |
| Per-ticker supply caps | Scaled from real depth — `NVDA` 509, `SPCX` 23 |
| Live price | Official Chainlink feed per ticker, verified live (`feeds.json`) |

`render.py` and `build_deploy_args.py` both **parse the registry at build time**, so the
collection cannot drift from what is tradable. A test asserts the contract's ticker
index and the bot's `ticker_index()` resolve identically — if they ever diverged, every
card would silently point at the wrong company.

## Mechanics

- **10,000 cards, 35 priced tickers, per-ticker caps.** Popular names run out first;
  scarcity is first-come on the name you want.
- **Entry stamped at mint** from the Chainlink oracle. If a feed is stale, paused, or the
  sequencer is down, the card stamps `0` and renders honestly as `UNPRICED` rather than
  inventing a basis — the mint can't be bricked by an oracle outage.
- **Grades** track live return: Underwater → Flat → In Profit → Runner → Multiple → Moonshot.
- **Badges** for mint rank: `Founder` (first 500), `Early` (first 2,000).
- **Perk:** −40 bps on every Suwappu swap, flat **per holder, not per card**, so stacking
  cards can't compound it. Stacks with tier and points, floored at `MIN_EFFECTIVE_FEE_RATE`
  (0.1%). Plus +25% XP on swaps of a ticker you hold a position on.

> **Revenue tradeoff, flagged deliberately:** 40 bps is a real cut against a 100 bps FREE
> tier — that is the point, since a 5 bps token is not worth minting. It is a single
> constant (`economics.hold_discount_bps`, mirrored by `holdDiscountBps` on-chain and
> capped at `MAX_HOLD_DISCOUNT_BPS = 100`). **This is a pricing decision — tune or veto it.**

## Compliance

A card records an observed price and displays a notional return. It is **not equity, not
a security, not a derivative**, pays nothing, is redeemable for nothing, and gives no
economic exposure to any issuer. The only utility is a discount on Suwappu's own fee.
This is why performance drives **status and XP, never a payout** — a cash prize keyed to
tokenized-stock performance would look like a cash-settled derivative on a security.
The disclaimer is asserted by tests, printed on every card and carried in every metadata file.

## Files

| File | Purpose |
|------|---------|
| `config.json` | Per-ticker caps, sector map, grades, economics |
| `render.py` | Live card renderer + dynamic metadata builder |
| `build_deploy_args.py` | Constructor args in canonical registry order |
| `feeds.json` | The 35 verified Chainlink feeds — aggregator, decimals, heartbeat, on-chain `description()` |
| `verify_feeds.py` | Re-verifies every feed against the live chain; non-zero exit gates a deploy |
| `deploy_args.json` | Committed caps + ERC-20 + aggregator addresses (freshness asserted by tests) |
| `preview/` | Sample cards across the grade range |

## Run

```bash
python3 nft/position-cards/verify_feeds.py          # re-verify all 35 feeds on-chain
RUN_LIVE_CHAIN_TESTS=1 python3 -m pytest tests/test_position_cards.py
python3 nft/position-cards/render.py --gallery
python3 nft/position-cards/render.py --ticker NVDA --entry 92.40 --price 168.22 --rank 1
python3 nft/position-cards/build_deploy_args.py
python3 -m pytest tests/test_positions_collection.py
```

## Ship

1. Re-verify the feeds: `python3 nft/position-cards/verify_feeds.py`.
2. Deploy — the script deploys the oracle **and** Positions and wires them, because a
   Positions deploy without a live oracle permanently stamps `entryPrice = 0` on every
   early mint:
   ```bash
   export DEPLOYER_PRIVATE_KEY=0x... POSITIONS_RENDER_URI=https://suwappu.bot/positions/meta/
   forge script contracts/deploy/DeployPositions.s.sol \
     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast -vvvv
   ```
3. Sanity-check `oracle.debugPrice(<token>)` returns a non-zero `price1e18`, then
   `setMintPrice()` → `setMintOpen(true)`.
4. Set `SUWAPPU_POSITION_CARDS_CONTRACT` in the bot env to light up `/cards` and the fee
   discount. Unset disables the perk entirely.

**Note on testnet:** the verified feeds are mainnet (4663) addresses and do not exist on
46630, so a testnet run registers feeds that return nothing and every card reads
`UNPRICED`. That is expected, and it exercises the unpriced path.

**Sequencer uptime:** Chainlink publishes no L2 sequencer uptime feed for chain 4663 —
this was checked against the feed directory, not merely un-found. `setSequencerUptimeFeed`
wires one in the moment it exists, and the check then enforces itself with a 1h grace period.
