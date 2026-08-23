"""The domain objects, parsed out of Curve's API shapes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .external import ExternalCampaign
from .merkl import NO_REWARDS, MerklRewards
from .merkl import split as merkl_split

#: `pool_type`/`registry_type` values whose pools use the StableSwap ABI:
#: `int128` coin indices.
STABLE_POOL_TYPES = frozenset(
    {
        # v2
        "main", "factory", "crvusd", "stableswapng",
        # v1 registry ids
        "factory-crvusd", "factory-stable-ng", "factory-eywa",
    }
)
#: Pool types whose amount arrays are Vyper `DynArray`s -- `uint256[]`
#: rather than `uint256[N]`.
DYNAMIC_ARRAY_TYPES = frozenset(
    {
        "stableswapng",
        # v1 registry id for the same implementation
        "factory-stable-ng",
    }
)

#: Pool types using the CryptoSwap ABI: `uint256` coin indices.
CRYPTO_POOL_TYPES = frozenset(
    {
        # v2
        "crypto", "factory_crypto", "factory_tricrypto", "twocryptong",
        # v1 registry ids
        "factory-crypto", "factory-tricrypto", "factory-twocrypto",
    }
)


def _float(value: Any, default: float = 0.0) -> float:
    """Coerce an API number that may be a string, None, or already a float."""
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default


@dataclass(slots=True)
class Coin:
    """One asset in a pool."""

    address: str
    symbol: str
    decimals: int
    index: int = 0
    usd_price: float = 0.0
    balance: float = 0.0
    balance_usd: float = 0.0

    @classmethod
    def from_v2(cls, raw: dict[str, Any]) -> Coin:
        return cls(
            address=raw.get("address") or "",
            symbol=raw.get("symbol") or "?",
            decimals=_int(raw.get("decimals"), 18),
            index=_int(raw.get("pool_index")),
            usd_price=_float(raw.get("usd_price")),
        )


@dataclass(slots=True)
class Incentive:
    """A non-CRV reward token streamed to a pool's gauge."""

    symbol: str
    token_address: str
    apr: float = 0.0

    @classmethod
    def from_v2(cls, raw: dict[str, Any]) -> Incentive:
        return cls(
            symbol=raw.get("symbol") or "?",
            token_address=raw.get("address") or raw.get("token_address") or "",
            apr=_float(raw.get("apr")),
        )

    @classmethod
    def from_lite(cls, raw: dict[str, Any]) -> Incentive:
        """Curve Lite's gauge reward entry."""
        return cls(
            symbol=raw.get("symbol") or "?",
            token_address=raw.get("token_address") or raw.get("address") or "",
            apr=_float(raw.get("apy")),
        )


def _first_live_gauge(raw: Any) -> str:
    """Pull a usable gauge address out of either shape v2 returns."""
    if not isinstance(raw, list):
        return ""
    for entry in raw:
        if isinstance(entry, str) and entry:
            return entry
        if isinstance(entry, dict) and not entry.get("is_killed"):
            address = entry.get("address")
            if address:
                return address
    return ""


def _first_dead_gauge(raw: Any) -> str:
    """A killed gauge, for a pool that has no live one.

    Killed means it pays no more CRV and takes no new stakes -- it does
    not mean it is empty. 161 of Ethereum's 2,219 pools have only killed
    gauges, and the ones sampled still held LP, so a portfolio that only
    ever asks about live gauges tells those people they have nothing and
    offers them no way to get it out.
    """
    if not isinstance(raw, list):
        return ""
    for entry in raw:
        if isinstance(entry, dict) and entry.get("is_killed"):
            address = entry.get("address")
            if address:
                return address
    return ""


@dataclass(slots=True)
class Pool:
    """A Curve pool, as much of it as the list and detail views need."""

    address: str
    name: str
    chain: str = ""
    chain_id: int = 0
    registry: str = ""
    coins: list[Coin] = field(default_factory=list)
    lp_token: str = ""
    tvl: float = 0.0
    volume_24h: float = 0.0
    base_apr: float = 0.0
    gauge: str = ""
    #: A killed gauge, when the pool has no live one. Nothing new goes in;
    #: what is already there still has to come out. See `_first_dead_gauge`.
    dead_gauge: str = ""
    #: veCRV boost range: (unboosted, max-boost) APR in percent.
    crv_apr: tuple[float, float] = (0.0, 0.0)
    incentives: list[Incentive] = field(default_factory=list)
    #: Off-gauge campaign rewards, claimed via a merkle drop.
    merkle_apr: float = 0.0
    #: What Merkl itself says is being paid here, staked and unstaked,
    #: with the tokens named.
    merkl: MerklRewards = NO_REWARDS
    #: Point campaigns from curve-frontend's own `external-rewards`
    #: directory.
    points: tuple[ExternalCampaign, ...] = ()
    is_meta: bool = False
    #: Address of the pool this one is built on, when it is a metapool.
    base_pool: str = ""
    #: How many coins the *contract* has, from the detail endpoint.
    onchain_coins: int = 0
    amplification: float = 0.0
    virtual_price: float = 0.0
    #: False until `merge_detail` has run: the list endpoint omits the
    #: LP token, the reserves and per-coin prices.
    detailed: bool = False
    #: True for a pool from a **Curve Lite** deployment, which is served
    #: by a different API (`api2.curve.finance`) that tracks no trading
    #: at all.
    lite: bool = False
    #: Which array shape the pool actually answered, once something has
    #: asked it.
    observed_dynamic: bool | None = None

    # -- derived ----------------------------------------------------------

    @property
    def registry_key(self) -> str:
        """The pool type, in one spelling."""
        return (self.registry or "").lower().replace("_", "-")

    @property
    def is_stableswap(self) -> bool:
        """Which exchange ABI this pool speaks."""
        registry = self.registry_key
        if registry in CRYPTO_POOL_TYPES:
            return False
        if registry in STABLE_POOL_TYPES:
            return True
        return True

    @property
    def dynamic_arrays(self) -> bool:
        """Does this pool take `uint256[]` where the others take `uint256[N]`?"""
        if self.observed_dynamic is not None:
            return self.observed_dynamic
        return self.registry_key in DYNAMIC_ARRAY_TYPES

    @property
    def pool_coins(self) -> list[Coin]:
        """The coins the pool contract actually has."""
        if self.onchain_coins and self.onchain_coins <= len(self.coins):
            return self.coins[: self.onchain_coins]
        return list(self.coins)

    @property
    def n_coins(self) -> int:
        """Coins on the contract -- the N in `uint256[N]`."""
        return len(self.pool_coins)

    @property
    def coin_symbols(self) -> list[str]:
        return [c.symbol for c in self.display_coins]

    @property
    def display_coins(self) -> list[Coin]:
        """The assets a depositor is actually exposed to."""
        if self.base_pool and len(self.coins) > 2:
            return [self.coins[0], *self.coins[2:]]
        return list(self.coins)

    @property
    def has_underlying(self) -> bool:
        """Does this pool have *underlying* coins distinct from its own?"""
        return bool(self.base_pool) and len(self.display_coins) > len(self.pool_coins)

    @property
    def has_gauge(self) -> bool:
        """Can LP be staked here? Killed gauges take no new deposits."""
        return bool(self.gauge)

    @property
    def any_gauge(self) -> str:
        """The gauge to read balances from, claim from and unstake from."""
        return self.gauge or self.dead_gauge

    @property
    def has_any_gauge(self) -> bool:
        return bool(self.any_gauge)

    @property
    def campaign_apr(self) -> float:
        """The Merkl rate, from Merkl where it answered and Curve otherwise."""
        return self.merkl.apr if self.merkl else self.merkle_apr

    @property
    def incentives_apr(self) -> float:
        """Total rewards APR: max-boost CRV, every incentive token, campaigns."""
        return (
            self.crv_apr[1] + sum(i.apr for i in self.incentives) + self.campaign_apr
        )

    @property
    def total_apr(self) -> float:
        return self.base_apr + self.incentives_apr

    @property
    def display_name(self) -> str:
        """Something short and identifying, whatever the API gave us."""
        name = self.name or ""
        for prefix in (
            "Curve.fi Factory Plain Pool: ",
            "Curve.fi Factory USD Metapool: ",
            "Curve.fi ",
            "Curve ",
        ):
            if name.startswith(prefix):
                name = name[len(prefix) :]
                break
        return name or self.address[:10]

    # -- campaigns --------------------------------------------------------

    def attach_campaigns(
        self,
        merkl_index: dict[str, list[Any]],
        external_index: dict[tuple[str, str], list[ExternalCampaign]],
        *,
        chain: str = "",
    ) -> Pool:
        """Look this pool up in the two campaign indexes."""
        self.merkl = merkl_split(
            merkl_index,
            pool=self.address,
            lp_token=self.lp_token,
            gauge=self.gauge,
        )
        where = (self.chain or chain).lower()
        self.points = tuple(external_index.get((where, self.address.lower()), ()))
        return self

    # -- parsing ----------------------------------------------------------

    @classmethod
    def from_v2(cls, raw: dict[str, Any], chain: str = "") -> Pool:
        """Build from one entry of the v2 `/pools/` list."""
        return cls(
            address=raw.get("address") or "",
            name=raw.get("name") or "",
            chain=chain,
            chain_id=_int(raw.get("chain_id")),
            registry=raw.get("pool_type") or raw.get("registry_type") or "",
            coins=[Coin.from_v2(c) for c in raw.get("coins") or []],
            lp_token=raw.get("lp_token_address") or "",
            tvl=_float(raw.get("tvl_usd")),
            volume_24h=_float(raw.get("trading_volume_24h")),
            base_apr=_float(raw.get("base_weekly_apr")),
            gauge=_first_live_gauge(raw.get("gauges")),
            dead_gauge=_first_dead_gauge(raw.get("gauges")),
            crv_apr=(_float(raw.get("crv_apr")), _float(raw.get("crv_apr_boosted"))),
            incentives=[
                Incentive.from_v2(r)
                for r in raw.get("extra_rewards_apr") or []
                if (r.get("symbol") or "").upper() != "CRV"
            ],
            merkle_apr=_float(raw.get("merkle_apr")),
            is_meta=bool(raw.get("is_metapool") or raw.get("metapool")),
            base_pool=raw.get("base_pool") or "",
        )

    def take_figures(self, figures: dict[str, float]) -> bool:
        """Take fresher TVL, volume and base APR, from wherever they came.

        The three that move between one look at the list and the next.
        Incentives are not among them: they are a v2 field and a chain
        payload does not carry them. True when something actually moved.
        """
        before = (self.tvl, self.volume_24h, self.base_apr)
        self.tvl = _float(figures.get("tvl_usd"))
        self.volume_24h = _float(figures.get("trading_volume_24h"))
        self.base_apr = _float(figures.get("base_weekly_apr"))
        return before != (self.tvl, self.volume_24h, self.base_apr)

    def merge_detail(self, raw: dict[str, Any]) -> Pool:
        """Fold in the extra fields only `/pools/{chain_id}/{address}` has."""
        self.lp_token = raw.get("lp_token_address") or self.lp_token or self.address
        self.registry = raw.get("registry_type") or raw.get("pool_type") or self.registry
        if raw.get("gauges"):
            self.gauge = _first_live_gauge(raw["gauges"]) or self.gauge
            self.dead_gauge = _first_dead_gauge(raw["gauges"]) or self.dead_gauge

        detail_coins = raw.get("coins") or []
        balances = raw.get("balances") or []
        balances_usd = raw.get("balances_usd") or []
        if detail_coins:
            self.coins = [Coin.from_v2(c) for c in detail_coins]
        for index, coin in enumerate(self.pool_coins):
            if index < len(balances):
                coin.balance = _float(balances[index])
            if index < len(balances_usd):
                coin.balance_usd = _float(balances_usd[index])

        self.onchain_coins = _int(raw.get("n_coins"))
        metadata = raw.get("metadata") or {}
        self.amplification = _float(metadata.get("a"))
        self.virtual_price = _float(metadata.get("virtual_price"))
        self.detailed = True
        return self

    @classmethod
    def from_lite(cls, raw: dict[str, Any], chain: str = "") -> Pool:
        """Build from one entry of Curve Lite's `get_pools/{chain_id}`."""
        coins = []
        for index, entry in enumerate(raw.get("coins") or []):
            decimals = _int(entry.get("decimals"), 18)
            balance = _float(entry.get("pool_balance")) / (10**decimals or 1)
            price = _float(entry.get("usd_price"))
            coins.append(
                Coin(
                    address=entry.get("address") or "",
                    symbol=entry.get("symbol") or "?",
                    decimals=decimals,
                    index=index,
                    usd_price=price,
                    balance=balance,
                    balance_usd=balance * price,
                )
            )
        killed = bool(raw.get("gauge_is_killed"))
        address = raw.get("gauge_address") or ""
        gauge = "" if killed else address
        return cls(
            address=raw.get("address") or "",
            name=raw.get("name") or raw.get("symbol") or "",
            chain=chain,
            chain_id=_int(raw.get("chain_id")),
            registry=raw.get("registry_id") or "",
            coins=coins,
            lp_token=raw.get("lp_token_address") or raw.get("address") or "",
            tvl=_float(raw.get("tvl")),
            gauge=gauge,
            dead_gauge=address if killed else "",
            incentives=[
                Incentive.from_lite(reward)
                for reward in raw.get("gauge_extra_rewards") or []
            ],
            is_meta=bool(raw.get("is_meta_pool")),
            onchain_coins=len(coins),
            amplification=_float(raw.get("amplification_coefficient")),
            virtual_price=_float(raw.get("virtual_price")) / 1e18,
            detailed=True,
            lite=True,
        )
