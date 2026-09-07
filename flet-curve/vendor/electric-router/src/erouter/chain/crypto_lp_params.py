"""Cryptoswap withdrawal models, admitted the same way everything else is.

Cryptoswap *swaps* have been modelled since the exact path existed; their LP
legs never were, so every cryptoswap deposit and withdrawal went over the wire
as a probe.  That costs a round trip where the arithmetic is 15 us, leaves those
arcs calibrated at whatever size the coarse grid happened to use, and is why
`ExactQuoterClient` refuses to advance a cryptoswap pool between legs at all --
there was no model to advance.

Only the withdrawal is modelled.  A cryptoswap deposit's own
`calc_token_amount` already charges the fee `add_liquidity` charges -- measured
against execution on every tricrypto pool on Ethereum, view and execution agree
to the wei -- so a second implementation would add risk and correct nothing.

The gate does real work here: the 2021 tricrypto generation computes its
withdrawal differently, and asking it to reproduce `calc_withdraw_one_coin` is
what tells the two apart rather than a guess from the pool's name or factory.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.codec import encode_call
from ..core.transport import Call
from ..core.tricrypto import TricryptoError, TricryptoLP

#: Fractions of total supply to burn in the check.  Three decades, because a
#: fee charged on an imprecise post-withdrawal balance agrees at one size and
#: drifts at another -- the legacy pools pass at 0.01%, are 1.26 bp out at 1%.
CHECK_FRACTIONS = (0.0001, 0.001, 0.01)


@dataclass(slots=True)
class ExactCryptoLP:
    by_pool: dict[str, TricryptoLP] = field(default_factory=dict)
    checked: int = 0
    rejected: list[tuple[str, str]] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.by_pool)

    def get(self, pool: str):
        return self.by_pool.get(pool.lower())


def build_exact_crypto_lp(pools, tricrypto, client, *, quiet: bool = True) -> ExactCryptoLP:
    """Model the withdrawal of every crypto pool whose swap model reproduces.

    Same precondition as the stableswap LP models: `D`, `A`, `gamma`, the price
    scale and the fee parameters all come from the swap model, so a pool whose
    swaps do not reproduce has no business being trusted for its LP arcs.
    """
    out = ExactCryptoLP()
    wanted = [p for p in pools
              if p.lp_supply and tricrypto is not None
              and tricrypto.get(p.address) is not None]
    if not wanted:
        return out

    built = [(p, TricryptoLP(pool=tricrypto.get(p.address), total_supply=p.lp_supply))
             for p in wanted]
    calls, at = [], []
    for pool, model in built:
        for frac in CHECK_FRACTIONS:
            burn = max(1, int(model.total_supply * frac))
            calls.append(Call(pool.address,
                              encode_call("calc_withdraw_one_coin(uint256,uint256)",
                                          burn, 0)))
            at.append((pool.address.lower(), burn))
    answers = client.raw(calls)

    truth: dict[str, list] = {}
    for (address, burn), answer in zip(at, answers, strict=True):
        truth.setdefault(address, []).append((burn, answer))

    for pool, model in built:
        out.checked += 1
        key = pool.address.lower()
        points = [(b, a) for b, a in truth.get(key, []) if a.ok and a.uint() > 0]
        if not points:
            out.rejected.append((pool.address, "pool would not quote the check"))
            continue
        failed = ""
        for burn, answer in points:
            try:
                mine = model.calc_withdraw_one_coin(burn, 0)
            except (TricryptoError, ZeroDivisionError, IndexError) as exc:
                failed = str(exc)[:44]
                break
            if mine != answer.uint():
                failed = f"{mine} != {answer.uint()} burning {burn}"
                break
        if failed:
            out.rejected.append((pool.address, failed))
        else:
            out.by_pool[key] = model

    if not quiet:
        print(f"  exact crypto LP: {len(out)} of {out.checked} pools reproduce "
              f"their own calc_withdraw_one_coin to the wei")
    return out
