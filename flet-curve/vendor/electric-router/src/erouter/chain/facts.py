"""What is true of a chain until someone redeploys something.

These facts share a file because they share a lifetime: none depends on the
block, all cost execution to learn, and a checkout should have them without
paying for that.

* **Gas.**  A pool that costs 118,778 to swap through costs about that at every
  block.  See `gas_probe`.
* **Broken directions.**  An arc that quotes and then reverts -- Aave V2's frozen
  reserves, Compound V2's paused mint.  Nothing in a pool's state gives these
  away; only executing finds them.
* **Wrapper capability.**  Whether a lending token can still be minted, still be
  redeemed, or both.  Deprecated protocols stop taking deposits long before they
  stop honouring withdrawals, so this is per direction, not per protocol.
* **Minimum-out risk.**  How often a pool's rate moves further than its own
  slippage bound inside a couple of minutes, which is how often a route through
  it reverts.  See `revert_risk`.
* **Wide-bound pools.**  The handful that trade a moving pair on a stablecoin
  fee, so a fraction of that fee is not a bound anything could execute against.
  A list rather than a rule, because a list is auditable in a diff.

Slot lists and bytecode stay in `state_cache`, which is gzipped because it
carries megabytes of code.  Facts belong in plain JSON: three orders of magnitude
smaller, and readable in a diff.  One command builds both.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median

from ..core.gas import GasTable
from ..core.pools import registry_key
from ..core.risk import DEFAULT_RISK, RiskTable
from ..core.types import ArcKind

VERSION = 1
DEFAULT_DIR = Path(__file__).resolve().parents[3] / "data" / "facts"


@dataclass(slots=True)
class FactsCache:
    chain_id: int
    path: Path
    #: "address:kind:i>j" -> gas, so the file is legible in a diff
    legs: dict[str, int] = field(default_factory=dict)
    #: Medians a not-yet-measured leg inherits: "class:kind" and "kind".
    classes: dict[str, int] = field(default_factory=dict)
    kinds: dict[int, int] = field(default_factory=dict)
    #: address -> registry class, so the aggregates survive a reload.
    class_of: dict[str, str] = field(default_factory=dict)
    #: "tokenIn|tokenOut" -> that rate at spaced blocks.  The pair's own rate,
    #: not two prices divided; see `drift.series_drift_bp`.
    prices: dict[str, list[float]] = field(default_factory=dict)
    #: "address:kind:i>j" -> why it reverted.  Quotes fine, cannot be traded.
    broken: dict[str, str] = field(default_factory=dict)
    #: wrapper address -> {"mint": bool, "redeem": bool, "note": str}
    wrappers: dict[str, dict] = field(default_factory=dict)
    #: "address:i>j" -> {"p", "bound_bp", "scale_bp", "active", "n"}: the
    #: chance this arc's own minimum-out trips first.  See `revert_risk`.
    breach: dict[str, dict] = field(default_factory=dict)
    #: pool address -> {"fee_bp", "drift_bp", "pair"}: pools that trade a
    #: moving pair on a stablecoin-sized fee, so 20% of that fee is not a
    #: survivable minimum-out and the absolute floor applies instead.  A short,
    #: readable list rather than a rule, because it is short.
    wide_bounds: dict[str, dict] = field(default_factory=dict)
    block: int = 0
    dirty: bool = False

    # ------------------------------------------------------------- load/save

    @classmethod
    def load(cls, chain_id: int, name: str, directory: Path | None = None) -> FactsCache:
        path = (directory or DEFAULT_DIR) / f"{name}.json"
        blob = path.read_bytes() if path.exists() else None
        return cls.from_bytes(chain_id, blob, path=path)

    @classmethod
    def from_bytes(cls, chain_id: int, blob: bytes | None,
                   path: Path | None = None) -> FactsCache:
        """The same file, however it was obtained -- a browser fetches it."""
        cache = cls(chain_id=chain_id, path=path or (DEFAULT_DIR / "unnamed.json"))
        if not blob:
            return cache
        try:
            raw = json.loads(blob)
        except ValueError:
            return cache
        if raw.get("version") != VERSION or raw.get("chain_id") != chain_id:
            return cache
        cache.legs = {k: int(v) for k, v in raw.get("legs", {}).items()}
        cache.classes = {k: int(v) for k, v in raw.get("classes", {}).items()}
        cache.kinds = {int(k): int(v) for k, v in raw.get("kinds", {}).items()}
        cache.class_of = dict(raw.get("class_of", {}))
        cache.prices = {k: list(v) for k, v in raw.get("prices", {}).items()}
        cache.broken = dict(raw.get("broken", {}))
        cache.wrappers = dict(raw.get("wrappers", {}))
        cache.breach = dict(raw.get("breach", {}))
        cache.wide_bounds = dict(raw.get("wide_bounds", {}))
        cache.block = int(raw.get("block", 0))
        return cache

    def save(self) -> None:
        if not self.dirty:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": VERSION,
            "chain_id": self.chain_id,
            "block": self.block,
            "legs": dict(sorted(self.legs.items())),
            "classes": dict(sorted(self.classes.items())),
            "kinds": {str(k): v for k, v in sorted(self.kinds.items())},
            "class_of": dict(sorted(self.class_of.items())),
            "prices": {k: [round(x, 12) for x in v]
                       for k, v in sorted(self.prices.items())},
            "broken": dict(sorted(self.broken.items())),
            "wrappers": dict(sorted(self.wrappers.items())),
            "breach": dict(sorted(self.breach.items())),
            "wide_bounds": dict(sorted(self.wide_bounds.items())),
        }
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n",
                       encoding="utf-8")
        tmp.replace(self.path)
        self.dirty = False

    # ------------------------------------------------------------ questions

    @staticmethod
    def key(target: str, kind: ArcKind | int, i: int, j: int) -> str:
        return f"{target.lower()}:{int(kind)}:{int(i)}>{int(j)}"

    def learn(self, measured: dict[tuple[str, int, int, int], int], *,
              block: int = 0, classes: dict[str, str] | None = None) -> int:
        """Fold in a measurement pass.  Returns how many figures changed.

        `classes` maps a pool address to its registry class, and is what lets
        an unmeasured pool inherit from pools of its own kind rather than from
        the all-pools median.  Passing it is optional; omitting it just leaves
        the class aggregates as they were.
        """
        changed = 0
        for (target, kind, i, j), gas in measured.items():
            key = self.key(target, kind, i, j)
            if self.legs.get(key) != int(gas):
                self.legs[key] = int(gas)
                changed += 1
        if classes:
            for address, name in classes.items():
                self.class_of.setdefault(address.lower(), name)
        if changed:
            self._aggregate()
            self.dirty = True
            self.block = block or self.block
        return changed

    def _aggregate(self) -> None:
        """Recompute the medians a not-yet-probed pool will be priced from.

        Median rather than max: the max exists because one *sample* of a leg
        caught a pool rebalancing inside `exchange`, which is the right figure
        for that leg and the wrong one to project onto every pool of its class.
        """
        by_kind: dict[int, list[int]] = {}
        by_class: dict[str, list[int]] = {}
        for key, gas in self.legs.items():
            address, kind, _ = key.split(":")
            by_kind.setdefault(int(kind), []).append(gas)
            name = self.class_of.get(address)
            if name:
                by_class.setdefault(f"{name}:{kind}", []).append(gas)
        self.kinds = {k: int(median(v)) for k, v in by_kind.items()}
        self.classes = {k: int(median(v)) for k, v in by_class.items()}

    def learn_prices(self, series: dict) -> int:
        """Record one price series per token, for pair drift."""
        changed = 0
        for token, entry in series.items():
            prices = list(getattr(entry, "prices", entry))
            if self.prices.get(token.lower()) != prices:
                self.prices[token.lower()] = prices
                changed += 1
        if changed:
            self.dirty = True
        return changed

    def drift_bp(self, src: str, dst: str) -> float | None:
        """How much this pair's rate moves on its own, or None if unmeasured.

        Either direction of the same pool answers the same question, so both
        keys are tried.  `None` means no pool holds both -- unknown, which the
        caller must not read as "does not move".
        """
        from .drift import series_drift_bp

        # The largest across every pool that holds the pair, not the deepest
        # one's.  A quiet pool has a rate that does not move, which says the
        # pool saw no trades -- not that the pair holds still.  WETH/WBTC read
        # 0.0000 bp that way, and a zero floor is the one answer that lets a
        # volatile pair take unlimited legs.
        worst = None
        for direction in (f"{src.lower()}|{dst.lower()}", f"{dst.lower()}|{src.lower()}"):
            for key, rates in self.prices.items():
                if key == direction or key.startswith(direction + "@"):
                    got = series_drift_bp(rates)
                    worst = got if worst is None else max(worst, got)
        return worst

    def table(self, pools=None) -> GasTable:
        """The pure-core view, which is all the router itself ever sees.

        With `pools`, every pool that has no measurement of its own is given a
        per-pool default from the median of its class -- so a pool deployed
        after the last calibration is priced like its siblings instead of like
        the flat guess.  Without, the table still degrades sensibly through the
        per-kind medians.
        """
        legs: dict[tuple[str, int, int, int], int] = {}
        for key, gas in self.legs.items():
            address, kind, pair = key.split(":")
            i, j = pair.split(">")
            legs[(address, int(kind), int(i), int(j))] = int(gas)

        if pools:
            measured = {(a, k) for (a, k, _, _) in legs}
            for pool in pools:
                address = pool.address.lower()
                name = registry_key(pool.pool_type)
                for kind in (ArcKind.SWAP_STABLE, ArcKind.SWAP_CRYPTO):
                    if (address, int(kind)) in measured:
                        continue
                    got = self.classes.get(f"{name}:{int(kind)}")
                    if got:
                        legs[(address, int(kind), -1, -1)] = int(got)
        return GasTable(legs, self.kinds)

    # ------------------------------------------------------- executability

    def learn_broken(self, found: dict[str, str]) -> int:
        """Record arc directions that quote but revert, and forget ones that
        no longer do -- a protocol can be unpaused, and a stale entry would
        silently cost us a pool forever."""
        changed = 0
        for key, reason in found.items():
            if self.broken.get(key) != reason:
                self.broken[key] = reason
                changed += 1
        self.dirty = self.dirty or bool(changed)
        return changed

    def forget_broken(self, keys) -> int:
        """Drop entries that executed this time round."""
        gone = [k for k in keys if k in self.broken]
        for key in gone:
            del self.broken[key]
        self.dirty = self.dirty or bool(gone)
        return len(gone)

    def learn_wrapper(self, address: str, *, mint: bool | None, redeem: bool | None,
                      note: str = "") -> bool:
        """Record only what was actually attempted.

        `None` is untested and is left out entirely, so a direction nobody
        could fund does not read later as one the protocol refused.  Absent and
        False both keep the arc unbuilt, but only False is a claim.
        """
        entry: dict = {}
        if mint is not None:
            entry["mint"] = bool(mint)
        if redeem is not None:
            entry["redeem"] = bool(redeem)
        if not entry:
            return False
        if note:
            entry["note"] = note
        address = address.lower()
        if self.wrappers.get(address) != entry:
            self.wrappers[address] = entry
            self.dirty = True
            return True
        return False

    def learn_breach(self, found: dict[str, dict]) -> int:
        """Record per-arc minimum-out risk, replacing what was there.

        Replacing rather than merging: `p` is a property of the pool's fee
        against its current volatility, and both change.  A figure measured
        against last year's fee is not evidence about today's.
        """
        changed = 0
        for key, entry in found.items():
            key = key.lower()
            if self.breach.get(key) != entry:
                self.breach[key] = dict(entry)
                changed += 1
        self.dirty = self.dirty or bool(changed)
        return changed

    def learn_wide_bounds(self, found: dict[str, dict]) -> int:
        """Replace the exception list wholesale.

        Replacing rather than merging: a pool drops off the list when its fee
        rises or its pair stops moving, and a stale entry would keep handing
        out an allowance nothing justifies.  The count returned is of pools
        added or changed, so a quiet re-probe says so.
        """
        changed = sum(1 for a, e in found.items()
                      if self.wide_bounds.get(a.lower()) != e)
        replacement = {a.lower(): dict(e) for a, e in found.items()}
        if replacement != self.wide_bounds:
            self.wide_bounds = replacement
            self.dirty = True
        return changed

    def risk_table(self) -> RiskTable:
        """The pure-core view: `(address, i, j) -> probability`, and nothing else.

        Every pool also gets a `(-1, -1)` entry from the worst of its own arcs,
        which is what a direction the sweep never sampled inherits -- the same
        specific-to-general walk `GasTable` does, erring high because an unsampled
        pair of a pool we know is not evidence of safety.

        A pool the sweep never saw at all falls to the table's default, raised
        here to the measured 75th percentile if that is higher than the constant.
        Not the upper decile: the distribution is bimodal, and its top tenth is
        the crypto pools, which would charge 120 bp for a gap in our own sampling
        rather than for anything about the pool.
        """
        arcs: dict[tuple[str, int, int], float] = {}
        worst: dict[str, float] = {}
        for key, entry in self.breach.items():
            if "p" not in entry:
                continue
            address, pair = key.split(":")
            i, j = pair.split(">")
            arcs[(address, int(i), int(j))] = float(entry["p"])
            worst[address] = max(worst.get(address, 0.0), float(entry["p"]))
        for address, value in worst.items():
            arcs.setdefault((address, -1, -1), value)
        default = DEFAULT_RISK
        if arcs:
            ordered = sorted(arcs.values())
            default = max(DEFAULT_RISK, ordered[int(0.75 * (len(ordered) - 1))])
        return RiskTable(arcs, default=default)

    def is_broken(self, target: str, kind, i: int, j: int) -> str:
        """The reason this direction cannot be traded, or "" if it can."""
        return self.broken.get(self.key(target, kind, i, j), "")

    def blocked_arcs(self) -> dict[str, frozenset[tuple[int, int, int]]]:
        """`{pool: {(kind, i, j), ...}}` -- what has been seen to revert.

        The keys are `address:kind:i>j`, so a reason recorded against an arc
        kind that no longer exists simply never matches a pool's arcs.
        """
        out: dict[str, set[tuple[int, int, int]]] = {}
        for key in self.broken:
            address, _, rest = key.partition(":")
            kind, _, pair = rest.partition(":")
            i, _, j = pair.partition(">")
            try:
                triple = (int(kind), int(i), int(j))
            except ValueError:                      # not a per-direction key
                continue
            out.setdefault(address.lower(), set()).add(triple)
        return {a: frozenset(v) for a, v in out.items()}

    def broken_pools(self) -> set[str]:
        """Pools with no tradeable direction left at all."""
        seen: dict[str, int] = {}
        for key in self.broken:
            seen[key.split(":")[0]] = seen.get(key.split(":")[0], 0) + 1
        return set(seen)

    def stats(self) -> dict:
        by_kind: dict[str, int] = {}
        for key in self.legs:
            kind = ArcKind(int(key.split(":")[1]))
            by_kind[kind.name] = by_kind.get(kind.name, 0) + 1
        return {"legs": len(self.legs), "block": self.block, "by_kind": by_kind,
                "classes": len(self.classes), "kinds": dict(self.kinds),
                "broken": len(self.broken), "wrappers": len(self.wrappers),
                "breach": len(self.breach),
                "wide_bounds": len(self.wide_bounds)}


def apply_broken_facts(pools, cache) -> int:
    """Hang each pool's known-unexecutable directions on it, for `build_arcs`.

    `core/` cannot read `data/facts`, so the arcs the router must not offer are
    carried on `PoolSpec` the same way `deposit_gated` is.  Returns how many
    arcs were withheld, so a caller can say so rather than silently routing
    around them.
    """
    blocked = cache.blocked_arcs()
    if not blocked:
        return 0
    withheld = 0
    for pool in pools:
        found = blocked.get(pool.address.lower())
        if found:
            pool.blocked_arcs = found
            withheld += len(found)
    return withheld
