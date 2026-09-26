# Executing a route

For whoever builds on `contracts/ElectricRouter.vy` -- a frontend, a bot, a
contract that routes as part of something larger.  [`theory.md`](theory.md) is
what decides the route; this is what settles it.

The reference encoder is `erouter.core.routecall`, pure Python and portable, and
`erouter route --calldata` prints exactly what it produces.  Everything below is
also written out in enough detail to build the call from nothing.

---

## 1. The call

```
execute(uint256 amount_in,
        address[] pools,
        uint256[] params,
        bool     set_approvals,
        address[] tokens   = [],
        address   receiver = msg.sender,
        uint256   min_out  = 0) -> uint256
```

`pools` and `params` are the same length and parallel: one pool, one packed word
of everything that pool's leg needs.  Pools stay a plain array of addresses so a
reader can see what is about to be called without unpacking anything.

Vyper writes one entry point per default argument, so **the shortest form that
still says what you mean is the one to send**.  Four selectors exist; dropping
`min_out`, then `receiver`, then `tokens` saves three words:

| you need | signature |
|---|---|
| nothing trailing | `execute(uint256,address[],uint256[],bool)` |
| named tokens | `…,bool,address[])` |
| a third-party receiver | `…,bool,address[],address)` |
| an end-to-end bound | `…,bool,address[],address,uint256)` |

Returns what the route produced of the last leg's output token, measured as a
balance delta.  Payable, `nonreentrant`, and stateless between calls.

## 2. The packed word

One `uint256` per pool, low bit first:

```
bits    width  field
0..59      60  frac       1e18 == 100%
60..187   128  min_rate   1e18-based, out per in, in raw token units
188..191    4  i
192..195    4  j
196..199    4  n_coins    only add_liquidity needs it
200..204    5  kind       ArcKind
205..209    5  in_ref     0 = read it off the pool, else tokens[ref - 1]
210..214    5  out_ref    same
215..255   41  must be zero
```

`kind` is `erouter.core.types.ArcKind`, and the same integers appear in
`RouteQuoter.vy` and `ElectricRouter.vy`.  `tests/test_kind_ids.py` fails the
build if the three lists ever disagree.

```
0  SWAP_STABLE           exchange(int128,int128,uint256,uint256)
1  SWAP_CRYPTO           exchange(uint256,…) then the use_eth spelling
2  DEPOSIT_FIXED         add_liquidity(uint256[N],uint256)
3  DEPOSIT_DYN           add_liquidity(uint256[],uint256)
4  DEPOSIT_FIXED_NOFLAG  add_liquidity(uint256[N],uint256)
5  WITHDRAW_STABLE       remove_liquidity_one_coin(uint256,int128,uint256)
6  WITHDRAW_CRYPTO       remove_liquidity_one_coin(uint256,uint256,uint256)
7  ERC4626_DEPOSIT       deposit(uint256,address)
8  ERC4626_REDEEM        redeem(uint256,address,address)
9  WRAP_NATIVE           payable deposit(), or deposit(uint256) on an adapter
10 UNWRAP_NATIVE         withdraw(uint256)
11 WSTETH_UNWRAP         unwrap(uint256)
12 WSTETH_WRAP           wrap(uint256)
13 STAKE_NATIVE          payable submit(address)
15 LEND_MINT             mint(uint256)
16 LEND_REDEEM           redeem(uint256)
```

14 is permanently reserved.  It was `SWAP_UNDERLYING` on an abandoned branch and
`data/facts` still records that survey under it.

## 3. Fractions are of what is left

`frac` is a share of the balance standing at the leg's input token **when that
leg runs**, read with `balanceOf`.  A 50/50 split is therefore `50%` then
`100%`, not `50%` twice:

```
leg 1   50% of 1,000 USDC   ->  500 spent, 500 left
leg 2  100% of   500 USDC   ->  500 spent, 0   left
```

Three things follow, and they are the reason for the encoding:

**A branch cannot be starved.**  The second leg spends what the first one really
left, not what it was modelled to leave, so a leg that returned a wei less than
expected costs a wei rather than a revert.

**Rebasing and fee-on-transfer tokens are measured.**  stETH loses a wei or two
on transfer; the router counts what arrived.

**The last leg out of a node must be `1e18`.**  Anything less strands the
remainder.  It is swept to the receiver rather than kept, so nothing is lost --
but it is also not routed, which is a worse price than the one you quoted.

Branches need no marking.  Order the legs so that a node's inflows all precede
its outflows -- a topological order -- and write each leg's share of what is left
at that point.  A branch and its merge fall out of that with no special case.

## 4. Every leg carries its own minimum rate

A single end-to-end bound lets a route be robbed in one pool and made whole in
another, which is the shape of a sandwich.  So each leg carries `min_rate` and
the router checks, on the balance that actually moved:

```
dy >= dx * min_rate / 1e18
```

`min_rate` is a rate between *raw* units, so it carries the decimal difference:
USDC (6) to WETH (18) around 4,000 USD is about `2.5e26`.  128 bits covers rates
from 1e-18 to 3.4e20; a pair outside that band -- an 18-decimal dust token
against an 8-decimal expensive one -- cannot be bounded at all, and neither can
a leg whose floor rounds to zero.  `encode_route` **refuses** those rather than
shipping a number that reads as protection: a leg worth too little to bound is
a leg worth too little to execute, and nothing upstream can see it, because
`prune_dust` drops branches by their share of a node's outflow in value
coordinates, before anything knows what a leg produces in token units.

### When the token is coarser than the tolerance

One unit of the output is `1/out` of the rate, so a small trade through a
high-decimal-value intermediate cannot express the fee fraction at all.  A
$1.45 tBTC -> WBTC -> USDT route makes **1,881 raw WBTC**; 20% of that pool's
4 bp fee is 0.15 of one unit, and a rate has no way to say it.

The bound then becomes the **tightest rate that still leaves a whole unit**:
the largest `min_rate` for which `dx * min_rate / 1e18` is at most `out - 1`.
One unit is 5.3 bp here, and that is what `tolerance_bp` reports -- not the
0.8 bp the fee rule asked for.

Binding at the quote itself is what that replaced, and it does not survive
contact with the route's own arithmetic.  A downstream leg's `dx` is a 60-bit
fraction of a balance standing at that moment, and the leg that sweeps takes
whatever wei earlier divisions stranded in the slot, so a leg with no room at
all reverts on rounding with nothing having moved.  Measured: the tBTC -> USDT
dust route tripped its own bound at some blocks and not others **on a fork**,
where there is no market to move.  The unit is the price of routing a trade
that size through an 8-decimal intermediate.

The same thing happens from the other side, and there it is worse.  `min_rate`
is `out * 1e18 // in`, so when `in` dwarfs `out` -- a cheap 18-decimal token
into a 6-decimal one -- the *rate* is left with a handful of significant
figures.  At `in = 4.5e23`, `out = 8.9e6` the rate is **19**, one step of which
is 5%, and the floor lands 423 bp under the quote however thin a tolerance was
asked for.  There is no rate in between, so the only defence is that
`tolerance_bp` reports 423 and not 0.2.  Read the floor, never the fraction.

### Where the reference rate has to come from

**Not from the route's own modelled leg amounts.**  The solver models each pool
by its first two derivatives; that is accurate enough to choose pools and split
flow and no better.  Measured on a live 13-leg mainnet route, its per-leg
figures were out by up to 37.9 bp against what the pools would really pay, in
both directions.  A minimum rate derived from those is a promise about a number
nothing checked -- and one leg of that route was mis-bounded by 22.4 bp against
a 13.9 bp tolerance, which reverts.

So `pipeline.price_legs` quotes every leg at its final size, in one batch, and
`RealizedLeg.verified_out` is what the bound is set against.  On a pool with an
exact model that costs arithmetic; otherwise one round trip for the route.

### How much tolerance

`erouter.core.routecall.min_rates` grants each leg

```
tolerance = max(FEE_SHARE * fee, floor)
```

with `FEE_SHARE = 0.2`, `floor` of 5 bp on a volatile pair and 0.1 bp
otherwise.  The 0.1 bp is not slippage at all -- it is room for the wei a wrap
or a rebasing token rounds away.  The 5 bp is: a pair whose price genuinely
moves between the quote and the block it lands in needs the room or it reverts
on honest movement.  `volatile` is passed in as a set of pool addresses rather
than inferred, because nothing in an arc distinguishes a pegged pair from an
oraclised stableswap holding a volatile one -- and that second shape is the one
that rugs on broadcast.

**A currency pair is bounded as a stable one, however its pool computes.**
`core.pools.volatile_pools` takes the chain's `stables + forex` and drops any
crypto-class pool whose coins are all somebody's money: gnosis trades USDC.e
against EURe in a twocrypto pool, and a euro does not run away from a dollar
between the quote and the block the way ETH does.  Measured on mainnet
EURS/USDC, which is a `crypto` pool: 0.60 bp granted rather than 5, and the fee
that trade pays there is 44.90 bp against a 3 bp `mid_fee` -- so this is where
bounding on the least fee earns the most.  `Chain.forex` is a declaration for
the same reason `Chain.stables` is; a survey by symbol also picks up a Pendle
principal token and two yield-bearing vaults, none of which are currencies.

**`fee` is the least the pool can charge, not what the leg pays.**  That is the
whole of it: the attacker front-runs and unwinds in small, balanced trades and
is charged near `mid_fee`, while the leg they wrap around pays the dynamic fee
at its own size.  Measured on TricryptoUSDC, 3 bp against 13 bp -- so bounding
on the larger hands over the difference.  `core.poolfee.floor_fee` reads it off
the model: `min(mid_fee, out_fee)` for the cryptoswaps, and the nominal fee for
stableswap, whose off-peg multiplier only ever raises it.  `charged_fee`
measures the other one, and is what the CLI shows.

Everything here is computed off chain and arrives as `min_rate` in the packed
word.  The router reads no oracle and re-derives no price: the solver's own
spot quote for that leg, minus this discount, is the bound.

### What it was measured to buy

Sandwiching the deployed TricryptoUSDC on a fork -- real contract, real dynamic
fee -- with the bound at `0.2 * mid_fee` and no floor, and **gas free**, so
nothing but the bound is doing the work.  The attack is three swaps on one
pool: the attacker buys, the victim buys, the attacker sells back what it
bought, and takes its profit in the token the victim was selling.

| victim | % pool | attacker buys | % pool | % of victim | in WETH | profit | ROI | bp of trade |
|---|---|---|---|---|---|---|---|---|
| 100 | 0.01% | 137.86 | 0.0091% | 137.9% | 0.0578 | **−0.11** | −0.1% | −10.69 bp |
| 1,000 | 0.07% | 121.32 | 0.0080% | 12.1% | 0.0509 | **−0.04** | −0.0% | −0.43 bp |
| 5,000 | 0.33% | 76.37 | 0.0050% | 1.53% | 0.0320 | +0.22 | +0.3% | +0.43 bp |
| 15,000 | 0.99% | 50.65 | 0.0033% | 0.338% | 0.0212 | +0.80 | +1.6% | +0.53 bp |
| 40,000 | 2.63% | 46.02 | 0.0030% | 0.115% | 0.0193 | +2.29 | +5.0% | +0.57 bp |
| 100,000 | 6.57% | 46.77 | 0.0031% | 0.047% | 0.0196 | +6.21 | +13.3% | +0.62 bp |
| 250,000 | 16.43% | 48.85 | 0.0032% | 0.020% | 0.0205 | +17.23 | +35.3% | +0.69 bp |
| 600,000 | 39.44% | 52.95 | 0.0035% | 0.009% | 0.0222 | +49.81 | +94.1% | +0.83 bp |

Three things to read off it.

**The attacker's own trade is about $50** -- between 46 and 138 USDC, three
thousandths of one per cent of the pool -- whatever the victim is trading.  It
has to be: the room the bound grants is a *price move*, and a price move is a
function of the front-run's size alone.  So their capital is pinned by the bound
while their take scales with the victim, which is why the return on capital runs
from −0.1% to +94% down the same column.

That $50 does **not** move the price for a $600,000 trade, and it is worth being
clear about what does.  Reading the marginal price with a 1 USDC probe at each
step of the attack:

| victim | front-run | it moves the price | the victim moves it | attacker's WETH | worth before | worth after | profit |
|---|---|---|---|---|---|---|---|
| 5,000 | 72.14 | 1.12 bp | 71 bp | 0.030121 | 72.14 | 72.66 | +0.42 |
| 40,000 | 68.63 | 1.08 bp | 586 bp | 0.028655 | 68.63 | 72.66 | +3.71 |
| 100,000 | 57.82 | 0.94 bp | 1,433 bp | 0.024143 | 57.82 | 66.12 | +7.93 |
| 600,000 | 55.50 | 0.91 bp | 9,577 bp | 0.023174 | 55.50 | 108.67 | +52.51 |

The front-run moves the price by about a basis point, every time -- that is all
the bound will license.  What revalues the attacker's stack is the *victim's
own* trade, which at $600,000 into a $1.5M pool moves the price 96%.  The
attacker is holding a position the bound sized across a move the victim made
themselves, which is why the profit tracks the victim's size and not the
front-run's.

That move is the curve and not the fee, which is worth checking rather than
assuming -- a fee-inclusive probe cannot tell them apart, and this pool's fee
really does climb sharply here.  Reading `fee()` and `price_scale()` off the
pool at each step:

| victim | probe moves | fee before | fee after | the fee's share | price_scale moves |
|---|---|---|---|---|---|
| 5,000 | 33 bp | 4.09 bp | 5.11 bp | 1.0 bp | 0 bp |
| 15,000 | 165 bp | 4.09 bp | 9.21 bp | 5.1 bp | 0 bp |
| 40,000 | 527 bp | 4.09 bp | 19.46 bp | 15.4 bp | 0 bp |
| 100,000 | 1,375 bp | 4.09 bp | 27.18 bp | 23.1 bp | 0 bp |
| 600,000 | 9,494 bp | 4.09 bp | 29.87 bp | 25.8 bp | 0 bp |

The fee accounts for 26 bp of a 9,494 bp move -- a quarter of one per cent --
and `price_scale` does not move at all, so there is no repeg in it either.  It
is the invariant.  Trading 39% of one side of a constant-product-like curve
gives `(1.39)^2 - 1`, about +93%, which is what came back.

### Turning the dial

The fifth is one point on a line, and the line is straight.  Sweeping the
multiplier at fixed leg sizes, front-run and profit in USDC, gas free:

| victim | 5% of mid_fee | 10% | 15% | 20% | 25% |
|---|---|---|---|---|---|
| 5,000 | 23 → +0.05 | 45 → +0.10 | 68 → +0.15 | 90 → +0.20 | 112 → +0.26 |
| 15,000 | 14 → +0.20 | 27 → +0.40 | 41 → +0.60 | 54 → +0.80 | 68 → +0.99 |
| 40,000 | 12 → +0.57 | 24 → +1.15 | 35 → +1.72 | 47 → +2.29 | 59 → +2.86 |
| 100,000 | 12 → +1.55 | 24 → +3.10 | 35 → +4.65 | 47 → +6.20 | 59 → +7.75 |
| 600,000 | 13 → +12.45 | 27 → +24.90 | 40 → +37.35 | 53 → +49.79 | 66 → +62.24 |

Double the multiplier and both the permitted front-run and the profit double,
to two significant figures, in every row.  **Spending more does not stop paying
the attacker** -- there is no size at which their own fees overtake the gain,
because the fee they pay is `mid_fee` on a trade small enough not to move the
pool, and it is the same `mid_fee` the multiplier is a fraction of.

So the multiplier is a dial on how much is given away and nothing else.  It buys
no threshold, which is why the only structural defence is the size of the leg.

Which also says how to defeat it, and it is not a tighter bound: **split the
trade**.  A leg at 1% of a pool moves the price 71 bp and pays the attacker
$0.42; the same value in one 39% leg moves it 96% and pays $52.51.  The solver
splits for output and this comes free with it -- the bottom rows of the table
are not routes this router would emit.

**At the small end it loses even for free.**  A $100 leg pays the attacker
−0.11 USDC and a $1,000 leg −0.04, because the front-run the bound permits is
too small for the displacement to cover its own two fees.  Two transactions of
gas -- about a dollar -- push that break-even up to roughly a $20,000 leg.

**At the large end the take converges on the tolerance**: 0.6 to 0.8 bp against
0.60 bp granted, the two differing only because the profit is in USDC and the
victim's loss is in WETH at a rate the attack itself moved.

The volatile floor is the same table with eight times the room.  That is the
accepted trade for a pair that would otherwise revert on honest movement, and
the reason it is granted to those pairs and to nothing else.

### What the bound guarantees

Exactly this: **the victim either settles at no worse than `(1 - t)` of its
quote, or it does not settle.**  The front-run can only be as large as the bound
will still let through, so extraction is capped at `t` of the trade -- and
measured, it comes to almost exactly `t`, scaling linearly with it and with
nothing else.  A fifth of the fee is a fifth of the fee in what it lets through,
and the 5 bp floor on a pool charging under 25 bp is looser by exactly
`5 / (0.2 * fee)`: twenty-five times on a 1 bp pool.  That is the compromise, as
a number.

Both halves are in `tests/test_sandwich.py`, against a constant-product pool and
a real `StableSwap`, driven through `min_rates` itself rather than a restatement
of it.

`charged_fee` measures the other one -- what this trade pays, by quoting it
twice, once as the pool is and once with its fee fields zeroed.  It is what the
CLI shows and what `leg_fee` returns; it is *not* what the bound is set from.

### What it was measured to buy

Sandwiching the deployed pools on a fork -- real contracts, real dynamic fees,
the attacker front-running and unwinding around a leg-sized victim, at 1 gwei
and ETH at $4,000:

| bound on | victim lost | attacker, net of gas |
|---|---|---|
| what the trade pays (13 bp) | 2.72 bp | **+$3.59 on a $15k leg** |
| the least it can charge (3 bp) | 0.60 bp | **−$0.15, loses** |

The attacker's *return on their own capital* barely moves -- around +180 bp
either way -- because the tolerance scales the front-run rather than the rate
of return.  What changes is that the front-run it permits shrinks from 204 USDC
to 45, and two transactions of gas then cost more than the attack makes.

That is a break-even, not immunity.  Gross extraction is about 0.6 bp of the
leg and gas is flat, so on TricryptoUSDC the attack loses at a $3k leg and at a
$15k leg, and pays from roughly $20k up -- still for no more than the tolerance.
3pool loses at every size, by 2.9 bp of the front-run: its impact never comes
near twice its fee.

`volatile` is passed in as a set of pool addresses rather than inferred:
`core.pools.volatile_pools` classifies by registry type, because nothing in an
arc distinguishes a pegged pair from an oraclised stableswap holding a volatile
one -- and that second shape is exactly what rugs on broadcast.

### What it adds up to

The bounds compound along the route, so `RouteCall.guaranteed_out` runs the
router's own arithmetic with every leg at its minimum and reports what the call
really promises.  On today's mainnet routes that is 0.3 bp under the quote for a
two-leg stable pair and 8-20 bp for a twelve-leg route through pools charging
over a hundred.  Show it before signing.  `min_out` is where a caller takes some
of it back, and it is checked against what the route produced -- not against the
router's balance, so a donation cannot satisfy it.

## 5. Tokens: read or named

`i` and `j` index the pool's own `coins`, and the router reads them.  That is
what makes them binding rather than advisory: a caller cannot point a minimum
rate at a token the pool does not hold at that index.

Tokens that are *not* pool coins have no getter that works on every deployment,
so those are named in `tokens` and pointed at by `in_ref` / `out_ref`.  Which to
name is a straight trade of calldata against gas, and it is the caller's:

| mode | names | when |
|---|---|---|
| `NONE` | nothing | shortest calldata: an L2, or a Curve lending callback that carries the whole call as `bytes` |
| `NEEDED` | LP tokens, vault assets, lending underlyings | the default |
| `ALL` | every token | cheapest to execute |

Measured, mainnet USDC to WETH over thirteen legs: 1,028 bytes and 2.47M gas
against 1,316 bytes and 2.43M.  Calldata wins on an L2 and loses on L1.

**One case cannot be read.**  Fourteen mainnet pools -- 3pool among them -- keep
their LP token in a separate contract and expose no getter for it at all.  The
router tries `lp_token()`, then `token()`, then falls back to the pool itself
only if the pool answers `totalSupply()`; otherwise it reverts with
`lp token unknown -- name it in tokens`.  Quietly treating those as their own LP
token would approve and count the wrong address.

A 1:1 token adapter wearing `WRAP_NATIVE` -- gnosis converts USDC.e to USDC
through one -- is named whatever mode you ask for, because nothing on it can be
read and the alternative is a call that means something else.

## 6. Approvals, native, and what comes back

**`set_approvals`** checks `allowance(self, pool) == max_uint256` per leg and
sets it if not.  Infinite, so it is paid once per (token, pool) and never again.
The reset-through-zero is there for USDT, which refuses a non-zero to non-zero
change and returns no data from `approve` at all.  Pass `false` once the
allowances are in place and save the reads.

**Native ETH** is `0xEeee…eEEeE`, Curve's sentinel.  A route whose first leg
spends it needs `msg.value == amount_in`; a route that does not spend it refuses
a non-zero `msg.value` rather than keeping it.  Payouts go out with a full-gas
call, so a contract wallet can receive them.

**Everything the route touched is swept** to `receiver` at the end -- not just
the destination.  The return value is the destination's balance *delta*, so
anything the router was already holding is handed over but not counted, and its
own balance is never a term in anyone's answer.  A donation to the router is
therefore a gift to whoever routes that token next, exactly as it is on Curve's
own router.

## 7. What it refuses

| revert | means |
|---|---|
| `one param word per pool` | `pools` and `params` are different lengths |
| `empty route` / `nothing to route` | no legs, or `amount_in == 0` |
| `bad receiver` | zero address, or the router itself |
| `reserved bits set` | bits 215+ of a packed word are non-zero |
| `frac out of range` | `frac` is 0 or above 1e18 |
| `in_ref`/`out_ref off the token list` | a ref points past `tokens` |
| `leg does not move between tokens` | input and output resolved to the same address |
| `coins` | the pool answered neither `coins(uint256)` nor `coins(int128)` |
| `lp token unknown` / `underlying unknown` | name it in `tokens` |
| `unknown leg kind` | a kind the router does not execute |
| `native input needs msg.value` | first leg spends native, `msg.value` disagrees |
| `route does not spend native` | `msg.value` sent to a route that wants none |
| `leg produced nothing` | the call succeeded and no balance moved |
| `leg below its minimum rate` | the leg's own bound |
| `below min_out` | the end-to-end bound |

`leg produced nothing` is worth understanding: some older crypto pools have only
the five-argument `exchange` **and** a `__default__` that swallows unknown
selectors, so the four-argument attempt succeeds and does nothing at all.  The
router does not ask whether the call succeeded, it asks whether anything moved --
and retries the other spelling if not.

## 8. Building the call

From this repo:

```python
from erouter.core.routecall import ALL, NONE, encode_route

call = encode_route(result.route, receiver=who, volatile=volatile_pools(pools),
                    quoted_out=result.verified_out)
tx = {"to": ROUTER, "data": call.calldata(sender=who), "value": 0}
```

`call.token_in` is what to hold and approve, `call.guaranteed_out` what the
bounds promise, `call.unbounded` any leg they could not.  `erouter route
--calldata` prints all of it, and `--json` carries it under `call`.

From another language, `routecall.py` is 442 lines including its reasoning
and the whole job is three: build the packed words, decide which tokens to
name, and ABI-encode the shortest signature.  The
two parts worth copying carefully are `fractions` -- shares of what is left, last
one always `1e18` -- and where the reference rate for `min_rate` comes from.

## 9. Traps

**A pinned block.**  Every number in a route is read at one block.  Quote and
execute against different state and the bounds are measuring a market that moved.

**Do not reuse a route.**  The fractions are fine at any size, but the minimum
rates were derived at one, and a dynamic fee moves with the trade.  Re-encode.

**The router is at `0xf5438dafc165b466f4a61ce57bd3aa59bcd5979e`**, the same
address on ethereum, arbitrum, optimism, base, gnosis, polygon, fraxtal, bsc,
avalanche, monad, plasma, xlayer, celo, tac and sonic.  It went out through the
canonical CREATE2 proxy under the salt `erouter.ElectricRouter.v2`, so the
address is a function of the proxy, the salt and the initcode alone -- not of
the chain, the deployer or a nonce.  Every one has been read back and matches
the compiled runtime byte for byte.  `core.schema.ROUTER_ADDRESS` carries it.

**Editing the contract moves it.**  Vyper embeds a hash of the source in the
*initcode*, which the deployed runtime never contains -- so a changed comment
leaves the on-chain bytecode identical while the source stops deploying to the
recorded address.  `tests/test_router_address.py` fails when that happens, and
the salt carries a version so a redeployment is a deliberate new address rather
than a silent collision.

An earlier build sits at `0xd3ff6f3531efb52a63c4b08ec5eccaa90c27618d` on the
same fifteen chains.  It works and nothing points at it; it predates the
authorship header, and is superseded.

**32 legs, 31 named tokens.**  Beyond that the encoder refuses rather than
truncating.

**A bound is not a guarantee of price.**  It stops a leg settling below a rate.
It cannot tell a pool that will honour its quote from one that will move on
broadcast -- see the blacklist and the reserve check in [`theory.md`](theory.md),
none of which is a proof either.

**Nor is it a guarantee against being sandwiched**, only against being
sandwiched for more than `t` -- and only on a leg steep enough to be worth
attacking at all.  Whoever sets `volatile` is choosing how much, per pool.
