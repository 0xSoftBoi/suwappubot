"""On-disk caches.

Two kinds, with different lifetimes:

* **Universe** -- the pool list for a (chain, min_tvl), deliberately
  *stale-servable*: the Curve API 502s often enough to matter, and an outage
  must degrade to a slightly old universe rather than to a failed route.  Every
  number that actually enters the solve is read on-chain anyway.

* **Dialect** -- which ABI spelling a pool answers.  A property of the deployed
  contract, not of the block, so it never expires.  Worth persisting because
  the API mis-types real pools and re-deriving it costs a probe per pool.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

DEFAULT_ROOT = Path(
    os.environ.get("EROUTER_CACHE", Path.home() / ".cache" / "electric-router")
)
UNIVERSE_TTL = 300.0  # matches the API's own edge cache


class Cache:
    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root or DEFAULT_ROOT)

    def _path(self, *parts: str) -> Path:
        return self.root.joinpath(*parts)

    def read(self, *parts: str) -> Any | None:
        path = self._path(*parts)
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def write(self, value: Any, *parts: str) -> None:
        """Atomic write, so a crash cannot leave a half-written cache."""
        path = self._path(*parts)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                "w", dir=path.parent, delete=False, suffix=".tmp"
            ) as handle:
                json.dump(value, handle)
                tmp = Path(handle.name)
            tmp.replace(path)
        except OSError:
            pass  # a cache that cannot be written is not an error

    def age(self, *parts: str) -> float:
        path = self._path(*parts)
        return time.time() - path.stat().st_mtime if path.is_file() else float("inf")


class UniverseCache:
    """Pool lists, servable stale when the API is down."""

    def __init__(self, cache: Cache | None = None, ttl: float = UNIVERSE_TTL) -> None:
        self.cache = cache or Cache()
        self.ttl = ttl

    def _parts(self, chain_id: int, min_tvl: float) -> tuple[str, ...]:
        return (str(chain_id), f"universe-{min_tvl:.0f}.json")

    def get(self, chain_id: int, min_tvl: float, *, allow_stale: bool = False):
        parts = self._parts(chain_id, min_tvl)
        payload = self.cache.read(*parts)
        if payload is None:
            return None
        if not allow_stale and self.cache.age(*parts) > self.ttl:
            return None
        return payload.get("pools")

    def put(self, chain_id: int, min_tvl: float, pools: list[dict]) -> None:
        self.cache.write(
            {"chain_id": chain_id, "min_tvl": min_tvl, "fetched": time.time(), "pools": pools},
            *self._parts(chain_id, min_tvl),
        )

    def age(self, chain_id: int, min_tvl: float) -> float:
        return self.cache.age(*self._parts(chain_id, min_tvl))


class DialectCache:
    """Pool address -> resolved ABI dialect.  Never expires."""

    def __init__(self, cache: Cache | None = None) -> None:
        self.cache = cache or Cache()

    def _parts(self, chain_id: int) -> tuple[str, ...]:
        return (str(chain_id), "dialects.json")

    def load(self, chain_id: int) -> dict[str, str]:
        return self.cache.read(*self._parts(chain_id)) or {}

    def save(self, chain_id: int, resolved: dict[str, str]) -> None:
        merged = self.load(chain_id) | resolved
        self.cache.write(merged, *self._parts(chain_id))


class TokenFactsCache:
    """Immutable per-address facts: a token's decimals, a pool's LP token.

    Neither can change -- ERC20 decimals are fixed at deployment and a pool's LP
    token with it -- so reading them once per chain is enough.  Asking every
    time cost ~7 s of a 13.5 s mainnet route, all of it outside the routing
    stages, which were unchanged to within a few ms.

    Same shape as `DialectCache`, and stored beside it.
    """

    def __init__(self, cache: Cache | None = None) -> None:
        self.cache = cache or Cache()

    def _parts(self, chain_id: int) -> tuple[str, ...]:
        return (str(chain_id), "token_facts.json")

    def load(self, chain_id: int) -> dict[str, dict]:
        return self.cache.read(*self._parts(chain_id)) or {}

    def save(self, chain_id: int, facts: dict[str, dict]) -> None:
        """Merge per address, not per file.

        Three passes write here about the same address -- a coin's `decimals`, a
        pool's `lp_token`/`lp_decimals`, and a token's ERC4626 `asset` -- and
        `a | b` at the top level replaces an address's whole entry rather than
        updating it, so only the last pass's facts survived.

        That is not merely wasted round trips.  A reader that has established
        the address is present concludes its own fact is known and never asks:
        measured on gnosis, `read_balances` skipped `decimals()` for USDC.e
        because the wrapper pass had overwritten `{"decimals": 6}` with
        `{"asset": ""}`, so the API's null-defaulted 18 stood, every amount
        through that pool was out by 1e12, and the whole pool fell out of the
        graph.
        """
        merged = self.load(chain_id)
        for address, fresh in facts.items():
            merged[address] = (merged.get(address) or {}) | fresh
        self.cache.write(merged, *self._parts(chain_id))
