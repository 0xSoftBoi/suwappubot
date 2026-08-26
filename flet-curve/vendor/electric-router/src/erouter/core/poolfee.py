"""What a pool charges on a trade of a given size, from its own model.

A dynamic fee is a property of the trade, not of the pool.  Cryptoswap slides
from `mid_fee` toward `out_fee` as the trade skews the balances, and
stableswap-ng multiplies its fee by how far off the peg the trade leaves it --
several times the nominal rate, which is exactly the regime a large trade
creates.  The marginal fee two tiny probes measure is therefore the fee nobody
is about to pay.

The models already charge it correctly -- that is what makes them wei-exact --
so the fee is read back out of them rather than re-derived: quote the trade
twice, once as the pool is and once with its fee fields zeroed, and the gap is
what it took.  Re-deriving would mean a fourth copy of three different fee
conventions, and a copy that drifts from the model is worse than no copy: it
would move a minimum rate without moving the quote it is supposed to bound.
"""

from __future__ import annotations

from dataclasses import fields, replace

#: The fee knobs across the three families.  A model carries some subset;
#: `fee_gamma` and `admin_fee` are deliberately absent, being the shape of the
#: fee curve and the DAO's cut of it rather than the charge itself.
FEE_FIELDS = ("fee", "offpeg_fee_multiplier", "mid_fee", "out_fee")

#: Every Curve family prices its fee in 1e10.
FEE_DENOMINATOR = 10**10


def fee_free(model):
    """The same pool with nothing to charge, or `None` if it cannot be made.

    Twocrypto-ng clamps its fee at `MIN_FEE`, 0.1 bp, so its twin still charges
    that.  The fee comes back 0.1 bp light, which tightens the bound derived
    from it rather than loosening it, and sits under the floor applied anyway.
    """
    try:
        names = {f.name for f in fields(model)}
    except TypeError:
        return None                                # not a dataclass model
    zeroed = {name: 0 for name in FEE_FIELDS if name in names}
    return replace(model, **zeroed) if zeroed else None


def floor_fee(model) -> float | None:
    """The least this pool can ever charge, or `None` if it will not say.

    What a minimum rate has to be set from, because it is what the *attacker*
    pays.  A sandwich front-runs and unwinds in small, balanced trades, so it
    is charged near `mid_fee` while the trade it is wrapped around pays the
    dynamic fee at its own size -- measured on TricryptoUSDC, 3 bp against
    13 bp.  Bounding on the larger of the two hands the difference over.

    Stableswap's off-peg multiplier only ever raises its fee, so the nominal
    one is that family's floor.
    """
    mid, out = getattr(model, "mid_fee", None), getattr(model, "out_fee", None)
    if mid is not None and out is not None:
        return min(int(mid), int(out)) / FEE_DENOMINATOR
    flat = getattr(model, "fee", None)
    return None if flat is None else int(flat) / FEE_DENOMINATOR


def charged_fee(model, i: int, j: int, dx: int) -> float | None:
    """The fraction this trade pays in fees, or `None` if it cannot be priced."""
    free = fee_free(model)
    if free is None or dx <= 0:
        return None
    try:
        gross = free.get_dy(i, j, dx)
        net = model.get_dy(i, j, dx)
    except Exception:                              # a model that will not quote
        return None
    if gross <= 0 or net <= 0 or net > gross:
        return None
    return 1.0 - net / gross
