"""Read what a pool's LP arcs need to be evaluated instead of probed.

Deposits and withdrawals run the invariant the swap models already reproduce;
what is new is that `D` itself moves, and that each operation has its own fee
convention.  Both are settled by the deployed source rather than assumed --
`calc_token_amount` takes no fee on the legacy pools, `calc_withdraw_one_coin`
charges on the imbalance -- and then checked the same way as everything else
here: build it, ask the pool, keep it only if the arithmetic reproduces the
answer to the wei at every point.

Only pools whose *swap* model was already admitted are candidates.  That is the
precondition, not a shortcut: `D`, `A`, the rates and the fee all come from that
model.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.codec import encode_call
from ..core.stableswap import StableSwapError, StableSwapLP
from ..core.transport import Call
from ..core.types import ArcKind, Probe

#: Fractions of total supply to check a withdrawal at, and of each balance for
#: a deposit.  Three decades, because a fee charged on an imbalance is exactly
#: the kind of term that agrees at one size and not another.
CHECK_FRACTIONS = (0.0001, 0.001, 0.01)

WITHDRAW = ArcKind.WITHDRAW_STABLE
DEPOSITS = (ArcKind.DEPOSIT_FIXED, ArcKind.DEPOSIT_DYN,
            ArcKind.DEPOSIT_FIXED_NOFLAG)


@dataclass(slots=True)
class ExactLP:
    """Admitted per direction, because the two are separate claims.

    A pool's deposit arithmetic can reproduce to the wei while its withdrawal
    does not -- `calc_withdraw_one_coin` charges on the imbalance and
    `calc_token_amount` does not, so they exercise different code -- and
    rejecting the pool wholesale on the withdrawal throws away a deposit model
    measured to be correct.  On Ethereum that rejected 111 pools, and each of
    their deposits then went to the chain and came back overstated by up to
    22 bp, since `calc_token_amount` is fee-free on the legacy pools.  Same
    shape as the lending wrappers, which are per-direction for the same reason.
    """

    by_pool: dict[str, StableSwapLP] = field(default_factory=dict)
    deposits: dict[str, StableSwapLP] = field(default_factory=dict)
    checked: int = 0
    rejected: list[tuple[str, str]] = field(default_factory=list)
    rejected_deposits: list[tuple[str, str]] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.by_pool)

    def get(self, pool: str):
        """The withdrawal model.  Named for history; `get_deposit` is the twin."""
        return self.by_pool.get(pool.lower())

    def get_deposit(self, pool: str):
        return self.deposits.get(pool.lower())


def build_exact_lp(pools, swaps, client, *, quiet: bool = True) -> ExactLP:
    """Model the LP arcs of every pool whose swap model already reproduces."""
    out = ExactLP()
    wanted = [p for p in pools if swaps.get(p.address) is not None]
    if not wanted:
        return out

    supplies = client.raw([Call(p.address, encode_call("totalSupply()"))
                           for p in wanted])
    # A pool whose LP token is a separate contract reports supply there.
    missing = [p for p, s in zip(wanted, supplies, strict=True)
               if not (s.ok and s.uint())]
    extra = {}
    if missing:
        answers = client.raw([Call(p.lp_token, encode_call("totalSupply()"))
                              for p in missing if p.lp_token])
        for pool, answer in zip([p for p in missing if p.lp_token], answers,
                                strict=True):
            if answer.ok and answer.uint():
                extra[pool.address.lower()] = answer.uint()

    built: list[tuple[object, StableSwapLP]] = []
    for pool, supply in zip(wanted, supplies, strict=True):
        total = supply.uint() if (supply.ok and supply.uint()) else \
            extra.get(pool.address.lower(), 0)
        if total <= 0:
            continue
        built.append((pool, StableSwapLP(pool=swaps.get(pool.address),
                                         total_supply=total)))
    if not built:
        return out

    calls, at = [], []
    for pool, model in built:
        for frac in CHECK_FRACTIONS:
            burn = max(1, int(model.total_supply * frac))
            calls.append(Call(pool.address,
                              encode_call("calc_withdraw_one_coin(uint256,int128)",
                                          burn, 0)))
            at.append((pool.address.lower(), WITHDRAW, burn, 0))
    answers = client.raw(calls)

    truth: dict[str, list] = {}
    for (address, kind, size, i), answer in zip(at, answers, strict=True):
        truth.setdefault(address, []).append((kind, size, i, answer))

    for pool, model in built:
        out.checked += 1
        key = pool.address.lower()
        points = [(k, s, i, a) for k, s, i, a in truth.get(key, [])
                  if a.ok and a.uint() > 0]
        if not points:
            out.rejected.append((pool.address, "pool would not quote the check"))
            continue
        failed = ""
        for _kind, size, i, answer in points:
            try:
                mine = model.calc_withdraw_one_coin(size, i)
            except (StableSwapError, ZeroDivisionError) as exc:
                failed = str(exc)[:44]
                break
            if mine != answer.uint():
                failed = f"{mine} != {answer.uint()} burning {size}"
                break
        if failed:
            out.rejected.append((pool.address, failed))
        else:
            out.by_pool[key] = model

    _admit_deposits(built, client, out)

    if not quiet:
        print(f"  exact LP: {len(out)} of {out.checked} pools reproduce their own "
              f"calc_withdraw_one_coin to the wei, {len(out.deposits)} their "
              f"own calc_token_amount")
    return out


def _admit_deposits(built, client, out: ExactLP) -> None:
    """Admit the deposit direction on its own evidence.

    **What the chain answers here is not one quantity but two.**  Stableswap-NG
    charges the imbalance fee inside `calc_token_amount`; the legacy pools do
    not, and only take it in `add_liquidity` itself.  Measured against real
    execution, NG agrees to the wei and legacy overstates by `fee/2` on a
    one-sided deposit -- 0.055 bp on gnosis 3pool, 22 bp on an imbalanced
    factory pool.

    So a match against *either* convention proves the same thing: the invariant
    arithmetic reproduces this pool.  Pricing uses `calc_token_amount_charged`
    regardless, because `add_liquidity` always charges.
    """
    probes, at = [], []
    for pool, _model in built:
        kind = ArcKind.DEPOSIT_DYN if pool.dynamic_arrays else ArcKind.DEPOSIT_FIXED
        for frac in CHECK_FRACTIONS:
            if not pool.balances or not pool.balances[0]:
                continue
            dx = max(1, int(pool.balances[0] * frac))
            probes.append(Probe(pool=pool.address, kind=kind, i=0, j=0,
                                n=pool.n_coins, dx=dx))
            at.append((pool.address.lower(), dx))
    if not probes:
        return
    quotes = client.probe(probes)

    truth: dict[str, list] = {}
    for (address, dx), quote in zip(at, quotes, strict=True):
        truth.setdefault(address, []).append((dx, quote))

    for pool, model in built:
        key = pool.address.lower()
        points = [(dx, q) for dx, q in truth.get(key, []) if q.ok and q.value > 0]
        if not points:
            out.rejected_deposits.append((pool.address, "pool would not quote a deposit"))
            continue
        charged = free = True
        failure = ""
        for dx, quote in points:
            amounts = [0] * model.n
            amounts[0] = dx
            try:
                mine_charged = model.calc_token_amount_charged(amounts)
                mine_free = model.calc_token_amount(amounts, True)
            except (StableSwapError, ZeroDivisionError, IndexError) as exc:
                charged = free = False
                failure = str(exc)[:44]
                break
            charged = charged and mine_charged == quote.value
            free = free and mine_free == quote.value
            if not (charged or free):
                failure = (f"charged {mine_charged} / free {mine_free} "
                           f"!= {quote.value} depositing {dx}")
                break
        if charged or free:
            out.deposits[key] = model
        else:
            out.rejected_deposits.append((pool.address, failure))
