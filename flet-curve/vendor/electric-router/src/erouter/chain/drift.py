"""How much a pair's exchange rate moves on its own, measured.

The router needs to know what a routing gain has to beat before another leg is
worth taking, and that is not a property of either token separately.  WETH and
stETH each move ~125 bp against the dollar over a thousand blocks while the rate
*between* them barely moves, so a gain of 0.04 bp is noise on one comparison and
signal on the other.  Classifying tokens as "stable" or not cannot express that,
and got it wrong exactly there: a 1:1 Lido mint, which cannot lose, was
discarded for being worth less than a threshold set by WETH's volatility against
the dollar.

So: sample the rate *between* the two, at spaced blocks, from a pool that holds
both.  An earlier attempt stored one price per token and divided, which priced
each token in the counter-coin of its own deepest pool -- USDC/WETH came out at
0.29 bp against 125 measured directly.

One series per *arc* rather than per pair -- 876 instead of 45,000 -- and a pair
with no shared pool has no measurement, which the caller must treat as unknown
rather than as zero.  Blocks are spaced rather than consecutive: ten consecutive
blocks showed nothing move at all, which measures how quiet the chain was, not
what the pair does.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..core.codec import encode_call
from ..core.quoter import SIG_PROBE_BATCH
from ..core.types import ArcKind, Probe

#: Blocks back from head.  Spread over roughly four hours, which is long enough
#: for a pair to show what it does and short enough to still be this market.
SAMPLE_BLOCKS = (0, 30, 120, 300, 600, 1200)
#: A trade small enough to read the marginal rate rather than the pool's depth.
SAMPLE_FRACTION = 1e-5
#: The quoter's own MAX_PROBES.  Sending the whole universe in one call reverts
#: silently -- a failed sample is indistinguishable from a quiet pair.
PROBES_PER_CALL = 500
#: Below this a pair is treated as pegged: the measurement is at the limit of
#: what integer quotes resolve, and pretending otherwise invents precision.
DRIFT_FLOOR_BP = 0.005


@dataclass(slots=True)
class PriceSeries:
    token: str
    pool: str
    prices: list[float]

    @property
    def usable(self) -> bool:
        return len(self.prices) >= 3 and all(p > 0 for p in self.prices)


def series_drift_bp(rates: list[float]) -> float:
    """The largest step this rate took between samples, in basis points.

    The largest rather than the average: what a routing gain has to survive is
    the move that happens while the transaction is pending.
    """
    clean = [r for r in rates if r > 0]
    if len(clean) < 3:
        return 0.0
    steps = [abs(math.log(clean[k] / clean[k - 1])) for k in range(1, len(clean))]
    return max(steps) * 1e4 if steps else 0.0


def sample_rates(rpc, quoter: str, arcs, blocks=SAMPLE_BLOCKS,
                 overrides=None) -> dict[str, PriceSeries]:
    """One rate series per arc, keyed "tokenIn|tokenOut".

    `arcs` is `(key, pool, kind, i, j, n_coins, dx)`, chosen by the caller.
    Every arc goes out in one `probe_batch` per block, so the whole sweep is one
    request per block regardless of size.

    `overrides` carries the quoter's runtime bytecode on chains where it is not
    deployed.  Without it this asks an address with no code and gets nothing
    back for every block, which reads as a quiet chain rather than a missing
    contract.
    """
    head = rpc.block
    series: dict[str, PriceSeries] = {
        token: PriceSeries(token=token, pool=pool, prices=[])
        for token, pool, _, _, _, _, _ in arcs
    }
    for back in blocks:
        block = head - back
        for lo in range(0, len(arcs), PROBES_PER_CALL):
            chunk = arcs[lo:lo + PROBES_PER_CALL]
            probes = [Probe(pool, ArcKind(kind), i, j, n, dx)
                      for _, pool, kind, i, j, n, dx in chunk]
            data = "0x" + encode_call(
                SIG_PROBE_BATCH, [p.as_tuple() for p in probes]).hex()
            try:
                params = [{"to": quoter, "data": data}, hex(block)]
                if overrides:
                    params.append(overrides)
                raw = rpc.fetch("eth_call", params)
            except Exception:
                continue
            blob = bytes.fromhex(raw[2:])
            # `(uint8,uint256)[]`: an offset word, a length word, then pairs.
            body = blob[64:]
            for k, (key, _, _, _, _, _, dx) in enumerate(chunk):
                window = body[k * 64: k * 64 + 64]
                if len(window) < 64:
                    break
                status = int.from_bytes(window[:32], "big")
                value = int.from_bytes(window[32:], "big")
                if status == 0 and value > 0:
                    series[key].prices.append(value / dx)
    return {key: entry for key, entry in series.items() if entry.usable}
