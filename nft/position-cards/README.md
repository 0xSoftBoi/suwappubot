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

## Why this can only exist on Robinhood Chain

Chain 4663 is the only place ~96 real-world equities trade as ordinary ERC-20s with an
on-chain DEX price. A card *bound to a live equity price* is not buildable on a chain
that has no equities on it. Everything else is drawn from what this repo already
verified on-chain:

| On the card | Comes from |
|---|---|
| Ticker, company, ERC-20 address, decimals | `bot/config/tokens.py::ROBINHOOD_EQUITIES` — Robinhood's canonical registry, spot-verified with `eth_getCode`/`symbol()`/`decimals()` |
| Entry + current price in **USDG** | Chain 4663 has **no USDC**; the anchor is Paxos USDG |
| Per-ticker supply caps | Scaled from real depth — `NVDA` 288, `SPCX` 13 |

`render.py` and `build_deploy_args.py` both **parse the registry at build time**, so the
collection cannot drift from what is tradable. A test asserts the contract's ticker
index and the bot's `ticker_index()` resolve identically — if they ever diverged, every
card would silently point at the wrong company.

## Mechanics

- **10,000 cards, 96 tickers, per-ticker caps.** Popular names run out first; scarcity
  is first-come on the name you want.
- **Entry stamped at mint** from an `IPositionOracle`. If the oracle is down the card
  stamps `0` and renders honestly as `UNPRICED` rather than inventing a basis — the mint
  can't be bricked by an oracle outage.
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
| `deploy_args.json` | Committed caps + ERC-20 addresses (freshness asserted by tests) |
| `preview/` | Sample cards across the grade range |

## Run

```bash
python3 nft/position-cards/render.py --gallery
python3 nft/position-cards/render.py --ticker NVDA --entry 92.40 --price 168.22 --rank 1
python3 nft/position-cards/build_deploy_args.py
python3 -m pytest tests/test_positions_collection.py
```

## Ship

1. Deploy an `IPositionOracle` for chain 4663 (`priceOf(token) -> USDG 1e18`, returning
   **0 rather than reverting or guessing** when it has no fresh price).
2. Deploy (testnet first — faucet: https://faucet.testnet.chain.robinhood.com):
   ```bash
   export DEPLOYER_PRIVATE_KEY=0x... POSITIONS_RENDER_URI=https://suwappu.bot/positions/meta/
   forge script contracts/deploy/DeployPositions.s.sol \
     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast -vvvv
   ```
3. `setOracle()` **before** any mint → `sealRegistry()` → `setMintPrice()` → `setMintOpen(true)`.
4. Set `SUWAPPU_POSITION_CARDS_CONTRACT` in the bot env to light up `/cards` and the fee
   discount. Unset disables the perk entirely.

**Still needed to ship:** the oracle has no implementation here — I could not verify pool
addresses for 96 equities from this environment, so the contract defines the interface and
the seam rather than guessing. Cards minted before an oracle is wired are permanently unpriced.
