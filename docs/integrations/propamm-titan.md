# PropAMM Liquidity via Titan Builder (Taker Integration)

Provider id: `propamm_titan`. Ethereum mainnet, same-chain swaps only.

PropAMMs (pAMMs) are on-chain pools whose prices are streamed by market makers to the
Titan block builder in real time (Application-Controlled Execution). Takers get
CEX-competitive pricing on major pairs because the maker's latest quote update is
guaranteed to be sequenced immediately before the taker's swap in the same block.

Sources (read in full, 2026-08-15):
- https://docs.titanbuilder.xyz/propamms (+ /makers, /takers)
- https://lambdaclass.github.io/propamm-router-contracts/ (all pages)

## Contracts (verified on-chain via Blockscout, Ethereum mainnet)

| What | Address |
|------|---------|
| PropAMMRouter proxy (approve target AND tx target) | `0x4DdF368080CD7946db5b459aD591c350158175e1` |
| Implementation (`PropAMMRouter`, EIP-1967) | `0xC0e52D754cc691Ea5BF55A782dcFD1455a7a5d59` |

The router is a single-hop, on-chain best-venue router: on every swap it re-quotes
**all whitelisted pAMM venues plus Uniswap V3 in the same transaction**, fills through
the best, and falls back to Uniswap V3 transparently if the chosen pAMM reverts or
under-delivers. Delivered output is verified from the recipient's actual balance
delta (venue return values are not trusted); reverts `InsufficientOutput` if below
`amountOutMin`, `Expired` past `deadline`. Admin surfaces sit behind timelocks;
swaps can be `paused()` (quoting keeps working while paused).

### Swap entrypoints (both payable)

```solidity
swapV1(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin,
       address recipient, uint256 deadline)
    returns (uint256 amountOut, address executedVenue);

swapWithFeeV1(..., (uint16 bps, address recipient) fee)   // FrontendFee tuple
    returns (uint256 amountOut, address executedVenue);
```

- Native ETH in/out: sentinel `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`;
  `msg.value = amountIn` when tokenIn is the sentinel. ERC-20 input needs approval
  to the **proxy** address.
- `swapWithFeeV1` skims the fee **from the output token** to `fee.recipient`.
  `amountOutMin` is the **net** minimum after the fee. `fee.bps` must be in
  **[1, 100]** (max 1%) or the contract reverts `FeeBpsTooHigh`. Fee charged is
  emitted as `FrontendFeeCharged`; fills emit `Swapped`.
- Pinned-venue variants exist (`swapViaVenueV1`, `swapViaSelectedVenuesV1`, and
  `...WithFeeV1` forms) — the Uni V3 fallback still applies.

### Gas — do NOT use node estimation

The official SDK (v1.1.3) deliberately attaches **hardcoded per-function gas
limits and skips `estimateGas`**: estimation runs against current state, but the
swap can take a heavier branch at execution (e.g. drop into the Uni V3 fallback),
so estimates under-shoot and the tx runs out of gas. The all-venues `swapV1` path
is the most expensive tier (SDK example: 800k). We use a hardcoded limit with
headroom (see `bot/services/propamm_api.py` / engine constants).

## Quoting

Two mechanisms with different freshness/cost tradeoffs:

1. **Titan quote helpers (what we use for the quote race)** — public, no auth,
   JSON-RPC POST to `https://rpc.titanbuilder.xyz` (regional:
   `eu.`/`ap.`/`us.rpc.titanbuilder.xyz`; docs also list a `/data` path):

   ```json
   {"jsonrpc":"2.0","id":1,"method":"titan_getPammQuote",
    "params":["0xTokenIn","0xTokenOut","0xAmountInHex"]}
   ```

   Result: `{tokenIn, tokenOut, amountIn, amountOut, pamm, router, blockNumber,
   slot, timestamp}` — amounts are **hex atomic units**. Also
   `titan_getPammQuoteVenue(venue, ...)` for a single venue.

   Caveats learned by live testing + full doc read:
   - Backed by Titan's latest **price-level snapshot** (EVM-simulated rungs plus
     linear-spline `Interpolated` rungs) — advisory, pAMMs only (no Uni V3
     fallback included).
   - Pairs are indexed by **WETH**: the native sentinel returns JSON-RPC error
     `-32000 "unknown pair"`. Quote native ETH as WETH
     (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`), execute with the sentinel.
   - `-32000 "unknown pair"` == no pAMM liquidity for the pair → skip the venue
     quietly in the race.

2. **On-chain `quoteV1`/`quoteVenueV1`/`quoteSelectedVenuesV1`** — nonpayable
   simulations, callable only via `eth_call`, and only meaningful when carrying
   the maker **state overrides** (`titan_getPammStateOverrides` snapshot or the
   `wss://.../ws/pamm_quote_stream` stream) as the eth_call state-override set,
   with the simulation pinned to the snapshot's block/timestamp. This is what the
   official `propamm` PyPI SDK automates. More accurate, heavier; a future
   upgrade path if snapshot-quote drift proves material.

Because execution re-quotes venues against the exact execution state and enforces
`amountOutMin` from real balance deltas, snapshot-quote drift results in either a
better fill, a Uni V3 fallback fill, or a clean `InsufficientOutput` revert —
never a silent bad fill.

## Streams (not currently used, documented for future work)

- `wss://{eu,ap,us}.rpc.titanbuilder.xyz/ws/pamm_quote_stream` — maker state
  overrides (eth_call State Override Set shape), merged flat across makers.
  Public no-auth coverage: FermiSwap, Kipseli, bopAMM. Some makers are
  permissioned.
- `.../ws/pamm_price_levels` (+ `titan_getPammPriceLevels`) — full order-book
  ladders per pAMM/pair, `Simulated` + `Interpolated` rungs; each frame is a
  complete snapshot.
- Multi-candidate bundle submission (send N routing variants; builder picks best
  at build time) — searcher/solver pattern, out of scope for the bot.
- Maker-side (`/ws/sendquoteupdate`) is API-key gated and irrelevant to us.

## Measured numbers (2026-08-15, live)

**Pricing** (`titan_getPammQuote` vs competitors, gross vs gross):

| case | vs KyberSwap | vs Li.Fi (our default venue) |
|------|-------------:|------------------------------:|
| 1 WETH→USDC | −0.62 bps | **+25.1 bps** |
| 10 WETH→USDC | −0.39 bps | **+25.6 bps** |
| 10k USDC→WETH | +0.26 bps | **+25.3 bps** |
| 100k USDC→WETH | −0.01 bps | **+25.1 bps** |
| 10k USDC→USDT | −0.02 bps | **+25.0 bps** |

Takeaway: pAMM pricing matches the best CFMM aggregator within ±0.6 bps and
beats the Li.Fi default route by ~25 bps — that spread is the commercial case
for the venue. Depth is snapshot-limited: 50 WETH (~$94k) returned no quote
(engine skips the venue cleanly), and per-pair availability varies (WBTC was
intermittently unquoted). Price impact within quoted sizes is near zero
(100k USDC→WETH within 0.3 bps of 10k).

**Gas** (150 recent router txs on mainnet):

| entrypoint | n | p50 | p90 | max | our limit |
|------------|--:|----:|----:|----:|----------:|
| `swapViaVenueV1` (pinned) | 84 | 216k | 271k | 384k | 550k |
| `swapViaVenueWithFeeV1` | 13 | 233k | 233k | 396k | 550k |
| `swapV1` (all venues) | 23 | 441k | 619k | 690k | 900k |

We pin the venue from our own fresh execution-time re-quote (`pamm` field)
and use the `ViaVenue` entrypoints — half the gas of the all-venues requote,
with the Uniswap V3 fallback (and therefore minOut protection) unchanged.
The quote's USD gas figure uses expected usage (250k, ~p50 of the pinned
path), matching the estimated-usage semantics of other venues' gasUsd.

**Latency** (from US infra): `us.rpc.titanbuilder.xyz` ~0.26–0.34s round
trip vs ~0.58–0.75s for the bare host and ~0.7–0.8s for `ap.` — the `us.`
host is the default (`TITAN_RPC_URL` overrides per region).

## Our wiring

- `bot/services/propamm_api.py` — `PropAMMAPI.get_quote()` → `titan_getPammQuote`;
  gated by `settings.propamm_enabled` (default off; kill switch), RPC URL from
  `settings.titan_rpc_url`, router address from `settings.propamm_router_address`.
- `bot/services/swap_engine.py` — provider `propamm_titan` in
  `EXECUTABLE_PROVIDERS`; queued in the quote race for ethereum→ethereum;
  executed via `_execute_propamm_swap` (`swapV1`, or `swapWithFeeV1` when
  `1 <= platform fee bps <= 100` and a collector is configured).
- Live verification: `curl` `titan_getPammQuote` for WETH→USDC returned
  ~1880.78 USDC/ETH matching spot, with `router` equal to the verified proxy.
