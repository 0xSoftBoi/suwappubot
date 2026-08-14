# Suwappu Positions — 10,000 live position cards on Robinhood Chain

**Pick a ticker. Your entry price is stamped on-chain forever. The card shows your
live P&L.**

## Why the previous design didn't work

This replaces "Suwappu Fills", which nobody would have minted:

| Problem | Fix |
|---|---|
| −5 bps is a **$0.50 coupon** per $1k swapped; you'd need ~$60k of volume to recoup a mint | **40% off your swap fee** for any holder — on the free tier that is **$4.00 per $1k**, recouped in ~$4k of volume, and it scales with whatever tier you are on |
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

## Mint: phased, earned allowlist

Applying what the 2021–23 drops got right — and what they got wrong.

| Phase | Who | Alloc | Cap | Price |
|---|---|---:|---:|---:|
| **Founder** | Earned: gold+ XP level, ≥$50k lifetime volume, or ≥5 referrals | 1,500 | 3 | free |
| **Allowlist** | Earned: ≥5 swaps, ≥$1k volume, or ≥1 referral | 4,000 | 2 | 0.004 ETH |
| **Public** | Anyone | 4,300 | 5 | 0.008 ETH |
| _Team reserve_ | Bounded on-chain by `RESERVE_MAX` | 200 | — | — |

**The spot is earned, not farmed.** Every threshold reads signals the bot already
tracks — XP level, lifetime volume, swap count, referrals. No retweet-for-allowlist,
which reliably produced mercenary holders who dumped on day one.

**Lessons applied:**

- **The leaf is rebuilt from `msg.sender` inside the contract**, never taken from
  calldata — so a proof issued to one wallet is useless to any other. This is the single
  most important allowlist rule, and it's pinned by a test.
- **`maxQty` is bound into the leaf**, so a tiered allowlist needs one root, not several,
  and an inflated grant fails verification.
- **A phase cannot oversell its allocation.** An allowlist larger than the supply behind
  it is a race dressed as a guarantee — the classic gas-war setup. `build_allowlist.py`
  *refuses to emit* such a list unless `--oversubscribe` is passed explicitly.
- **No `tx.origin` bot gate.** It stops no determined bot and it breaks Safe and every
  account-abstraction wallet — a well-documented way to lock real users out. Access is
  controlled by the allowlist and per-wallet caps instead. A test asserts `tx.origin`
  never appears.
- **The team reserve is bounded at 200 on-chain.** An unbounded owner mint is a rug vector.
- **Leaves are double-hashed** (`keccak256(keccak256(abi.encode(...)))`), matching
  OpenZeppelin's merkle-tree library, so an internal node can't be passed off as a leaf.
- **No rarity sniping to defend against.** Because you choose your ticker, there's no
  reveal and no trait lottery — the entire class of snipe-the-reveal exploits doesn't apply.

```bash
python3 nft/position-cards/build_allowlist.py --from-db      # snapshot the live bot
python3 nft/position-cards/build_allowlist.py --input snap.json
```

Emits a Merkle root per phase (for `configurePhase()`) plus a proof per address for the
mint UI, and self-verifies every proof before writing. `/cards` tells a user which phase
they've earned and, if they haven't, exactly what's missing.

## Mechanics

- **10,000 cards, 35 priced tickers, per-ticker caps.** Popular names run out first;
  scarcity is first-come on the name you want.
- **Entry stamped at mint** from the Chainlink oracle. If a feed is stale, paused, or the
  sequencer is down, the card stamps `0` and renders honestly as `UNPRICED` rather than
  inventing a basis — the mint can't be bricked by an oracle outage.
- **Grades** track live return: Underwater → Flat → In Profit → Runner → Multiple → Moonshot.
- **Badges** for mint rank: `Founder` (first 500), `Early` (first 2,000).
- **Perk:** −40% off your swap fee, whatever tier you're on, flat **per holder, not per
  card**, so stacking cards can't compound it. Proportional, not a flat number of bps —
  on FREE (100 bps) that's 60 bps ($4 back per $1,000, unchanged from the original flat
  design); on PRO (50 bps) it's 30 bps; PREMIUM (30 bps) is 18 bps; ENTERPRISE (10 bps) is
  6 bps. The ladder is preserved because the discount multiplies, not subtracts. Plus +25%
  XP on swaps of a ticker you hold a position on.

> **Revenue tradeoff, flagged deliberately:** 40% is a real cut — that is the point, since
> a 5% token is not worth minting. It is a single constant
> (`economics.hold_discount_fraction`, mirrored on-chain as `holdDiscountFractionBps` and
> capped at `MAX_HOLD_DISCOUNT_FRACTION_BPS = 6000` / `MAX_CARD_DISCOUNT_FRACTION = 0.60` on
> the bot side). **This is a pricing decision — tune or veto it.**

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

## Mint mechanics, benchmarked against a collection that sold out

Studied [spritehood.io](https://spritehood.io) by pulling its bundle and reading the
deployed ABI (97 functions) rather than guessing from the marketing. What it does that
this collection did not, and what has now been closed:

| Spritehood does | We did | Now |
|---|---|---|
| Prices in **USD cents**, converts via Chainlink at purchase, sanity-banded, with a bounded wei fallback (`quote`, `StalePrice`, `FeedAnswerOutOfBand`, `MAX_FALLBACK_WEI`) | Fixed **wei** price — a 20% ETH move silently repriced a "$20 card" to $24 | `quote(phase, qty)`, USD-cent phase prices, live ETH/USD from `0x78F3…8d3A9` (verified live, $1,883.47), $100–$100k band, 3h staleness, bounded fallback |
| **Refunds** overpayment | Required an exact wei amount | Refunds the remainder — an exact-amount rule reverts most mints on a price tick between quote and mine |
| `announceEnd` + `closeMintingForever` — supply is **provably** final | Owner could mint the reserve forever | Both, and `closeMintingForever` stops the owner too |
| `Ownable2Step` | Plain `Ownable` — a typo'd transfer bricks the contract | `Ownable2Step` |
| `setPaused` emergency stop | None once live | `setPaused` |
| ERC-2981 royalties | **None** — zero secondary revenue | `setDefaultRoyalty` + `royaltyInfo` |

### Not adopted, deliberately

- **Merkle groups as visual identity.** Their allowlist groups map to *skins*
  (`GROUP_LAZULI` → `SKIN_LAZULI`), so being on a list is a faction, not a queue
  position. That is the single best idea in their design and it does not port cleanly:
  our card's identity is the ticker the holder *chose*. Worth revisiting as an edition
  frame (Founder cards rendered distinctly), which is a renderer change, not a contract one.
- **Transfer validator** (Limit Break creator-token royalty enforcement). Real royalty
  revenue, but it hands a third-party contract veto over every transfer. Not a dependency
  to add to a contract holding a fee-discount entitlement without its own review.
- **ERC721A batch minting.** See the gas section — the real per-card lever, and a rewrite
  of ownership bookkeeping that needs its own review pass.

Their art is layered sprite slots (skin/eyes/hair/outfit/accessory/main_hand/off_hand/
two_hand) plus classes and generated names with founder-exclusive variants — a character
system, not a PFP. Ours is a live P&L card, which is a different (and chain-native) bet;
the lesson taken is the *depth* of trait composition, not the fantasy subject matter.

## The 10,000-card sweep

```bash
python3 nft/position-cards/sweep.py --plan   # print the graph
python3 nft/position-cards/sweep.py          # advance ONE shard (500 cards), then stop
python3 nft/position-cards/sweep.py --all    # run every remaining shard
python3 nft/position-cards/sweep.py --reset  # start over
```

One invocation advances one shard and exits, so it can be driven a shard at a
time and each run reports real progress. State lives in `.sweep/state.json`
(gitignored); killing a run mid-shard costs that shard, not the sweep.

`graph.py` is a small content-addressed DAG runner: nodes are cached by the hash
of `(version, params, dependency hashes)`, so editing one node re-runs that node
and everything downstream of it, and nothing else.

```
config
registry
allocation
  corpus  <- config, allocation
    inputs  <- config, registry, corpus
```

### This is not a pre-rendered art drop, and it must not become one

Token → ticker is chosen by the minter and the entry price is stamped on-chain
at mint, so card #4,213 cannot be known before someone mints it. Freezing an
image would freeze the P&L — the exact failure this collection was redesigned
away from (see the table at the top). Cards are composed at fetch time from real
state: your stamped entry, the live Chainlink price, your mint rank.

What *can* be settled before the mint is that the renderer is correct and total.
The sweep walks a deterministic corpus of all 10,000 tokens covering every
ticker, every grade boundary and the bp below it, both mint-badge cut-offs and
the unpriced path, then checks each card for:

| Check | Why it is in the list |
|---|---|
| SVG parses as XML, has a `viewBox` | One unescaped `&` renders the whole collection as a broken-image icon |
| Ticker / Company / Sector / Mint Rank traits match the token | A trait that disagrees with the card is a listing that sorts wrong forever |
| Grade follows `min_return_bps` exactly | Off-by-one lives on the boundary, and grade is the status |
| Badge follows the rank cut-offs | Dropping Founder devalues the mints sold on being early |
| `image` / `external_url` absolute | A relative URL resolves against the marketplace's domain and 404s |
| Byte-identical across two renders | Marketplaces cache the first fetch; drift splits the art in two |
| No two cards identical in a shard | Identical bytes mean the token id never reached the canvas |
| Disclaimer present, no equity language | A card reading as a claim on a real security is the one failure not fixable after the mint |

Current run: **10,000/10,000 rendered, 0 problems** — 35 tickers, 10 sectors,
all 6 grades plus Unpriced, 500 Founder / 1,500 Early, 10,000 distinct card
hashes. `tests/test_positions_sweep.py` injects each defect above and asserts the
sweep catches it, so the validators cannot quietly rot into decoration.
