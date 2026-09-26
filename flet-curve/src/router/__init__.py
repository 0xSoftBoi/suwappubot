"""The electric router, wired into this app.

Everything here is Flet-free, so it can be tested with plain pytest and so the
one-way rule holds: `ui/` imports this, this imports `curve/` and `erouter`,
and neither of those imports back.

    backend   which compiled halves this platform can load
    rpc       batched JSON-RPC, the shape `erouter.chain` asks for
    universe  the pool rows and the coin list, from what the app already fetches
    session   building a session for a chain out of those pieces
    host      one warmed session per chain, and who gets to quote when
"""

from __future__ import annotations

from .backend import Backend, BackendError, load_backend
from .host import RouterHost, Stage
from .rpc import RouterRpc
from .session import RouterUnavailable, build_session, chain_for
from .universe import CoinEntry, coins_by_volume, matching_coins, router_rows

__all__ = [
    "Backend",
    "BackendError",
    "CoinEntry",
    "RouterHost",
    "RouterRpc",
    "RouterUnavailable",
    "Stage",
    "build_session",
    "chain_for",
    "coins_by_volume",
    "load_backend",
    "matching_coins",
    "router_rows",
]
