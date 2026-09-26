"""Parsing the Prices API v2 shapes, and the numbers the UI sorts on."""

from __future__ import annotations

from curve.external import ExternalCampaign, by_pool
from curve.merkl import MerklCampaign, MerklToken, by_identifier
from curve.models import Pool

#: A pool paying a Merkl campaign, and one paying only points.
MERKL_POOL = "0xd50492de3541d75e61edc34d1aa79c7dc2d20da9"
POINTS_POOL = "0xf4d0cf32908b2c7f1021339c43df0f77f06896d7"
_PIKU = MerklToken("PIKU", "0x2e4039e8")
_ORBITAL = MerklToken("Orbital Points", "0x10710501", points=True)
_MERKL_INDEX = by_identifier(
    [
        MerklCampaign(1, MERKL_POOL, "Provide liquidity", 325.11, "a", (_PIKU,)),
        MerklCampaign(1, POINTS_POOL, "Provide liquidity", 0.0, "c", (_ORBITAL,)),
    ]
)
_POINTS_INDEX = by_pool(
    [
        ExternalCampaign(
            platform="Ethena",
            dashboard="https://app.ethena.fi/liquidity",
            network="ethereum",
            address=POINTS_POOL,
            multiplier="30x",
            tags=("points",),
        )
    ]
)

# One entry of `/v2/pools/?chain_id=1`.
LIST_3POOL = {
    "chain_id": 1,
    "name": "Curve.fi DAI/USDC/USDT",
    "address": "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7",
    "creation_date": 1599422178,
    "pool_type": "main",
    "is_metapool": False,
    "base_pool": None,
    "tvl_usd": 160012141.759445,
    "trading_volume_24h": 17281820.13,
    "coins": [
        {
            "pool_index": 0,
            "symbol": "DAI",
            "name": "Dai Stablecoin",
            "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            "decimals": 18,
        },
        {
            "pool_index": 1,
            "symbol": "USDC",
            "name": "USD Coin",
            "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            "decimals": 6,
        },
    ],
    "base_daily_apr": 0.0001,
    "base_weekly_apr": 0.0002,
    "crv_apr": 1.56,
    "crv_apr_boosted": 3.90,
    "extra_rewards_apr": [],
    "merkle_apr": 0.0,
    # The list endpoint's shape: objects with a kill flag.
    "gauges": [{"address": "0xbfcf63294ad7105dea65aa58f8ae5be2d9d0952a", "is_killed": False}],
}

# The same pool from `/v2/pools/1/0xbEbc…`.
DETAIL_3POOL = {
    "lp_token_address": "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490",
    "registry_type": "main",
    "n_coins": 2,
    # The detail endpoint's shape: bare strings.
    "gauges": ["0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A"],
    "coins": [
        {
            "pool_index": 0,
            "symbol": "DAI",
            "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            "decimals": 18,
            "usd_price": 1.00005,
        },
        {
            "pool_index": 1,
            "symbol": "USDC",
            "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            "decimals": 6,
            "usd_price": 1.0,
        },
    ],
    "balances": [25630533.14, 25503596.21],
    "balances_usd": [25631776.37, 25503596.21],
    "metadata": {"a": 4000.0, "virtual_price": 1.0398237173447054e18, "fee": 1500000.0},
}


def test_parses_a_list_entry() -> None:
    pool = Pool.from_v2(LIST_3POOL, "ethereum")
    assert pool.chain == "ethereum"
    assert pool.chain_id == 1
    assert pool.registry == "main"
    assert pool.tvl == 160012141.759445
    assert pool.volume_24h == 17281820.13
    assert pool.n_coins == 2
    assert pool.coin_symbols == ["DAI", "USDC"]


def test_base_apr_comes_straight_off_the_pool() -> None:
    pool = Pool.from_v2(LIST_3POOL)
    assert pool.base_apr == 0.0002  # weekly, matching Curve's own column


def test_crv_range_is_the_boost_pair() -> None:
    assert Pool.from_v2(LIST_3POOL).crv_apr == (1.56, 3.90)


def test_gauge_parsed_from_the_list_shape() -> None:
    assert Pool.from_v2(LIST_3POOL).gauge.lower().startswith("0xbfcf")


def test_gauge_parsed_from_the_detail_shape() -> None:
    pool = Pool.from_v2(LIST_3POOL).merge_detail(DETAIL_3POOL)
    assert pool.gauge == "0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A"


def test_killed_gauges_are_ignored() -> None:
    pool = Pool.from_v2(
        {"gauges": [{"address": "0xdead", "is_killed": True}]}
    )
    assert not pool.has_gauge
    live = Pool.from_v2(
        {
            "gauges": [
                {"address": "0xdead", "is_killed": True},
                {"address": "0xlive", "is_killed": False},
            ]
        }
    )
    assert live.gauge == "0xlive"


def test_missing_and_null_fields_default_rather_than_raise() -> None:
    pool = Pool.from_v2({"address": "0xabc", "coins": [{}]})
    assert pool.tvl == 0.0
    assert pool.crv_apr == (0.0, 0.0)
    assert pool.coins[0].symbol == "?"
    assert pool.coins[0].decimals == 18  # the safe ERC-20 default
    assert not pool.has_gauge
    assert not pool.detailed


def test_pool_type_decides_the_abi_variant() -> None:
    for kind in ("main", "factory", "crvusd", "stableswapng"):
        assert Pool.from_v2({"pool_type": kind}).is_stableswap
    for kind in ("crypto", "factory_crypto", "factory_tricrypto", "twocryptong"):
        assert not Pool.from_v2({"pool_type": kind}).is_stableswap


def test_v1_registry_spellings_still_dispatch() -> None:
    assert Pool.from_v2({"pool_type": "factory-stable-ng"}).is_stableswap
    assert not Pool.from_v2({"pool_type": "factory-twocrypto"}).is_stableswap


def test_unknown_pool_type_defaults_to_stableswap() -> None:
    assert Pool.from_v2({"pool_type": "some-new-factory"}).is_stableswap


def test_crv_is_not_double_counted_as_an_incentive() -> None:
    pool = Pool.from_v2(
        {
            "crv_apr": 2.93,
            "crv_apr_boosted": 7.32,
            "extra_rewards_apr": [
                {"symbol": "CRV", "apr": 7.32},
                {"symbol": "YB", "apr": 1.5},
            ],
        }
    )
    assert [i.symbol for i in pool.incentives] == ["YB"]
    assert pool.incentives_apr == 7.32 + 1.5


def test_incentives_apr_includes_merkle() -> None:
    pool = Pool.from_v2(
        {"crv_apr": 1.0, "crv_apr_boosted": 2.0, "merkle_apr": 322.4}
    )
    assert pool.incentives_apr == 2.0 + 322.4


def test_merkl_replaces_curves_merkle_figure_rather_than_adding_to_it() -> None:
    pool = Pool.from_v2(
        {"address": MERKL_POOL, "crv_apr_boosted": 2.0, "merkle_apr": 325.06}
    )
    assert pool.campaign_apr == 325.06  # nothing attached yet: Curve's figure

    pool.attach_campaigns(_MERKL_INDEX, {})
    assert pool.campaign_apr == 325.11  # Merkl's, and only Merkl's
    assert pool.incentives_apr == 2.0 + 325.11


def test_points_add_nothing_to_any_total() -> None:
    pool = Pool.from_v2({"address": POINTS_POOL, "crv_apr_boosted": 2.0}, "ethereum")
    pool.attach_campaigns(_MERKL_INDEX, _POINTS_INDEX)
    assert pool.merkl.points
    assert pool.points
    assert pool.incentives_apr == 2.0


def test_attaching_twice_replaces_rather_than_accumulates() -> None:
    pool = Pool.from_v2({"address": MERKL_POOL, "crv_apr_boosted": 2.0})
    pool.attach_campaigns(_MERKL_INDEX, {})
    pool.attach_campaigns(_MERKL_INDEX, {})
    assert pool.campaign_apr == 325.11


def test_total_apr_adds_base() -> None:
    pool = Pool.from_v2({"crv_apr": 1.0, "crv_apr_boosted": 2.0, "base_weekly_apr": 0.5})
    assert pool.total_apr == 2.5


def test_display_name_strips_curve_prefixes() -> None:
    assert Pool.from_v2(LIST_3POOL).display_name == "DAI/USDC/USDT"
    assert (
        Pool.from_v2({"name": "Curve.fi Factory Plain Pool: stETH"}).display_name == "stETH"
    )
    assert Pool.from_v2({"address": "0x1234567890abcdef"}).display_name == "0x12345678"


# -- merge_detail ----------------------------------------------------------


def test_merge_detail_supplies_what_the_list_lacks() -> None:
    pool = Pool.from_v2(LIST_3POOL, "ethereum")
    assert not pool.lp_token
    assert pool.coins[0].balance == 0.0

    pool.merge_detail(DETAIL_3POOL)
    assert pool.detailed
    assert pool.lp_token == "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"
    assert pool.coins[0].balance == 25630533.14
    assert pool.coins[0].balance_usd == 25631776.37
    assert pool.coins[0].usd_price == 1.00005
    assert pool.amplification == 4000.0
    assert pool.virtual_price == 1.0398237173447054e18


def test_merge_detail_survives_a_sparse_payload() -> None:
    pool = Pool.from_v2(LIST_3POOL).merge_detail({})
    assert pool.detailed
    assert pool.lp_token == LIST_3POOL["address"]


def test_merge_detail_tolerates_short_balance_arrays() -> None:
    pool = Pool.from_v2(LIST_3POOL).merge_detail({**DETAIL_3POOL, "balances": [1.0]})
    assert pool.coins[0].balance == 1.0
    assert pool.coins[1].balance == 0.0


def test_a_killed_gauge_is_kept_apart_rather_than_dropped() -> None:
    """Killed means it pays no more CRV and takes no new stakes. It does
    not mean it is empty: 161 of Ethereum's 2,219 pools have only killed
    gauges, and sampled ones still held LP. Dropping the address left
    those balances invisible and with no way out of the UI."""
    pool = Pool.from_v2(
        {
            "address": "0x" + "11" * 20,
            "name": "old",
            "gauges": [{"address": "0x" + "22" * 20, "is_killed": True}],
        }
    )

    assert pool.gauge == "", "nothing new may be staked there"
    assert pool.has_gauge is False
    assert pool.dead_gauge == "0x" + "22" * 20
    assert pool.any_gauge == pool.dead_gauge, "but it is still readable"
    assert pool.has_any_gauge is True


def test_a_live_gauge_wins_over_a_killed_one() -> None:
    pool = Pool.from_v2(
        {
            "address": "0x" + "11" * 20,
            "name": "replaced",
            "gauges": [
                {"address": "0x" + "22" * 20, "is_killed": True},
                {"address": "0x" + "33" * 20},
            ],
        }
    )

    assert pool.gauge == "0x" + "33" * 20
    assert pool.any_gauge == pool.gauge
    assert pool.has_gauge is True
