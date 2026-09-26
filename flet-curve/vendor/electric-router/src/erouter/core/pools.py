"""Pool metadata, ABI-dialect classification, and arc enumeration.

The type tables and the `registry_key` normalisation are lifted from
flet-curve-demo/src/curve/models.py:26/:218, which folds the three naming
schemes (Prices v2, the v1 registry, and Curve Lite) onto one key.

**The table is a hint, never a verdict.**  Measured over the live Ethereum
universe (388 pools, one batched call):

    api says stable, int128 answers, uint256 reverts     276
    api says crypto, int128 EMPTY,   uint256 answers      55
    api says crypto, int128 reverts, uint256 answers      45
    api says crypto, neither answers                       4
    api says crypto, int128 EMPTY,   uint256 reverts       4   <-- reverting one is right
    api says stable, neither answers                       3
    api says stable, int128 EMPTY,   uint256 answers       1   <-- API is wrong

60 pools return *empty data* for the wrong spelling rather than reverting, and
decoding that as a uint gives a perfectly plausible zero quote.  One pool is
outright mis-typed by the API.  So: seed from the table, resolve by probe, and
never treat "did not revert" as "answered".
"""

from __future__ import annotations

from collections.abc import Collection, Iterator
from dataclasses import dataclass, field

from .types import ArcKind, Dialect

STABLE_POOL_TYPES = frozenset(
    {
        "main",
        "factory",
        "crvusd",
        "stableswapng",
        "factory-crvusd",
        "factory-stable-ng",
        "factory-eywa",
    }
)
CRYPTO_POOL_TYPES = frozenset(
    {
        "crypto",
        "factory-crypto",
        "factory-tricrypto",
        "twocryptong",
        "factory-twocrypto",
    }
)
# StableSwap-NG takes DynArray amounts; everyone else takes uint256[N].
DYNAMIC_ARRAY_TYPES = frozenset({"stableswapng", "factory-stable-ng"})


def registry_key(pool_type: str | None) -> str:
    """Normalise `factory_crypto` / `factory-crypto` / `FACTORY_CRYPTO`."""
    return (pool_type or "").lower().replace("_", "-")


def volatile_pools(pools, pegged: Collection[str] = ()) -> set[str]:
    """Pools whose pair is not a peg, for sizing a route's slippage floor.

    The registry class decides it, because nothing in an arc distinguishes a
    pegged pair from an oraclised stableswap holding a volatile one -- which is
    the shape of the pools that rug on broadcast, and the reason those are
    excluded by address rather than by inference.

    `pegged` overturns the class where the *pair* says otherwise.  A currency
    pair computed by the cryptoswap invariant is still a currency pair: gnosis
    trades USDC.e against EURe in a twocrypto pool, and a euro does not run
    away from a dollar between the quote and the block the way ETH does.  The
    list is a declaration for the same reason `Chain.stables` is.
    """
    money = {token.lower() for token in pegged}
    return {p.address.lower() for p in pools
            if p.key in CRYPTO_POOL_TYPES
            and not (p.coins and all(c.address.lower() in money for c in p.coins))}



@dataclass(frozen=True, slots=True)
class Coin:
    address: str
    symbol: str
    decimals: int
    index: int

    @classmethod
    def from_api(cls, raw: dict, index: int) -> Coin:
        return cls(
            address=raw["address"],
            symbol=raw.get("symbol") or "?",
            decimals=int(raw.get("decimals") if raw.get("decimals") is not None else 18),
            index=int(raw.get("pool_index", index)),
        )


@dataclass(slots=True)
class PoolSpec:
    address: str
    name: str
    pool_type: str
    coins: tuple[Coin, ...]  # the pool's OWN coins, never the underlying view
    tvl_usd: float = 0.0
    is_meta: bool = False
    base_pool: str = ""
    lp_token: str = ""
    # The LP token's decimals and supply, read on chain alongside it.  Supply is
    # what sizes a withdrawal probe: its "reserve" is the whole token.
    lp_decimals: int = 18
    lp_supply: int = 0
    # Resolved by probe; None until then.  Persisted, because it is a property
    # of the deployed contract rather than of the block.
    dialect: Dialect | None = None
    note: str = ""
    balances: tuple[int, ...] = ()
    # What the pool's coins say it *holds*, against what its own accounting
    # reports above.  Filled alongside `balances` because it rides the same
    # batch; see `check_reserves_are_real` for why the difference matters.
    held: tuple[int, ...] = ()
    # `add_liquidity` is allowlisted and the allowlist is switched on, so a
    # deposit reverts for everyone but its members.  A flag an admin can flip,
    # not a property of the code, so it is read per block like a balance --
    # `dev.universe.resolve_deposit_gates`.  Swaps and withdrawals are unaffected.
    deposit_gated: bool = False
    # `(kind, i, j)` triples this pool quotes and cannot execute -- a suspended
    # synth, a paused transfer, a frozen reserve.  None of it shows in the
    # balances, so it is learned by executing and remembered in `data/facts`;
    # `dev.facts.apply_broken_facts` puts it here and `build_arcs` withholds it.
    blocked_arcs: frozenset[tuple[int, int, int]] = frozenset()
    extra: dict = field(default_factory=dict)

    # ------------------------------------------------------------ metadata

    @property
    def key(self) -> str:
        return registry_key(self.pool_type)

    @property
    def n_coins(self) -> int:
        return len(self.coins)

    @property
    def dynamic_arrays(self) -> bool:
        return self.key in DYNAMIC_ARRAY_TYPES

    @property
    def table_dialect(self) -> Dialect | None:
        """What the registry claims.  `None` means unknown -- do not guess.

        flet-curve-demo defaults an unknown type to stableswap, right for a UI
        (a visible failure) and wrong here: a mis-dispatched call returns empty
        data and reads as a zero quote inside a 900-arc batch.
        """
        if self.key in CRYPTO_POOL_TYPES:
            return Dialect.CRYPTO
        if self.key in STABLE_POOL_TYPES:
            return Dialect.STABLE
        return None

    @property
    def swap_kind(self) -> ArcKind | None:
        dialect = self.dialect or self.table_dialect
        if dialect is Dialect.STABLE:
            return ArcKind.SWAP_STABLE
        if dialect is Dialect.CRYPTO:
            return ArcKind.SWAP_CRYPTO
        return None

    @property
    def deposit_kind(self) -> ArcKind:
        return ArcKind.DEPOSIT_DYN if self.dynamic_arrays else ArcKind.DEPOSIT_FIXED

    @property
    def withdraw_kind(self) -> ArcKind | None:
        dialect = self.dialect or self.table_dialect
        if dialect is Dialect.STABLE:
            return ArcKind.WITHDRAW_STABLE
        if dialect is Dialect.CRYPTO:
            return ArcKind.WITHDRAW_CRYPTO
        return None

    # ------------------------------------------------------------- parsing

    @classmethod
    def from_api(cls, raw: dict) -> PoolSpec:
        """Parse one Prices v2 pool entry.

        A metapool's `coins` is `[metaToken, basePoolLP, ...underlying]`, and
        only the first two are the pool's own coins -- everything that touches
        calldata must use those, because N is part of the signature.
        """
        all_coins = [Coin.from_api(c, k) for k, c in enumerate(raw.get("coins") or [])]
        is_meta = bool(raw.get("is_metapool") or raw.get("metapool"))
        coins = tuple(all_coins[:2] if is_meta and len(all_coins) > 2 else all_coins)
        return cls(
            address=raw.get("address") or "",
            name=raw.get("name") or "",
            pool_type=raw.get("pool_type") or raw.get("registry_type") or "",
            coins=coins,
            tvl_usd=float(raw.get("tvl_usd") or 0.0),
            is_meta=is_meta,
            base_pool=raw.get("base_pool") or "",
            lp_token=raw.get("lp_token_address") or "",
        )

    # ----------------------------------------------------------------- arcs

    def swap_pairs(self) -> Iterator[tuple[int, int]]:
        """Every ordered pair of the pool's own coins."""
        n = self.n_coins
        for i in range(n):
            for j in range(n):
                if i != j:
                    yield i, j

    def swap_arc_count(self) -> int:
        n = self.n_coins
        return n * (n - 1)


def parse_universe(raw_pools: list[dict]) -> list[PoolSpec]:
    """Parse and drop entries that cannot produce an arc."""
    out = []
    for raw in raw_pools:
        spec = PoolSpec.from_api(raw)
        if spec.address and spec.n_coins >= 2:
            out.append(spec)
    return out


def dialect_from_probes(table: Dialect | None, stable_ok: bool, crypto_ok: bool):
    """Resolve a pool's dialect from one probe of each spelling.

    Returns `(dialect, note)`.  `*_ok` must mean "returned 32 bytes", not "did
    not revert" -- conflating those mis-dispatches 60 pools on Ethereum.

    When neither answers, fall back to the table: the pool is live-but-
    unquotable (paused, dust, rounding to zero), a different fact from not
    knowing its ABI, and 4 measured pools have the *reverting* spelling as the
    implemented one.
    """
    if stable_ok and not crypto_ok:
        return Dialect.STABLE, "PROBED"
    if crypto_ok and not stable_ok:
        return Dialect.CRYPTO, "PROBED"
    if stable_ok and crypto_ok:
        # Impossible on a real pool; means the decoder is broken.
        return table, "AMBIGUOUS"
    return table, "NO_ANSWER"
