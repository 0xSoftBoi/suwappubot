"""Read what a stableswap pool needs to be evaluated instead of probed.

`core/stableswap.py` runs the pool's own invariant, which turns `f(delta)` from
something measured into something computed -- exact at any size, and free once
the parameters are in hand.  This is the part that gets them: one batched pass
over the universe for `A`, the fee, the off-peg multiplier and the rates.

**Every pool is checked against the chain before it is believed.**  That is the
whole safety argument: a misread `A`, a rate array in the wrong order or the
wrong fee convention produces a curve that is confidently wrong at every size
and, unlike a failed probe, does not announce itself.  So each candidate is
quoted once for real and kept only if the arithmetic reproduces it exactly.  A
pool that does not reproduce keeps being probed.

The two dialects are separated by asking rather than by guessing: a pool that
answers `A_precise()` scales `A` by 100 and takes its fee in `xp` space; one
that does not is the legacy shape and takes the fee after converting back to
token units.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.codec import encode_call
from ..core.stableswap import StableSwap, StableSwapError
from ..core.transport import Call
from ..core.types import ArcKind, Probe
from .exact_cache import trust as _trust_verdict
from .lending_params import build_exact_lending, build_exact_rate_pools

#: Sizes to check at, as fractions of the input balance, in both directions.
#
# One point is not enough, and that is measured rather than cautious: a
# cryptoswap model built from the wrong invariant reproduced a pool at 1% of
# balance and disagreed with it at five of the six other points tried.  A model
# that matches where it was checked and diverges elsewhere is worse than no
# model, because nothing downstream will ever ask again.  A dust probe also
# agrees with almost any `A`, so the ladder spans three decades.
CHECK_FRACTIONS = (0.001, 0.01, 0.1)


@dataclass(slots=True)
class ExactPools:
    """Verified stableswap models, by pool address."""

    by_pool: dict[str, StableSwap] = field(default_factory=dict)
    checked: int = 0
    #: Admitted on a remembered verdict, without re-gating.
    trusted: int = 0
    rejected: list[tuple[str, str]] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.by_pool)

    def get(self, pool: str):
        return self.by_pool.get(pool.lower())


#: What the contracts allow: `MAX_COINS` is 8 in RouteQuoter, RouteExecutor and
#: ElectricRouter alike.  Capped at 4 here, sonic's 8-coin CrossCurve CRV never
#: reached the gate -- and it reproduces on the first convention tried.
MAX_COINS = 8


def _stable(pool) -> bool:
    """Whether this pool is worth asking about at all."""
    kind = getattr(pool, "swap_kind", None)
    return (kind in (ArcKind.SWAP_STABLE, None)
            and 2 <= len(pool.coins) <= MAX_COINS)


def _decode_rates(blob: bytes | None, n_coins: int) -> tuple[int, ...]:
    """`stored_rates()`, dynamic on the ng pools and fixed on the older ones.

    Length cannot separate them -- 128 bytes is a two-coin `DynArray` and a
    four-coin `uint256[N_COINS]` -- so the header decides.  Demanding one valued
    ETHx at par, 9.5% out.
    """
    if not blob:
        return ()
    words = [int.from_bytes(blob[k : k + 32], "big")
             for k in range(0, len(blob) - 31, 32)]
    if len(words) >= 2 + n_coins and words[0] == 32 and words[1] == n_coins:
        return tuple(words[2 : 2 + n_coins])
    if len(words) == n_coins:
        return tuple(words)
    return ()


#: Compound's `exchangeRateStored` is scaled by this, and a pool with no
#: lending coin uses it unchanged -- `LENDING_PRECISION` in the deployed source.
LENDING_PRECISION = 10**18


def _lending_rates(pools, client, block: int) -> dict[str, tuple[int, ...]]:
    """Rates for the pools that hold a lending token, as the pool builds them.

    A Compound pool's `_stored_rates` is `PRECISION_MUL[i] * rate`, where the
    rate is `exchangeRateStored` carried forward to this block:

        rate += rate * supplyRatePerBlock * (block - accrualBlockNumber) / 1e18

    which is why one read of the exchange rate is not enough -- the pool accrues
    interest between the cToken's last accrual and now, and skipping it is 1 bp
    of error rather than a rounding one.  `PRECISION_MUL` corrects for the
    *underlying* decimals, not the wrapped ones: cUSDC has eight, USDC six.

    Only pools whose `underlying_coins` differ from `coins` are asked at all, so
    a universe of ordinary pools pays one batch of reverts for the question.
    """
    SPELLINGS = ("underlying_coins(uint256)", "underlying_coins(int128)")

    # Index zero, both spellings: two calls to learn whether a pool has an
    # underlying view at all.  Asking every index of every pool costs about
    # 2,300 reverts on ethereum to find four pools.
    first = client.raw([Call(pool.address, encode_call(sig, 0))
                        for pool in pools for sig in SPELLINGS])
    speaks: dict[str, str] = {}
    for k, pool in enumerate(pools):
        for n, sig in enumerate(SPELLINGS):
            answer = first[2 * k + n]
            if answer.ok and answer.data and len(answer.data) >= 32:
                speaks[pool.address.lower()] = sig
                break
    if not speaks:
        return {}

    rest = [p for p in pools if p.address.lower() in speaks and len(p.coins) > 1]
    got = client.raw([Call(p.address, encode_call(speaks[p.address.lower()], k))
                      for p in rest for k in range(1, len(p.coins))])

    per_pool: dict[str, list[str]] = {}
    at = 0
    for pool in rest:
        n = len(pool.coins)
        head = first[2 * list(pools).index(pool) + SPELLINGS.index(
            speaks[pool.address.lower()])]
        found = ["0x" + head.data[-20:].hex().lower()]
        for _ in range(1, n):
            answer = got[at]
            at += 1
            found.append("0x" + answer.data[-20:].hex().lower()
                         if answer.ok and answer.data and len(answer.data) >= 32
                         else "")
        own = [c.address.lower() for c in pool.coins]
        if all(found) and found != own:
            per_pool[pool.address.lower()] = found
    if not per_pool:
        return {}

    # The underlying's decimals set `PRECISION_MUL`; the wrapped coin answers
    # the three Compound getters, or does not and is not a lending coin.
    wanted = sorted({a for v in per_pool.values() for a in v})
    holders = sorted(per_pool)
    reads = [Call(a, encode_call("decimals()")) for a in wanted]
    for address in holders:
        pool = next(p for p in pools if p.address.lower() == address)
        for coin in pool.coins:
            reads += [Call(coin.address, encode_call("exchangeRateStored()")),
                      Call(coin.address, encode_call("supplyRatePerBlock()")),
                      Call(coin.address, encode_call("accrualBlockNumber()"))]
    answers = client.raw(reads)
    decimals = {a: answers[k].uint_or(18) for k, a in enumerate(wanted)}

    out: dict[str, tuple[int, ...]] = {}
    at = len(wanted)
    for address in holders:
        pool = next(p for p in pools if p.address.lower() == address)
        rates, lending = [], False
        for k in range(len(pool.coins)):
            stored, supply, accrued = answers[at], answers[at + 1], answers[at + 2]
            at += 3
            rate = LENDING_PRECISION
            if stored.ok and stored.uint_or(0):
                lending = True
                rate = stored.uint()
                rate += (rate * supply.uint_or(0)
                         * max(0, block - accrued.uint_or(block)) // LENDING_PRECISION)
            mul = 10 ** max(0, 18 - decimals.get(per_pool[address][k], 18))
            rates.append(mul * rate)
        if lending:
            out[address] = tuple(rates)
    return out


def build_exact_pools(pools, client, *, quiet: bool = True,
                      cache=None, resample=(), only=None) -> ExactPools:
    """Model every stableswap whose parameters reproduce its own `get_dy`."""
    out = ExactPools()
    wanted = [p for p in pools if _stable(p) and p.balances and all(p.balances)
              and (only is None or p.address.lower() in only)]
    if not wanted:
        return out

    # A metapool is the same invariant with the base pool's LP valued at its
    # `virtual_price` rather than at 1 -- so it is a *rates* problem, not a
    # solver problem.  `stored_rates()` reports this on the ng pools that have
    # it; on the older ones the LP coin reads as a plain 18-decimal token,
    # which is wrong by exactly the accrued yield.
    issuer = {p.lp_token.lower(): p.address for p in pools if p.lp_token}
    lp_coins = {
        pool.address.lower(): [
            issuer[coin.address.lower()] for coin in pool.coins
            if coin.address.lower() in issuer
        ]
        for pool in wanted
    }
    bases = sorted({a for v in lp_coins.values() for a in v})
    virtual: dict[str, int] = {}
    if bases:
        answers = client.raw([Call(a, encode_call("get_virtual_price()")) for a in bases])
        for address, answer in zip(bases, answers, strict=True):
            if answer.ok and answer.uint():
                virtual[address.lower()] = answer.uint()

    calls: list[Call] = []
    for pool in wanted:
        calls += [
            Call(pool.address, encode_call("A_precise()")),
            Call(pool.address, encode_call("A()")),
            Call(pool.address, encode_call("fee()")),
            Call(pool.address, encode_call("offpeg_fee_multiplier()")),
            # Only `exchange` needs this, never `get_dy`, so a pool that does
            # not report it still models and quotes; `StableSwap.exchange`
            # then refuses rather than assuming a flattering zero.
            Call(pool.address, encode_call("admin_fee()")),
        ]
    answers = client.raw(calls)

    # `stored_rates()` cannot come through the quoter: its `Res` struct holds one
    # `uint256`, so `raw_batch` hands back 32 bytes where a rates *array* is 128,
    # the first word being the ABI offset.  The truncation is silent and reads as
    # a valid answer, so every rate-bearing ng pool fell back to decimals-only
    # rates and modelled sUSDe as worth exactly one DOLA -- all 77 of the ng
    # rejections.  The transport returns whole returndata, so ask it directly.
    transport = getattr(client, "transport", None)
    rate_data: dict[str, bytes] = {}
    if transport is not None and hasattr(transport, "call_many"):
        wire_calls = [Call(p.address, encode_call("stored_rates()")) for p in wanted]
        for pool, answer in zip(wanted, transport.call_many(wire_calls), strict=True):
            if answer.ok and len(answer.data) >= 32 * len(pool.coins):
                rate_data[pool.address.lower()] = answer.data

    block = getattr(getattr(client, "transport", None), "block", 0) or getattr(
        client, "block", 0) or 0
    lending = _lending_rates(wanted, client, int(block)) if block else {}

    built: list[tuple[object, StableSwap, dict]] = []
    for k, pool in enumerate(wanted):
        precise, plain, fee, offpeg, admin = answers[5 * k : 5 * k + 5]
        if precise.ok and precise.uint():
            amp, a_precision, fee_on_xp = precise.uint(), 100, True
        elif plain.ok and plain.uint():
            amp, a_precision, fee_on_xp = plain.uint(), 1, False
        else:
            continue
        if not fee.ok:
            continue

        reported = _decode_rates(rate_data.get(pool.address.lower()),
                                 len(pool.coins))

        # The legacy shape: the rate is only the decimal correction -- except
        # for a base-pool LP, which is worth its virtual price.
        plain = tuple(10 ** (36 - c.decimals) for c in pool.coins)
        meta = tuple(
            virtual.get(issuer.get(c.address.lower(), "").lower(), 0)
            or 10 ** (36 - c.decimals)
            for c in pool.coins
        )
        candidates = []
        if len(reported) == len(pool.coins):
            candidates.append(("reported", reported))
        candidates.append(("plain", plain))
        if meta != plain:
            candidates.append(("meta", meta))
        lent = lending.get(pool.address.lower())
        if lent and lent != plain:
            candidates.append(("lending", lent))

        # Which convention this pool follows is asked, not assumed: the variants
        # are cheap to evaluate and only one of them can reproduce the chain to
        # the wei.  All are built whether or not a verdict predicts the winner,
        # so a stale verdict falls back to the gate instead of silently
        # dropping the pool.
        for label, rates in candidates:
            for on_xp in (fee_on_xp, not fee_on_xp):
                for minus_one in (True, False):
                    built.append((pool, StableSwap(
                        balances=tuple(int(b) for b in pool.balances),
                        rates=rates, amp=amp, fee=fee.uint(),
                        offpeg_fee_multiplier=offpeg.uint_or(0) or 0,
                        a_precision=a_precision, fee_on_xp=on_xp,
                        subtract_one=minus_one,
                        admin_fee=admin.uint_or(-1) if admin.ok else -1,
                    ), {"family": "stable", "rates": label, "fee_on_xp": on_xp,
                        "subtract_one": minus_one}))

    if not built:
        return out

    # --- and now make each one prove itself -------------------------------
    # One probe per pool, however many variants it produced: the quote is the
    # same question, and the variants are decided in Python against it.
    order: list[object] = []
    seen_pools: set[str] = set()
    for pool, _, _ in built:
        if pool.address.lower() not in seen_pools:
            seen_pools.add(pool.address.lower())
            order.append(pool)

    # A pool the cache has already seen prove itself does not prove itself
    # again: the gate establishes that a pool's *code* implements this
    # invariant, and Curve pools are not upgradeable.  `A`, the fee terms, the
    # ramp and the balances were all read fresh above, so what is trusted is
    # only "this variant, not one of the other five".
    order = [p for p in order
             if not _trust_verdict(out, cache, resample, built, p.address.lower())
             and not (cache is not None and cache.skip(p.address, p.balances))]

    probes, where = [], []
    for pool in order:
        for i, j in ((0, 1), (1, 0)):
            for frac in CHECK_FRACTIONS:
                probes.append(Probe(pool.address, ArcKind.SWAP_STABLE, i, j,
                                    len(pool.coins),
                                    max(1, int(pool.balances[i] * frac))))
                where.append(pool.address.lower())
    quotes = client.probe(probes)
    truth: dict[str, list] = {}
    for address, probe, quote in zip(where, probes, quotes, strict=True):
        truth.setdefault(address, []).append((probe, quote))

    for pool in order:
        out.checked += 1
        key = pool.address.lower()
        points = [(pr, q) for pr, q in truth.get(key, []) if q.ok and q.value > 0]
        if not points:
            # Recorded, not just reported: a pool that answers nothing is
            # empty or holds dust, and re-deriving that costs a probe per size
            # per direction on every run for as long as it stays that way.
            out.rejected.append((pool.address, "pool would not quote the check"))
            if cache is not None:
                cache.refuse(key, "would not quote", balances=pool.balances)
            continue
        best: str = ""
        for candidate_pool, model, variant in built:
            if candidate_pool.address.lower() != key:
                continue
            failed = ""
            for probe, quote in points:
                try:
                    mine = model.get_dy(probe.i, probe.j, probe.dx)
                except StableSwapError as exc:
                    failed = str(exc)[:40]
                    break
                # Not a tolerance.  Agreeing to the wei at *every* point is
                # the evidence that every parameter was read correctly.
                if mine != quote.value:
                    failed = f"{mine} != {quote.value} at {probe.dx}"
                    break
            if not failed:
                out.by_pool[key] = model
                if cache is not None:
                    cache.record(key, variant)
                break
            best = best or failed
        else:
            why = best or "no variant matched"
            out.rejected.append((pool.address, why))
            if cache is not None:
                cache.refuse(key, why, balances=pool.balances)

    # The lending pools reach the same holder by a different road: their coin
    # list runs past their balances, so the filter at the top of this function
    # never sees them, and their rates come from the wrappers rather than from
    # `stored_rates()`.  `lending_params` settles both and picks each pool's
    # variant by reproducing its own `get_dy` -- this gate, one level down.
    block = (getattr(getattr(client, "transport", None), "block", None)
             or getattr(client, "block", None))
    if block and only is None:
        try:
            lent, refused = build_exact_lending(pools, client, block=int(block))
        except Exception as exc:  # a reader must not fail a quote
            lent, refused = {}, [("lending", str(exc))]
        out.by_pool.update(lent)
        out.checked += len(lent) + len(refused)
        out.rejected.extend(refused)
        if cache is not None:
            for key in lent:
                cache.readmit(key)
        if lent and not quiet:
            print(f"  exact lending: {len(lent)} wrapped-token pools")

        # And the ones the ordinary reading could not reproduce: a coin whose
        # value is not one (rETH, ankrETH) or a moving target like RAI's
        # redemption price.  Only the rejects are retried, so a pool that models
        # correctly with a plain rate cannot be talked out of it.
        stubborn = {a.lower() for a, _ in out.rejected}
        if stubborn:
            try:
                rated = build_exact_rate_pools(
                    pools, client, addresses=stubborn,
                    # `virtual` is keyed by the *issuing pool*; the retry wants
                    # it keyed by the LP token it is the price of.
                    virtual={token: virtual[owner.lower()]
                             for token, owner in issuer.items()
                             if owner.lower() in virtual})
            except Exception:  # a reader must not fail a quote
                rated = {}
            if rated:
                out.by_pool.update(rated)
                out.rejected = [(a, w) for a, w in out.rejected
                                if a.lower() not in rated]
                # Withdraw the refusal this reader just overturned.  Left
                # standing, `skip` fires before the gate next run, the pool
                # never reaches `rejected`, and `rejected` is what feeds here.
                if cache is not None:
                    for key in rated:
                        cache.readmit(key)
                if not quiet:
                    print(f"  exact rate pools: {len(rated)} with wrapper rates")

    if not quiet:
        print(f"  exact stableswap: {len(out)} of {out.checked} pools reproduce "
              f"their own get_dy to the wei")
    return out
