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
- Narrowing variants exist (`swapViaVenueV1` for one venue,
  `swapViaSelectedVenuesV1` for a subset, plus `...WithFeeV1` forms). **We do
  not use them** — see "Venue narrowing" below for the address-space trap and
  why completeness beats the gas saving here.

### Venue narrowing — the address-space trap

Titan's `pamm` identifiers (from `titan_getPammQuote` and the price-level
stream) are **NOT the same address space** as the router's whitelist. Verified
on-chain 2026-08-15:

| Source | Addresses |
|---|---|
| `getWhitelistedVenues()` on the router | `0x5979…3320`, `0x71e7…0B3d`, `0xB09A…dD76`, `0x0000…2149`, `0x97CC…1223` |
| `titan_getPammPriceLevels` (`pamm` field) | `0x217d…3d95a`, `0x5979…3320`, `0x71e7…0B3d`, `0xb09a…dD76`, `0xe715…DcDB` |

Two stream addresses (`0x217d…`, `0xe715…`) are **not whitelisted venues**, and
two whitelisted venues never appear in the stream. `isWhitelistedVenue(0xe715…)`
returns **false** — yet that is exactly the `pamm` Titan reports for WETH→USDC.
Passing it to `swapViaVenueV1` reverts `UnknownVenue` and burns the user's gas.

**If you ever narrow, the venue list must come from `getWhitelistedVenues()`**,
filtered with `IPropAMM` reads against *those same addresses* — never from a
quote's `pamm` field and never from the price-level stream (see below).

#### `IPropAMM` lives on the venue, not the oracle (verified on-chain)

```solidity
function isActive(address tokenIn, address tokenOut) external view returns (bool);
function getPairs() external view returns (TokenPair[] memory);  // struct { address token0; address token1; }
```

Call these on the **whitelisted venue address**. Measured 2026-08-15:

| Address | `getPairs()` result |
|---|---|
| Fermi **venue** `0x5979…3320` (whitelisted) | 8 clean ERC-20 pairs — WETH/USDC, WETH/USDT, WBTC/USDT, WBTC/USDC, USDC/USDT, cbBTC/USDC, cbBTC/USDT, WBTC/cbBTC |
| Fermi **oracle** `0x26e5…f312` (not whitelisted) | 8 entries, but laced with the `0x…0001` placeholder and containing duplicates — **unusable for routing** |

The oracle **does not revert** — it answers with junk. "The call succeeded" is
therefore not a validity check; the address has to come from
`getWhitelistedVenues()`.

Two more gotchas:
- `TokenPair` is **canonical/unordered**. Match both directions — an earlier
  directional check against the stream wrongly concluded Fermi does not trade
  WETH→USDC when `getPairs()` shows it does.
- `isActive(tokenIn, tokenOut)` is the cheaper per-swap check; `getPairs()` is
  better for building a cached venue↔pair map.

#### The price-level stream is NOT a valid narrowing signal

`titan_getPammPriceLevels` reports 5 pAMMs and the whitelist holds 5 venues,
but they are **not the same five**:

| Whitelisted venue | In price-level stream? | Trades USDC/WETH? |
|---|---|---|
| `0x5979…3320` (Fermi) | yes | yes |
| `0x71e7…0B3d` (Kipseli) | yes | yes |
| `0xB09A…dD76` (bopAMM) | yes | yes |
| `0x0000…2149` (Tempest) | **no** | **yes** (+ WETH/USDT, USDC/USDT) |
| `0x97CC…1223` | **no** | **yes** (its only pair) |

Both stream-absent venues trade USDC/WETH — the pair used in every benchmark
above. Narrowing on stream membership would have silently dropped 2 of 5
routable venues for that pair, while the stream also advertises two
identifiers (`0x217d…3d95a`, `0xe715…DcDB`) that are not venues at all.

#### Why we do not narrow

- The full `swapV1` costs ~400–800k gas (≈7–14¢) and **guarantees no
  whitelisted pAMM's quote is missed**. The spread is driven by which pAMM
  fills, since their swap implementations vary widely.
- A pinned venue that cannot fill drops to the **Uniswap V3 fallback**, not to
  the next-best pAMM — so narrowing wrongly forfeits the entire pAMM price
  advantage (~25 bps vs our default route) to save a few cents.
- Every narrowing signal that is cheap to get (quote `pamm`, stream
  membership) is provably wrong here; the one that is correct
  (`getWhitelistedVenues()` + `IPropAMM`) needs on-chain reads, a cache, and
  staleness handling — real infra to save ~7¢.
- Our product is execution quality sold via subscriptions; fees only cover
  infra. Trading bps of fill quality for cents of gas is backwards here.

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
| `swapV1` (all venues) — **what we use** | 23 | 441k | 619k | 690k | 900k |
| `swapViaVenueV1` (pinned, unused) | 84 | 216k | 271k | 384k | — |
| `swapViaVenueWithFeeV1` (unused) | 13 | 233k | 233k | 396k | — |

Consistent with the 400–800k (≈7–14¢) range Titan documents for `swapV1`. The
variance comes mostly from *which* pAMM fills, since their swap
implementations differ widely — not from mis-measurement. We use the
all-venues path deliberately (see "Venue narrowing" above): completeness of
the quote set is worth far more than the few cents a narrowed call saves, and
the `pamm` identifier needed to narrow is not a valid router venue anyway.
The quote's USD gas figure uses expected usage (450k, ~p50), matching the
estimated-usage semantics of other venues' gasUsd; the tx reserves 900k.

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

## Execution verified on-chain (2026-08-15, `eth_call` simulation)

Execution was proven against **live mainnet state** via `eth_call` with
state overrides — no funds moved, no broadcast. The router's real `swapV1` /
`swapWithFeeV1` calldata (built from the same `PROPAMM_ROUTER_ABI` the engine
uses) was simulated with the caller's ETH/USDC balance and router allowance
overridden. All four cases behaved exactly as intended:

| Case | Result |
|---|---|
| Native ETH → USDC (`swapV1`, `value=amountIn`) | **fills, 1909 USDC**, venue `0x0000…2149` (Tempest — a real whitelisted pAMM, not the fallback) |
| USDC → ETH (`swapV1`, `tokenOut`=sentinel) | **fills, 1.0475 ETH** — proves the tokenOut native-sentinel mapping; delivers real native ETH |
| USDC → ETH fee swap (`swapWithFeeV1`, 100 bps, **our net minOut**) | **fills, 1.0371 ETH** |
| Control: same fee swap with the **pre-fix gross minOut** | **reverts `InsufficientOutput(1.05304, 1.04754)`** — the contract grosses the min back up past available output |

The control case is the money-path reviewer's finding #1 reproduced on-chain:
the pre-fix gross-based minimum would have reverted every fee-charging swap,
and our net-based minimum is exactly what makes it pass. Finding #2 (tokenOut
sentinel) is proven by the USDC→ETH cases delivering native ETH rather than
reverting.

**Not covered by simulation:** the sign → broadcast → nonce → gas-payment
path. That path is generic web3 and shared byte-for-byte with the KyberSwap /
1inch / 0x / Li.Fi executors already live in production — nothing in it is
PropAMM-specific. The router-specific logic (venue acceptance, native
handling, minOut math, fee grossing) is what simulation proves, and it holds.
