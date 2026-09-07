"""Read what a tricrypto pool needs to be evaluated instead of probed.

Same shape as the two-coin readers and the same rule: build the model, quote
the pool for real, and keep it only if the arithmetic reproduces the answer to
the wei at every point.  Nothing is decided by pool type or by an address list.

`D` is read from storage, so a pool mid-A/gamma-ramp is refused rather than
approximated -- `newton_D` is not implemented here.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.codec import decode, encode_call
from ..core.transport import Call
from ..core.tricrypto import Tricrypto, TricryptoError
from ..core.types import ArcKind, Probe
from .exact_cache import trust as _trust_verdict

CHECK_FRACTIONS = (0.001, 0.01, 0.1)
#: Every ordered pair touching all three coins -- a two-coin ladder would leave
#: one coin's precision and price scale unexercised.
CHECK_PAIRS = ((0, 1), (1, 0), (0, 2), (2, 0), (1, 2), (2, 1))
UINT64 = 2**64 - 1


@dataclass(slots=True)
class ExactTricrypto:
    by_pool: dict[str, Tricrypto] = field(default_factory=dict)
    checked: int = 0
    #: Admitted on a remembered verdict, without re-gating.
    trusted: int = 0
    rejected: list[tuple[str, str]] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.by_pool)

    def get(self, pool: str):
        return self.by_pool.get(pool.lower())


def build_exact_tricrypto(pools, client, *, quiet: bool = True,
                          cache=None, resample=(), only=None) -> ExactTricrypto:
    """Model every three-coin crypto pool that reproduces its own `get_dy`."""
    out = ExactTricrypto()
    wanted = [
        p for p in pools
        if len(p.coins) == 3 and p.balances and all(p.balances)
        and (only is None or p.address.lower() in only)
        and getattr(p, "swap_kind", None) is ArcKind.SWAP_CRYPTO
    ]
    if not wanted:
        return out

    calls: list[Call] = []
    for pool in wanted:
        calls += [
            Call(pool.address, encode_call("D()")),
            Call(pool.address, encode_call("A()")),
            Call(pool.address, encode_call("gamma()")),
            Call(pool.address, encode_call("packed_fee_params()")),
            Call(pool.address, encode_call("future_A_gamma_time()")),
            Call(pool.address, encode_call("last_timestamp()")),
            Call(pool.address, encode_call("price_scale(uint256)", 0)),
            Call(pool.address, encode_call("price_scale(uint256)", 1)),
            # The 2021 pools keep the three fees as separate getters; the
            # optimized math packs them into one word.  Asking for both costs
            # three calls a pool and is what lets tricrypto2 be modelled at all
            # -- without it a $10M pool on the main BTC/ETH path falls through
            # to the EVM, and every route touching it with it.
            Call(pool.address, encode_call("mid_fee()")),
            Call(pool.address, encode_call("out_fee()")),
            Call(pool.address, encode_call("fee_gamma()")),
            # `A()` does not mean the same thing across the generations: the
            # 2021 tricrypto2 returns `A * N**N * A_MULTIPLIER`, while the 2021
            # *v1* pool divides that by `A_MULTIPLIER` and keeps the raw value
            # under `A_precise()`, which is what its own views contract reads.
            # Taking `A()` from a v1 pool is off by 10,000 and quotes it 3.5x
            # wrong.  Prefer `A_precise()` where there is one.
            Call(pool.address, encode_call("A_precise()")),
        ]
    answers = client.raw(calls)

    # `precisions()` returns three words, which the quoter's one-word `Res`
    # cannot carry.  The transport returns whole returndata.
    transport = getattr(client, "transport", None)
    precisions: dict[str, tuple[int, int, int]] = {}
    if transport is not None and hasattr(transport, "call_many"):
        wire = [Call(p.address, encode_call("precisions()")) for p in wanted]
        for pool, answer in zip(wanted, transport.call_many(wire), strict=True):
            if answer.ok and len(answer.data) >= 96:
                try:
                    got = decode(["uint256[3]"], answer.data)[0]
                except Exception:
                    continue
                precisions[pool.address.lower()] = tuple(int(v) for v in got)
    for pool in wanted:
        precisions.setdefault(
            pool.address.lower(),
            tuple(10 ** (18 - coin.decimals) for coin in pool.coins[:3]),
        )

    built: list[tuple[object, Tricrypto, dict]] = []
    for k, pool in enumerate(wanted):
        (d, amp, gamma, packed, ramp_until, last, ps0, ps1,
         mid, out_f, fee_g, amp_precise) = answers[12 * k : 12 * k + 12]
        # `A_precise() / A()` *is* the multiplier, read off the pool rather
        # than guessed from its vintage.
        a_multiplier = 10_000
        if amp_precise.ok:
            if amp.ok and amp.uint() > 0:
                ratio = amp_precise.uint() // amp.uint()
                a_multiplier = 100 if ratio < 1_000 else 10_000
            else:
                a_multiplier = 100
            amp = amp_precise
        if not (d.ok and amp.ok and ps0.ok and ps1.ok):
            continue
        legacy = not packed.ok
        if legacy and not (mid.ok and out_f.ok and fee_g.ok):
            continue
        if ramp_until.ok and last.ok and ramp_until.uint() > last.uint():
            out.rejected.append((pool.address, "A/gamma ramp in progress"))
            continue
        if legacy:
            fees = (mid.uint(), out_f.uint(), fee_g.uint())
        else:
            blob = packed.uint()
            fees = ((blob >> 128) & UINT64, (blob >> 64) & UINT64, blob & UINT64)
        built.append((pool, Tricrypto(
            balances=tuple(int(b) for b in pool.balances[:3]),
            precisions=precisions[pool.address.lower()],
            price_scale=(ps0.uint(), ps1.uint()),
            d=d.uint(),
            amp=amp.uint(),
            gamma=gamma.uint_or(0) or 0,
            mid_fee=fees[0],
            out_fee=fees[1],
            fee_gamma=fees[2],
            legacy=legacy,
            a_multiplier=a_multiplier,
        ), {"family": "tricrypto-2021" if legacy else "tricrypto"}))

    if not built:
        return out

    # Already proved itself: admitted on the verdict.  There is only one
    # variant here, so what the cache saves is the six-point gate rather than a
    # search -- and, more to the point, it says so *before* anything is warmed.
    gate = {pool.address.lower() for pool, _, _ in built
            if not _trust_verdict(out, cache, resample, built,
                                  pool.address.lower())}
    order = [pool for pool, _, _ in built
             if pool.address.lower() in gate
             and not (cache is not None and cache.skip(pool.address, pool.balances))]

    probes, at = [], []
    for pool in order:
        for i, j in CHECK_PAIRS:
            for frac in CHECK_FRACTIONS:
                probes.append(Probe(pool.address, ArcKind.SWAP_CRYPTO, i, j, 3,
                                    max(1, int(pool.balances[i] * frac))))
                at.append(pool.address.lower())
    quotes = client.probe(probes)
    truth: dict[str, list] = {}
    for address, probe, quote in zip(at, probes, quotes, strict=True):
        truth.setdefault(address, []).append((probe, quote))

    for pool, model, variant in built:
        if pool.address.lower() not in gate:
            continue
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
        failed = ""
        for probe, quote in points:
            try:
                mine = model.get_dy(probe.i, probe.j, probe.dx)
            except (TricryptoError, ZeroDivisionError) as exc:
                failed = str(exc)[:40]
                break
            if mine != quote.value:
                failed = f"{mine} != {quote.value} at {probe.dx}"
                break
        if failed:
            out.rejected.append((pool.address, failed))
            if cache is not None:
                cache.refuse(key, failed, balances=pool.balances)
        else:
            out.by_pool[key] = model
            if cache is not None:
                cache.record(key, variant)

    if not quiet:
        print(f"  exact tricrypto: {len(out)} of {out.checked} pools reproduce "
              f"their own get_dy to the wei")
    return out
