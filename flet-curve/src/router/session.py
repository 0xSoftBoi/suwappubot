"""Building a warmed `RouterSession` for a chain, from this app's pieces.

The router asks for four things -- a chain table entry, batched async RPC, an
EVM to execute in, and the committed caches -- and this is where each of them
comes from here: `erouter.chain.chains`, `router.rpc`, whichever compiled half
loaded, and either the web root or the checkout.

The endpoint is the router's own committed one.  It is a *scoped* key: reads,
plus `eth_call` restricted to the quoter contract and nothing else.  Committing
it is the point -- a build with no configuration of its own routes on fifteen
chains -- and `local_config.toml` overrides it for anyone with a node.
"""

from __future__ import annotations

import sys
from pathlib import Path

from curve.http import ApiError

from .backend import ASSET_DIR, Backend
from .rpc import RouterRpc

#: Where the committed caches live once `tools/build_router.py` has copied
#: them.  Under `src/assets/`, so `flet publish` serves them from the web root
#: and a desktop build reads them off disk.
DATA_DIR = "data"


def is_browser() -> bool:
    return sys.platform == "emscripten"


class WebFiles:
    """The `DataSource` protocol over the published web root."""

    def __init__(self, base_url: str):
        self._base = base_url.rstrip("/") + "/"

    async def load(self, name: str) -> bytes | None:
        from curve.http import get_bytes

        try:
            return await get_bytes(f"{self._base}{DATA_DIR}/{name}")
        except ApiError:
            # Not an error: every one of these is an optimisation the router
            # can do without, more slowly or more cautiously.
            return None


class LocalFiles:
    """The `DataSource` protocol over the checkout."""

    def __init__(self, root: Path):
        self._root = Path(root)

    async def load(self, name: str) -> bytes | None:
        path = self._root / DATA_DIR / name
        return path.read_bytes() if path.is_file() else None


def data_source(assets_root: Path | None = None):
    """Wherever the committed caches are on this platform."""
    if is_browser():
        from urllib.parse import urljoin

        import js

        return WebFiles(urljoin(js.location.href, ASSET_DIR + "/"))
    root = assets_root or (Path(__file__).resolve().parents[1] / "assets" / ASSET_DIR)
    return LocalFiles(root)


def chain_for(chain_id: int):
    """The router's own table entry, which carries the quoter and the endpoint."""
    from erouter.chain.chains import CHAINS

    for chain in CHAINS.values():
        if chain.chain_id == chain_id:
            return chain
    return None


def rpc_url(chain, override: str = "") -> str:
    """Where to reach the chain.

    The committed scoped key by default, so what runs in a browser is what was
    developed against -- developing on a wider key than production gets is how
    a dependency on that width ships unnoticed.
    """
    return override or chain.public_rpc


async def build_session(chain_id: int, backend: Backend, *, api,
                        rpc_override: str = "", assets_root: Path | None = None,
                        min_tvl: float | None = None):
    """A session for this chain, and the coins someone can pick from it.

    Not warmed: warming reports progress and belongs to whoever draws the bar.
    """
    from erouter.chain.session import RouterSession

    from .universe import MIN_TVL, coins_by_volume, router_rows

    chain = chain_for(chain_id)
    if chain is None:
        raise RouterUnavailable(f"the router is not deployed on chain {chain_id}")
    if not chain.quoter:
        raise RouterUnavailable(f"no quoter is deployed on {chain.name}")
    url = rpc_url(chain, rpc_override)
    if not url:
        raise RouterUnavailable(f"no endpoint configured for {chain.name}")

    rows = await api.router_pools(chain_id)
    if not rows:
        raise RouterUnavailable(f"no pool list for {chain.name}")
    floor = MIN_TVL if min_tvl is None else min_tvl
    rpc = RouterRpc(url, chain_id)
    # Before the session reads `batch_size` to size its sweep.  One request,
    # against twenty times the round trips if this endpoint turns out to serve
    # more than the floor -- which the one that ships does.
    await rpc.probe()
    session = RouterSession(
        chain,
        rpc,
        backend.evm(getattr(chain, "spec", "Osaka"), chain_id),
        data_source(assets_root),
        router_rows(rows, min_tvl=floor),
        min_tvl=floor,
    )
    return session, coins_by_volume(rows, min_tvl=floor)


class RouterUnavailable(RuntimeError):
    """This chain cannot be routed on, and why."""


__all__ = ["LocalFiles", "RouterUnavailable", "WebFiles", "build_session",
           "chain_for", "data_source", "rpc_url"]
