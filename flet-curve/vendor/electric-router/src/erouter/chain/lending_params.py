"""The lending pools: stableswap with wrapped tokens (§2.4).

The oldest Curve pools hold *wrapped* balances -- cDAI, aDAI -- and value them
through the wrapper's own exchange rate.  None of this is new arithmetic: the
invariant is stableswap, `StableSwap` already takes `rates`, and the whole
difference is where those rates come from.  The Compound pools compute theirs:

    rate  = cToken.exchangeRateStored()
    rate += rate * supplyRatePerBlock * (block.number - accrualBlockNumber) / 1e18
    rates[i] = PRECISION_MUL[i] * rate

which is block-dependent, and therefore only meaningful at a pinned block.  The
Aave pools hold rebasing aTokens worth one underlying each, so their rate is the
plain `10**(36 - decimals)` every other stableswap uses.

Two things kept these out of `build_exact_pools`, and neither was the maths:

* **The coin list includes the underlying tokens.**  `cDAI/cUSDC` reports four
  coins with zero balances on the last two, because `exchange_underlying` trades
  those -- so `all(pool.balances)` reads the pool as empty and drops it.
* **Wrapped balances move between blocks.**  aTokens rebase, so the universe's
  snapshot is a few wei off the pool's own `balances()` -- nothing to a router
  and fatal to a wei-exact gate.  These read their balances fresh.
"""

from __future__ import annotations

from ..core.codec import encode_call
from ..core.probe import Probe
from ..core.quoter import Call
from ..core.stableswap import StableSwap, StableSwapError
from ..core.types import ArcKind

#: `LENDING_PRECISION` in the pools' own words: the rate of a coin that is not
#: lent out at all.
LENDING_PRECISION = 10**18

#: `(fee_on_xp, subtract_one)`, in the order they are tried.
#:
#: This generation is not one implementation.  The Compound pools take a static
#: fee in token space and round the output down by a wei; the Aave pool takes a
#: *dynamic* fee in `xp` space and keeps the wei.  Nothing on the interface
#: separates them -- both answer `A_precise()`, both answer `fee()` -- so the
#: variant is settled the only way it can be: by asking the pool and keeping
#: whichever reproduces its own answer.  That is the same wei-exact rule the
#: rest of the reader runs on, applied one level down.
VARIANTS = ((False, True), (True, False), (True, True), (False, False))

#: Sizes the variant is chosen on.  More than one, because a wrong variant can
#: coincide at a single size and none of them coincide across a decade.
VARIANT_FRACTIONS = (0.001, 0.05)


def candidates(pools) -> list:
    """Pools whose coin list runs past their balances.

    A lending pool lists its underlying coins after its wrapped ones and
    reports them with a zero balance.  A genuinely empty pool has no non-zero
    prefix at all and is not one of these.
    """
    out = []
    for pool in pools:
        balances = [int(b) for b in (pool.balances or [])]
        if len(balances) < 3 or len(balances) != len(pool.coins):
            continue
        held = 0
        for value in balances:
            if value <= 0:
                break
            held += 1
        if 2 <= held < len(balances):
            out.append((pool, held))
    return out


def _underlying_decimals(pool, held: int, index: int) -> int:
    """Decimals of the token coin `index` is a wrapper for.

    The universe lists the underlying coins after the wrapped ones, in the same
    order, which is what `PRECISION_MUL` is built from.  A pool that lists
    fewer underlying than wrapped (the USDT pool lends only two of its three)
    leaves the unwrapped coin as itself.
    """
    tail = pool.coins[held:]
    if index < len(tail):
        return int(tail[index].decimals)
    return int(pool.coins[index].decimals)


def build_exact_lending(pools, client, *, block: int, quiet: bool = True):
    """`(address -> StableSwap, notes)` for the lending pools that quote.

    Returned rather than folded into `ExactPools` so the caller decides where
    they live; they go through exactly the same wei-exact gate afterwards.
    """
    wanted = candidates(pools)
    made: dict[str, StableSwap] = {}
    notes: list[tuple[str, str]] = []
    if not wanted:
        return made, notes

    # Fresh balances and the pool's own parameters, at the pinned block.
    calls: list[Call] = []
    for pool, held in wanted:
        calls += [
            Call(pool.address, encode_call("A_precise()")),
            Call(pool.address, encode_call("A()")),
            Call(pool.address, encode_call("fee()")),
            Call(pool.address, encode_call("offpeg_fee_multiplier()")),
        ]
        for i in range(held):
            # Both spellings, first one that answers wins.  This generation is
            # split between them -- the Compound pool takes `int128`, the Aave
            # pool `uint256` -- and asking for only one silently drops the
            # other, which is how aDAI/aSUSD read as "would not report its
            # balances" when it reports them happily.
            calls.append(Call(pool.address, encode_call("balances(int128)", i)))
            calls.append(Call(pool.address, encode_call("balances(uint256)", i)))
    answers = client.raw(calls)

    # The wrapper rates.  Only a coin that answers `exchangeRateStored()` is
    # lent out; the rest are worth one underlying each.
    wrapped: list[tuple[str, int, int]] = []      # (pool, coin index, call slot)
    rate_calls: list[Call] = []
    for pool, held in wanted:
        for i in range(held):
            where = pool.coins[i].address
            wrapped.append((pool.address.lower(), i, len(rate_calls)))
            rate_calls += [
                Call(where, encode_call("exchangeRateStored()")),
                Call(where, encode_call("supplyRatePerBlock()")),
                Call(where, encode_call("accrualBlockNumber()")),
            ]
    rate_answers = client.raw(rate_calls) if rate_calls else []

    rates_of: dict[str, dict[int, int]] = {}
    for address, i, slot in wrapped:
        stored, supply, accrued = rate_answers[slot : slot + 3]
        if stored.ok and stored.uint():
            rate = stored.uint()
            if supply.ok and accrued.ok and block > accrued.uint():
                rate += (rate * supply.uint() * (block - accrued.uint())
                         // LENDING_PRECISION)
        else:
            rate = LENDING_PRECISION
        rates_of.setdefault(address, {})[i] = rate

    cursor = 0
    for pool, held in wanted:
        precise, plain, fee, offpeg = answers[cursor : cursor + 4]
        pairs = answers[cursor + 4 : cursor + 4 + 2 * held]
        cursor += 4 + 2 * held
        key = pool.address.lower()
        balances = []
        for i in range(held):
            signed, unsigned = pairs[2 * i], pairs[2 * i + 1]
            balances.append(signed if signed.ok else unsigned)
        if not all(b.ok for b in balances) or not fee.ok:
            notes.append((pool.address, "would not report its balances"))
            continue
        if precise.ok and precise.uint():
            amp, a_precision = precise.uint(), 100
        elif plain.ok and plain.uint():
            amp, a_precision = plain.uint(), 1
        else:
            notes.append((pool.address, "no A"))
            continue

        rates = []
        for i in range(held):
            mul = 10 ** (18 - _underlying_decimals(pool, held, i))
            rates.append(mul * rates_of.get(key, {}).get(i, LENDING_PRECISION))
        shaped = {
            "balances": tuple(int(b.uint()) for b in balances),
            "rates": tuple(rates),
            "amp": amp,
            "fee": fee.uint(),
            "offpeg_fee_multiplier": offpeg.uint_or(0) or 0,
            "a_precision": a_precision,
        }
        picked = _pick_variant(pool, held, shaped, client)
        if picked is None:
            notes.append((pool.address, "no variant reproduces its own get_dy"))
            continue
        made[key] = picked
        if not quiet:
            print(f"  lending {pool.name}: {held} wrapped coins, rates {rates}, "
                  f"fee_on_xp={picked.fee_on_xp} subtract_one={picked.subtract_one}")
    return made, notes


def _pick_variant(pool, held: int, shaped: dict, client) -> StableSwap | None:
    """The variant that reproduces this pool's own `get_dy`, or `None`.

    Both directions: the parameter under test is a *rate*, and a mis-scaled one
    inflates one leg and deflates the other, so `0 -> 1` alone cannot see it.
    """
    probes = []
    for i, j in ((0, 1), (1, 0)):
        for frac in VARIANT_FRACTIONS:
            dx = max(1, int(shaped["balances"][i] * frac))
            probes.append(Probe(pool.address, ArcKind.SWAP_STABLE, i, j, held, dx))
    truth = client.probe(probes)
    wanted = [(pr, q) for pr, q in zip(probes, truth, strict=True)
              if q.ok and q.value > 0]
    if not wanted:
        return None
    for fee_on_xp, subtract_one in VARIANTS:
        model = StableSwap(fee_on_xp=fee_on_xp, subtract_one=subtract_one, **shaped)
        try:
            if all(model.get_dy(pr.i, pr.j, pr.dx) == q.value for pr, q in wanted):
                return model
        except (StableSwapError, ZeroDivisionError, ValueError):
            continue
    return None


# ---------------------------------------------------------------- rate pools
#
# The same idea one step further out.  These pools hold a token whose value is
# not one -- rETH, ankrETH -- or price a coin against a moving target.  The
# invariant is still stableswap and `xp = rate * balance / PRECISION` is still
# the convention; only the rate has somewhere else to come from.
#
# Each pool's own `_stored_rates` says where, and it is `@internal`, so the
# wrapper has to be asked directly:
#
#     ETH/rETH   [PRECISION, rETH.getExchangeRate()]
#     ETH/aETH   [PRECISION, PRECISION * LENDING_PRECISION / aETH.ratio()]
#     RAI3CRV    [snappedRedemptionPrice() / 10**9, base virtual price]
#
# This runs **only over pools the ordinary reading already rejected**.  Some
# pools hold rETH and genuinely value it at one, and asking the wrapper there
# would turn a working model into a rejected one.  Retrying only the failures
# cannot regress anything, and the wei-exact check still decides.

#: `getter -> how to turn its answer into a rate`.  Tried in order.
RATE_SOURCES = (
    ("getExchangeRate()", lambda v: v),          # rETH
    ("ratio()", lambda v: 10**36 // v if v else 0),   # ankrETH, inverted
    ("exchangeRateStored()", lambda v: v),       # cTokens
)

#: `snappedRedemptionPrice()` carries 27 decimals; the pools want 18.
REDEMPTION_PRICE_SCALE = 10**9


def _wrapper_rates(pools, client) -> dict[str, int]:
    """`coin -> rate`, for coins that answer a known wrapper interface."""
    coins = sorted({c.address.lower() for p in pools for c in p.coins})
    if not coins:
        return {}
    calls = [Call(a, encode_call(sig)) for a in coins for sig, _ in RATE_SOURCES]
    answers = client.raw(calls)
    out: dict[str, int] = {}
    width = len(RATE_SOURCES)
    for k, address in enumerate(coins):
        for slot, (_, convert) in enumerate(RATE_SOURCES):
            answer = answers[k * width + slot]
            if answer.ok and answer.uint():
                rate = convert(answer.uint())
                if rate:
                    out[address] = rate
                break
    return out


def build_exact_rate_pools(pools, client, *, addresses, virtual=None,
                           quiet: bool = True):
    """Retry `addresses` with rates taken from their wrappers.

    `virtual` maps an LP token's issuing pool to its virtual price, for a
    metapool whose second coin is someone else's LP.
    """
    wanted = [p for p in pools if p.address.lower() in addresses
              and p.balances and all(p.balances)]
    made: dict[str, StableSwap] = {}
    if not wanted:
        return made
    rates_by_coin = _wrapper_rates(wanted, client)

    # A pool-level oracle: RAI's redemption price is a property of the pool,
    # not of the token, so it cannot come from the coin table above.
    snaps = client.raw([Call(p.address, encode_call("redemption_price_snap()"))
                        for p in wanted])
    snapped: dict[str, int] = {}
    holders = [(p, a) for p, a in zip(wanted, snaps, strict=True) if a.ok and a.uint()]
    if holders:
        answers = client.raw([Call(f"0x{a.uint():040x}",
                                   encode_call("snappedRedemptionPrice()"))
                              for _, a in holders])
        for (pool, _), answer in zip(holders, answers, strict=True):
            if answer.ok and answer.uint():
                snapped[pool.address.lower()] = answer.uint() // REDEMPTION_PRICE_SCALE

    meta: list[Call] = []
    for pool in wanted:
        meta += [Call(pool.address, encode_call("A_precise()")),
                 Call(pool.address, encode_call("A()")),
                 Call(pool.address, encode_call("fee()")),
                 Call(pool.address, encode_call("offpeg_fee_multiplier()"))]
    answers = client.raw(meta)

    for k, pool in enumerate(wanted):
        precise, plain, fee, offpeg = answers[4 * k : 4 * k + 4]
        if not fee.ok:
            continue
        if precise.ok and precise.uint():
            amp, a_precision = precise.uint(), 100
        elif plain.ok and plain.uint():
            amp, a_precision = plain.uint(), 1
        else:
            continue
        key = pool.address.lower()
        rates = []
        for i, coin in enumerate(pool.coins):
            base = 10 ** (36 - int(coin.decimals))
            if i == 0 and key in snapped:
                rates.append(snapped[key])
                continue
            got = rates_by_coin.get(coin.address.lower())
            if got is not None:
                rates.append(got * 10 ** (18 - int(coin.decimals)))
            elif virtual and coin.address.lower() in virtual:
                rates.append(virtual[coin.address.lower()])
            else:
                rates.append(base)
        shaped = {"balances": tuple(int(b) for b in pool.balances),
                      "rates": tuple(rates), "amp": amp, "fee": fee.uint(),
                      "offpeg_fee_multiplier": offpeg.uint_or(0) or 0,
                      "a_precision": a_precision}
        picked = _pick_variant(pool, len(pool.coins), shaped, client)
        if picked is not None:
            made[key] = picked
            if not quiet:
                print(f"  rate pool {pool.name}: rates {rates}")
    return made
