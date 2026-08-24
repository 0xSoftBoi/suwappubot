# Why the agent refuses almost everything

Measured 24 Aug 2026, on the first five-chain cycles.

The agent is discovering correctly and gating correctly. What stops it trading
is that it usually cannot see who holds the token, and `holder_concentration`
fails closed — which is the right behaviour and the wrong outcome.

## The evidence

`suwappu-omni`, first five-chain cycle: **25 scanned, 12 theses, 12 sealed, 0
executed.** All 12 refused. Every refusal was the same two gates, with 20 of 22
gates passing:

```
FAIL holder_concentration  holder distribution unknown  observed=unknown limit=40
FAIL lp_locked             LP is not verifiably locked
```

Chains were genuinely covered — robinhood 4, bsc 4, base 3, solana 2,
hyperevm 2 — so discovery is not the problem.

`suwappu-alpha`, 40 decisions on Base alone:

```
holder_concentration  FAIL  observed=unknown   x32
holder_concentration  PASS  observed=17.51     x8
```

Read that carefully: all eight passes carry the **same** value, i.e. one token
that resolved and then served from cache. It is not "succeeds 20% of the time".
It is closer to "one token ever succeeded". Alpha has **zero fills in its last
40 decisions**, and that is why.

## Cause 1 — two chains have no holder source at all

`BLOCKSCOUT_BASE_URLS` in `bot/services/token_intel/evm_source.py` covered
ethereum, base, bsc, polygon, arbitrum, optimism. Neither of the two new chains
was in it, so `_base_url()` returned None and holder concentration was
structurally unavailable.

- **Robinhood: fixed.** It runs its own Blockscout at
  `robinhoodchain.blockscout.com` — the URL was already sitting in
  `chains.py` as `explorer_url`. Verified live: token info and holders both
  serve, and holders flags the UniswapV3Pool as a contract, which
  `_holder_row` already excludes from the float.
  *Trap worth recording*: Blockscout v2 paginates by cursor and **ignores
  `?limit`**. Passing one returns an empty `items` array, which reads exactly
  like "this token has no holders". That cost a wrong conclusion here.
- **HyperEVM: no source exists.** `hyperevm.blockscout.com` and
  `hyperliquid.blockscout.com` are 404; `hyperscan.com` redirects off-chain.
  The holder gate can never pass there with current tooling, so HyperEVM
  discovery currently produces refusals and nothing else.

## Cause 2 — the source we do have is unreliable

Base is fully supported and still returned `unknown` 32 times out of 40. The
Blockscout instances are, in the words of the comment already in that file,
"free, shared, rate-limited". `MAX_PAGES = 5` bounds the walk, but nothing
bounds how often we ask, and there is no retry or backoff on the holder call —
unlike the GeckoTerminal path, which now has both.

This is the same shape as the discovery outage fixed hours earlier: a
dependency quietly failing, and the failure rendering as an ordinary,
plausible-looking refusal rather than as an error.

## What this means for mainnet

The readiness doc lists B5 — no track record — as the last open blocker. This is
upstream of it. **The agent cannot build a track record while its security
dependency fails on most tokens**, because every refusal is a non-trade and
MinTRL counts closed trades. Fixing this is a prerequisite for the evidence
gate, not a parallel task.

## Open, in priority order

1. Retry + backoff on the Blockscout holder call, mirroring what GeckoTerminal
   now has. Likely the single biggest unlock.
2. Decide HyperEVM: drop it from `allowedChains` until a holder source exists,
   or accept a permanent refusal stream. Leaving it as-is floods the feed with
   noise — the exact problem the screener fix removed.
3. Consider whether `lp_locked` failing closed is right for memecoins. It is
   currently unset on every chain, so it refuses everything regardless of the
   holder result.
