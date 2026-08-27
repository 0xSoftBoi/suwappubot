"""Import ``bot/utils/money.py`` without importing the ``bot`` package.

``bot/utils/__init__.py`` eagerly imports the encryption stack, which pulls in native
crypto bindings. The replayer must run anywhere a ``DATABASE_URL`` does - a bare
container, a CI box, an analyst's laptop - so it cannot inherit that dependency, and
Tektonic's lean-dependency lesson is the whole reason the reconstruction stayed
reproducible.

There is still exactly one source of truth for money arithmetic: this loads that same
file by path, it does not reimplement it.
"""

from __future__ import annotations

import importlib.util
import os
import sys

_MONEY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "bot",
    "utils",
    "money.py",
)


def _load():
    try:  # normal path: the bot package imports cleanly
        from bot.utils import money as _m

        return _m
    except BaseException:
        # BaseException, not Exception: a broken native crypto binding surfaces as a
        # pyo3 PanicException, which does not inherit from Exception.
        pass
    spec = importlib.util.spec_from_file_location("_suwappu_money", _MONEY_PATH)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"cannot load money module from {_MONEY_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["_suwappu_money"] = module
    spec.loader.exec_module(module)
    return module


_money = _load()

d = _money.d
quantize = _money.quantize
q_usd = _money.q_usd
q_qty = _money.q_qty
q_price = _money.q_price
q_rate = _money.q_rate
q_points = _money.q_points
to_float = _money.to_float
to_int = _money.to_int
apply_rate = _money.apply_rate
pct_to_rate = _money.pct_to_rate
total = _money.total
pro_rata = _money.pro_rata
from_atomic = _money.from_atomic
to_atomic = _money.to_atomic

__all__ = [
    "d",
    "quantize",
    "q_usd",
    "q_qty",
    "q_price",
    "q_rate",
    "q_points",
    "to_float",
    "to_int",
    "apply_rate",
    "pct_to_rate",
    "total",
    "pro_rata",
    "from_atomic",
    "to_atomic",
]
