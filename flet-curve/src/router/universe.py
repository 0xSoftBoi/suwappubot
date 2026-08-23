"""The pool rows the router routes over, and the coins a person picks from.

Both come off one payload the app already fetches: `CurveApi.chain_totals`
downloads every pool on the chain to read two numbers off the top, and
`router_pools` keeps the rest of it.

The router takes the *list* and reads every number that enters a quote off the
chain itself, so this does not have to be fresh -- only complete.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Below this a pool is noise rather than liquidity: base carries 610 of them.
#: The same floor the router's own CLI uses, and it costs something -- one
#: 50-cent trade, replayed -- which `docs/theory.md` section 5 records.
MIN_TVL = 10_000.0

#: Curve's sentinel for native ETH, which is a coin of the $77M ETH/stETH pool
#: among others.  Not an ERC20 and answers nothing useful when asked.
NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"


@dataclass(frozen=True, slots=True)
class CoinEntry:
    """One coin a person can pick, and how busy the pools holding it are."""

    address: str
    symbol: str
    name: str
    decimals: int
    #: Summed 24h trading volume of every pool holding this coin.  What the
    #: list is ordered by: the coins someone means are the ones being traded,
    #: and TVL says which are being *held*, which is a different question.
    volume: float = 0.0
    pools: int = 0
    #: What the connected wallet holds of it, and what that is worth.  Both
    #: zero until somebody asks -- see `router.holdings`, which fills them in
    #: to put the coins someone actually has at the top of the picker.
    balance: int = 0
    worth: float = 0.0

    @property
    def is_native(self) -> bool:
        return self.address == NATIVE


def router_rows(rows, *, min_tvl: float = MIN_TVL) -> list[dict]:
    """The rows worth routing over: enough liquidity, and enough coins."""
    return [
        row for row in rows
        if float(row.get("tvl_usd") or 0.0) >= min_tvl
        and len(row.get("coins") or []) >= 2
    ]


def coins_by_volume(rows, *, min_tvl: float = MIN_TVL) -> list[CoinEntry]:
    """Every routable coin, busiest first.

    A metapool lists its base pool's coins after its own two, and those are
    real coins of a real pool somewhere -- they just are not this pool's, so
    they are counted for the picker and never used to index calldata.
    """
    seen: dict[str, dict] = {}
    for row in router_rows(rows, min_tvl=min_tvl):
        volume = float(row.get("trading_volume_24h") or 0.0)
        for coin in row.get("coins") or []:
            address = str(coin.get("address") or "").lower()
            if not address:
                continue
            entry = seen.setdefault(address, {
                "symbol": coin.get("symbol") or "?",
                "name": coin.get("name") or "",
                "decimals": _decimals(coin),
                "volume": 0.0,
                "pools": 0,
            })
            entry["volume"] += volume
            entry["pools"] += 1
            # A later row may carry a symbol where the first had none.
            if entry["symbol"] == "?" and coin.get("symbol"):
                entry["symbol"] = coin["symbol"]
            if not entry["name"] and coin.get("name"):
                entry["name"] = coin["name"]
    out = [
        CoinEntry(address, e["symbol"], e["name"], e["decimals"],
                  e["volume"], e["pools"])
        for address, e in seen.items()
    ]
    # Volume first, then how many pools hold it, then the symbol -- so the
    # order is stable when a chain has no volume figures at all.
    out.sort(key=lambda c: (-c.volume, -c.pools, c.symbol.upper()))
    return out


def with_native(coins: list[CoinEntry], *, symbol: str,
                wrapped: str) -> list[CoinEntry]:
    """The chain's gas token, on the chains whose pools never name it.

    Curve names native ETH with a sentinel in the eight mainnet pools that
    hold it, so it has always been in this list there.  Nothing on gnosis,
    base or polygon names theirs, and the list is built out of the pool rows
    -- so the coin everybody arrives holding was the one coin they could not
    pick.

    The router aliases the gas token onto its wrapper's node, which is why
    the condition here is the wrapper being in the list rather than anything
    about the gas token: where the wrapper cannot be routed, neither can the
    thing that wraps into it, and offering it would be offering a coin that
    answers "not routable in this universe" to everything.  Chains that do
    not really wrap -- fraxtal, celo -- say so in `Chain.wraps_native`, and
    the caller does not ask.

    It goes in beside the wrapper, carrying its volume, because those are the
    same liquidity seen from either side.
    """
    if any(coin.is_native for coin in coins):
        return coins
    at = next((i for i, coin in enumerate(coins)
               if coin.address.lower() == wrapped.lower()), None)
    if at is None:
        return coins
    twin = coins[at]
    native = CoinEntry(
        NATIVE, symbol, _unwrapped_name(twin, symbol), twin.decimals,
        twin.volume, twin.pools,
    )
    return [*coins[:at], native, *coins[at:]]


def _unwrapped_name(twin: CoinEntry, symbol: str) -> str:
    """"Wrapped Ether" describes the twin, not this."""
    name = (twin.name or "").strip()
    for prefix in ("Wrapped ", "Wrapped-"):
        if name.startswith(prefix):
            return name[len(prefix):].strip() or symbol
    return symbol


def _decimals(coin: dict) -> int:
    """18 unless the row says otherwise.

    The API omits `decimals` on its newer registries, and a wrong default is
    not a small error -- gnosis USDC.e really has 6.  The router reads the
    coin's own `decimals()` off the chain and that wins; this is only what the
    picker formats a balance with until it does.
    """
    got = coin.get("decimals")
    try:
        return int(got) if got is not None else 18
    except (TypeError, ValueError):
        return 18


def matching_coins(entries, query: str) -> list[CoinEntry]:
    """The coins a query names, in the order they were given.

    Symbol first, then name, then address -- someone typing `0xa0b8` means an
    address and someone typing `usd` does not.  An empty query matches all,
    which is what the picker opens on.
    """
    text = (query or "").strip().lower()
    if not text:
        return list(entries)
    by_symbol, by_name, by_address = [], [], []
    for entry in entries:
        symbol = entry.symbol.lower()
        if symbol.startswith(text):
            by_symbol.append(entry)
        elif text in symbol or text in entry.name.lower():
            by_name.append(entry)
        elif entry.address.startswith(text):
            by_address.append(entry)
    return by_symbol + by_name + by_address
