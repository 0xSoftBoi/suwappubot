"""Read what a twocrypto-ng pool needs to be evaluated instead of probed.

The factory deploys two pools indistinguishable by type, name or coins:
cryptoswap proper, and the "FX Swap" -- a *stableswap* invariant wearing
cryptoswap's machinery.  Which one a pool is, is decided by the math contract it
holds as an immutable.

**This does not read that address.**  It builds the FX Swap model for every
twocrypto pool and lets the wei-exact check decide: a cryptoswap pool cannot
reproduce its own `get_dy` from a stableswap invariant, so it fails and keeps
being probed.  That rule works on a chain nobody has surveyed and cannot go
stale when a new math implementation is deployed; an address list does neither.

Two exclusions are made up front, because the check cannot see them:

* **a `POLICY` contract.**  `_fee` asks it first, and `Policy.get_fee(xp)` takes
  the balances -- so the fee may vary with trade size, and one probe would agree
  at the size it was taken and disagree elsewhere.
* **an A/gamma ramp in progress.**  `D` then comes from `newton_D` rather than
  storage, and `newton_D` is not implemented here yet.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import product

from ..core.codec import decode, encode_call
from ..core.transport import Call
from ..core.twocrypto import Twocrypto, TwocryptoError
from ..core.types import ArcKind, Probe
from .exact_cache import trust as _trust_verdict

#: Sizes to check at, in both directions -- see `stable_params` for why one
#: point is not enough.  Here it is load-bearing rather than prudent: telling an
#: FX Swap from a cryptoswap pool *is* the check, and two invariants can agree
#: at a single size by coincidence.
CHECK_FRACTIONS = (0.001, 0.01, 0.1)
UINT64 = 2**64 - 1


@dataclass(slots=True)
class ExactTwocrypto:
    by_pool: dict[str, Twocrypto] = field(default_factory=dict)
    checked: int = 0
    #: Admitted on a remembered verdict, without re-gating.
    trusted: int = 0
    rejected: list[tuple[str, str]] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.by_pool)

    def get(self, pool: str):
        return self.by_pool.get(pool.lower())


def _candidates(pools):
    for pool in pools:
        if len(pool.coins) != 2 or not pool.balances or not all(pool.balances):
            continue
        if getattr(pool, "swap_kind", None) is not ArcKind.SWAP_CRYPTO:
            continue
        yield pool


def model_for(built, key):
    for pool, model in built:
        if pool.address.lower() == key:
            return model
    raise KeyError(key)


def build_exact_twocrypto(pools, client, *, quiet: bool = True,
                          cache=None, resample=(), only=None) -> ExactTwocrypto:
    """Model every twocrypto pool that reproduces its own `get_dy`."""
    out = ExactTwocrypto()
    wanted = [p for p in _candidates(pools)
              if only is None or p.address.lower() in only]
    if not wanted:
        return out

    calls: list[Call] = []
    for pool in wanted:
        calls += [
            Call(pool.address, encode_call("price_scale()")),
            Call(pool.address, encode_call("D()")),
            Call(pool.address, encode_call("A()")),
            Call(pool.address, encode_call("gamma()")),
            Call(pool.address, encode_call("packed_fee_params()")),
            Call(pool.address, encode_call("POLICY()")),
            Call(pool.address, encode_call("future_A_gamma_time()")),
            Call(pool.address, encode_call("last_timestamp()")),
            # The pre-factory generation keeps these unpacked, as three
            # public variables.  Requiring `packed_fee_params()` silently
            # dropped all 43 of those pools.
            Call(pool.address, encode_call("mid_fee()")),
            Call(pool.address, encode_call("out_fee()")),
            Call(pool.address, encode_call("fee_gamma()")),
        ]
    answers = client.raw(calls)

    # `precisions()` returns two words, which the quoter's one-word `Res` cannot
    # carry -- the same truncation that made every rate-bearing stableswap look
    # wrong.  Ask the transport, which returns whole returndata.
    transport = getattr(client, "transport", None)
    precisions: dict[str, tuple[int, int]] = {}
    if transport is not None and hasattr(transport, "call_many"):
        wire = [Call(p.address, encode_call("precisions()")) for p in wanted]
        for pool, answer in zip(wanted, transport.call_many(wire), strict=True):
            if answer.ok and len(answer.data) >= 64:
                try:
                    got = decode(["uint256[2]"], answer.data)[0]
                except Exception:
                    continue
                precisions[pool.address.lower()] = (int(got[0]), int(got[1]))
    # The pre-factory generation keeps its precisions internal, with no getter
    # to read -- they are just the decimal corrections.
    for pool in wanted:
        precisions.setdefault(
            pool.address.lower(),
            tuple(10 ** (18 - coin.decimals) for coin in pool.coins[:2]),
        )

    # A pool with a `POLICY` is only unmodellable if the policy actually
    # charges.  `_fee` asks it first and falls back to the pool's own mid/out
    # curve when the answer is zero -- which is what the Yield Basis policy
    # does; it steers the *price scale*, not the fee.
    #
    # Asked at two balance vectors a decade apart, because what the blanket
    # rejection guarded against is a fee that varies with size: one answering
    # zero at both is not that.  The wei-exact gate then checks the whole model
    # at three more sizes anyway.
    policy_charges: dict[str, bool] = {}
    with_policy = [(pool, answers[11 * k + 5]) for k, pool in enumerate(wanted)]
    probes: list[Call] = []
    asked: list[str] = []
    for pool, policy in with_policy:
        if not (policy.ok and policy.uint()):
            continue
        where = f"0x{policy.uint():040x}"
        xp = [int(b) for b in pool.balances[:2]]
        for scale_by in (1, 10):
            probes.append(Call(where, encode_call(
                "get_fee(uint256[2])", [v * scale_by for v in xp])))
            asked.append(pool.address.lower())
    if probes:
        for address, answer in zip(asked, client.raw(probes), strict=True):
            if not answer.ok:
                policy_charges[address] = True          # unreadable: assume it charges
            elif answer.uint() != 0:
                policy_charges[address] = True
            else:
                policy_charges.setdefault(address, False)

    built: list[tuple[object, Twocrypto, dict]] = []
    for k, pool in enumerate(wanted):
        (scale, d, amp, gamma, packed, policy, ramp_until, last,
         mid_raw, out_raw, gamma_raw) = answers[11 * k : 11 * k + 11]
        key = pool.address.lower()
        if key not in precisions:
            continue
        unpacked = mid_raw.ok and out_raw.ok and gamma_raw.ok
        if not (scale.ok and d.ok and amp.ok and (packed.ok or unpacked)):
            continue
        if policy.ok and policy.uint():
            charging = policy_charges.get(key)
            if charging is not False:
                out.rejected.append((
                    pool.address,
                    "POLICY charges a fee" if charging else "POLICY would not answer"))
                continue
        # The factory generation recomputes `D` whenever `future_A_gamma_time`
        # is set at all -- `> 0`, not `> last_timestamp` -- so a pool that has
        # ever ramped needs `newton_D`, which is not implemented here.  The
        # newer pools only recompute while actually ramping.
        ramping = ramp_until.uint_or(0) or 0
        legacy_possible = ramping == 0
        if ramp_until.ok and last.ok and ramping > last.uint():
            out.rejected.append((pool.address, "A/gamma ramp in progress"))
            continue
        if packed.ok:
            blob = packed.uint()
            mid_fee = (blob >> 128) & UINT64
            out_fee = (blob >> 64) & UINT64
            fee_gamma = blob & UINT64
        else:
            mid_fee, out_fee = mid_raw.uint(), out_raw.uint()
            fee_gamma = gamma_raw.uint()
        # Every combination, and the wei-exact check decides which this pool is:
        # the invariant (FX Swap or cryptoswap), which of the two deployed
        # `_fee` formulas it implements, and which math version bounds it.  An
        # address list would rot the day a new implementation is deployed.
        for stable, legacy_fee, v21, legacy_pool, legacy_mul2 in product(
                (True, False), (False, True), (True, False), (False, True),
                (False, True)):
            if stable and not v21:
                continue  # `v21` only selects cryptoswap bounds
            if legacy_pool and (stable or not legacy_fee or not v21):
                continue  # the old generation is Newton with the old fee
            if legacy_pool and not legacy_possible:
                continue
            if legacy_mul2 and not legacy_pool:
                continue  # only the inline Newton has the second spelling
            built.append((pool, Twocrypto(
                balances=(int(pool.balances[0]), int(pool.balances[1])),
                precisions=precisions[key],
                price_scale=scale.uint(),
                d=d.uint(),
                amp=amp.uint(),
                gamma=gamma.uint_or(0) or 0,
                mid_fee=mid_fee,
                out_fee=out_fee,
                fee_gamma=fee_gamma,
                stable=stable,
                legacy_fee=legacy_fee,
                v21=v21,
                legacy_pool=legacy_pool,
                legacy_mul2=legacy_mul2,
            ), {"family": "twocrypto", "stable": stable,
                "legacy_fee": legacy_fee, "v21": v21,
                "legacy_pool": legacy_pool, "legacy_mul2": legacy_mul2}))

    if not built:
        return out

    order: list[object] = []
    seen: set[str] = set()
    for pool, _, _ in built:
        key = pool.address.lower()
        if key not in seen:
            seen.add(key)
            order.append(pool)
    # A pool that has already proved itself is admitted on the verdict.  What is
    # trusted is only which of the sixteen variants it is, never a number: `D`,
    # `A`, `gamma`, the fee terms, `POLICY` and the ramp are all read fresh.
    order = [p for p in order
             if not _trust_verdict(out, cache, resample, built, p.address.lower())
             and not (cache is not None and cache.skip(p.address, p.balances))]

    probes, at = [], []
    for pool in order:
        for i, j in ((0, 1), (1, 0)):
            for frac in CHECK_FRACTIONS:
                probes.append(Probe(pool.address, ArcKind.SWAP_CRYPTO, i, j, 2,
                                    max(1, int(pool.balances[i] * frac))))
                at.append(pool.address.lower())
    quotes = client.probe(probes)
    truth: dict[str, list] = {}
    for address, probe, quote in zip(at, probes, quotes, strict=True):
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
        best = ""
        for candidate, model, variant in built:
            if candidate.address.lower() != key:
                continue
            failed = ""
            for probe, quote in points:
                try:
                    mine = model.get_dy(probe.i, probe.j, probe.dx)
                except (TwocryptoError, ZeroDivisionError) as exc:
                    failed = str(exc)[:40]
                    break
                if mine != quote.value:
                    # Usually "this is a cryptoswap pool, not an FX Swap", or
                    # the other `_fee`.  One point would not separate them.
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

    if not quiet:
        print(f"  exact twocrypto: {len(out)} of {out.checked} pools reproduce "
              f"their own get_dy to the wei")
    return out
