"""Starting up must not cost a wire round trip per pool.

Two regressions live here, both found by running the CLI rather than a script.

**Ordering.**  The exact models are built from a pool's parameters -- `A`, the
fee terms, `D`, the balances -- which is the same storage the local EVM's warm
already fetches in one batched sweep.  Building them *before* the local EVM
exists does not avoid that read; it moves it to several hundred per-pool getter
calls over the network.  Measured, that turned a 3.3 s sweep into minutes.  It
looked like a win on the private node because a fast endpoint hides request
count, which is the same trap as debugging on `--private`.  So the order is
load-bearing, and this asserts it structurally -- there is no cheap way to assert
"startup is fast" and every expensive way needs a chain.

**The gate.**  What the verdict cache is worth is not re-asking a question
already answered: 2,406 probes down to 84.  That saving is independent of the
ordering, so it is checked directly.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from erouter.chain.exact_cache import ExactCache
from erouter.chain.stable_params import build_exact_pools
from erouter.core.quoter import Quote
from erouter.core.stableswap import StableSwap
from erouter.core.transport import Answer, Status
from erouter.dev import cli as cli_module


def _cmd_route_calls() -> list[str]:
    """Every function called in `cmd_route`, in source order."""
    tree = ast.parse(Path(cli_module.__file__).read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "cmd_route":
            break
    else:  # pragma: no cover - the CLI always has one
        raise AssertionError("cmd_route not found")

    names: list[str] = []
    for inner in ast.walk(node):
        if isinstance(inner, ast.Call):
            func = inner.func
            name = getattr(func, "id", None) or getattr(func, "attr", None)
            if name:
                names.append((inner.lineno, name))
    return [name for _line, name in sorted(names)]


def test_the_local_evm_is_warmed_before_the_models_are_built():
    """Build first and every parameter read becomes a network call."""
    calls = _cmd_route_calls()
    assert "_local_quoter" in calls, "cmd_route no longer sets up a local EVM"
    assert "build_exact_pools" in calls, "cmd_route no longer builds exact models"

    warm = calls.index("_local_quoter")
    build = calls.index("build_exact_pools")
    assert warm < build, (
        "the exact models are built before the local EVM is warmed, so every "
        "pool parameter is read over the wire instead of from the batched "
        "storage sweep -- this is what made startup take minutes"
    )


def test_nothing_reintroduces_a_warm_that_skips_pools():
    """`prime` must sweep the cache, not a subset chosen from the models.

    Skipping the pools that will be computed looks like it saves two thirds of
    the storage, and it does -- but they are computed *from* that storage, so
    the read reappears on the wire, larger.
    """
    from erouter.dev.local_evm import LocalEvm

    assert "skip" not in inspect.signature(LocalEvm.prime).parameters, (
        "LocalEvm.prime grew a `skip` again; the pools it would skip are the "
        "ones whose parameters the models need"
    )
    assert "skip_pools" not in inspect.signature(cli_module._local_quoter).parameters


# --------------------------------------------------------------------- gate


class Pool:
    """Just enough of a `PoolSpec` for the stableswap reader."""

    def __init__(self, address: str, n: int = 2):
        self.address = address
        self.coins = tuple(Coin() for _ in range(n))
        self.balances = tuple(10**24 for _ in range(n))
        self.lp_token = None
        self.swap_kind = None


class Coin:
    address = "0x" + "00" * 20
    decimals = 18
    symbol = "T"


class CountingClient:
    """Answers parameter reads; records every probe it is asked for."""

    def __init__(self):
        self.probed: list = []

    def raw(self, calls):
        # `A_precise`, `A`, `fee`, `offpeg` per pool, in that order.
        out = []
        for k in range(len(calls)):
            value = (2000 * 100, 0, 4_000_000, 0)[k % 4]
            out.append(Answer(Status.VALUE, value.to_bytes(32, "big"))
                       if value else Answer(Status.REVERTED))
        return out

    def probe(self, probes):
        # Answer as the pool would, so the cold pass actually admits and the
        # cache has something to remember.  What is under test is how many
        # probes are asked for, not whether the maths is right -- that is
        # `test_stableswap.py`, against the chain.
        self.probed.extend(probes)
        model = StableSwap(
            balances=tuple(10**24 for _ in range(2)),
            rates=tuple(10**18 for _ in range(2)),
            amp=200_000, fee=4_000_000, offpeg_fee_multiplier=0,
            a_precision=100, fee_on_xp=True,
        )
        return [Quote(Status.VALUE, model.get_dy(p.i, p.j, p.dx)) for p in probes]


def test_a_covered_verdict_cache_asks_for_no_gate_probes(tmp_path: Path):
    """The whole point of remembering: 2,406 probes become none."""
    pools = [Pool("0x" + f"{k:02x}" * 20) for k in range(1, 6)]
    cache = ExactCache.load(1, "t", tmp_path)

    cold = CountingClient()
    build_exact_pools(pools, cold, cache=cache)
    assert cold.probed, "a cold cache must still make every pool prove itself"

    warm = CountingClient()
    out = build_exact_pools(pools, warm, cache=cache)
    assert out.trusted == len(cache.verdicts) > 0
    assert not warm.probed, (
        f"{len(warm.probed)} gate probe(s) sent for pools whose verdict was "
        f"already known"
    )
