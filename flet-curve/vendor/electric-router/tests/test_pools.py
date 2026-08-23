"""Pool parsing and dialect classification -- no chain."""

from __future__ import annotations

import pytest

from erouter.core.pools import (
    PoolSpec,
    dialect_from_probes,
    parse_universe,
    registry_key,
)
from erouter.core.types import ArcKind, Dialect


def coin(address, symbol, decimals, index):
    return {
        "address": address,
        "symbol": symbol,
        "decimals": decimals,
        "pool_index": index,
    }


THREEPOOL_RAW = {
    "address": "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7",
    "name": "Curve.fi DAI/USDC/USDT",
    "pool_type": "main",
    "tvl_usd": 159_566_745.0,
    "coins": [
        coin("0x6B17", "DAI", 18, 0),
        coin("0xA0b8", "USDC", 6, 1),
        coin("0xdAC1", "USDT", 6, 2),
    ],
}

# A metapool: the API's `coins` is [metaToken, basePoolLP, ...underlying], and
# only the first two are the pool's OWN coins.
METAPOOL_RAW = {
    "address": "0xMETA",
    "name": "World Liberty USD1 Pool",
    "pool_type": "stableswapng",
    "is_metapool": True,
    "base_pool": "0xBASE",
    "tvl_usd": 10_052_599.0,
    "coins": [
        coin("0x8d0D", "USD1", 18, 0),
        coin("0xCRV2", "crv2pool", 18, 1),
        coin("0xA0b8", "USDC", 6, 2),
        coin("0xdAC1", "USDT", 6, 3),
    ],
}


def test_registry_key_folds_the_three_naming_schemes():
    assert registry_key("factory_crypto") == "factory-crypto"
    assert registry_key("FACTORY-CRYPTO") == "factory-crypto"
    assert registry_key(None) == ""


def test_plain_pool_parsing():
    spec = PoolSpec.from_api(THREEPOOL_RAW)
    assert spec.n_coins == 3
    assert [c.symbol for c in spec.coins] == ["DAI", "USDC", "USDT"]
    assert spec.table_dialect is Dialect.STABLE
    assert spec.swap_kind is ArcKind.SWAP_STABLE
    assert spec.swap_arc_count() == 6
    assert sorted(spec.swap_pairs()) == [
        (0, 1), (0, 2), (1, 0), (1, 2), (2, 0), (2, 1)
    ]


def test_metapool_uses_only_its_own_coins():
    """N is part of the calldata signature, so the underlying view is wrong."""
    spec = PoolSpec.from_api(METAPOOL_RAW)
    assert spec.is_meta
    assert spec.n_coins == 2
    assert [c.symbol for c in spec.coins] == ["USD1", "crv2pool"]
    assert spec.swap_arc_count() == 2


def test_crypto_types_classify_as_crypto():
    for pool_type in ("crypto", "factory_crypto", "factory_tricrypto", "twocryptong"):
        spec = PoolSpec("0x", "x", pool_type, ())
        assert spec.table_dialect is Dialect.CRYPTO
        assert spec.swap_kind is ArcKind.SWAP_CRYPTO


def test_unknown_type_is_unknown_not_assumed_stable():
    """flet-curve-demo defaults unknown to stable, which is right for a UI.

    Here a mis-dispatched call returns empty data and reads as a zero quote
    inside a 900-arc batch, so guessing is worse than admitting ignorance.
    """
    spec = PoolSpec("0x", "x", "some-new-factory", ())
    assert spec.table_dialect is None
    assert spec.swap_kind is None


def test_dynamic_arrays_only_for_stableswap_ng():
    assert PoolSpec("0x", "x", "stableswapng", ()).dynamic_arrays
    assert PoolSpec("0x", "x", "factory-stable-ng", ()).dynamic_arrays
    assert not PoolSpec("0x", "x", "main", ()).dynamic_arrays
    assert PoolSpec("0x", "x", "main", ()).deposit_kind is ArcKind.DEPOSIT_FIXED
    assert PoolSpec("0x", "x", "stableswapng", ()).deposit_kind is ArcKind.DEPOSIT_DYN


def test_missing_decimals_default_to_18():
    spec = PoolSpec.from_api(
        {"address": "0x", "pool_type": "main", "coins": [{"address": "0xa"}, {"address": "0xb"}]}
    )
    assert [c.decimals for c in spec.coins] == [18, 18]


def test_parse_universe_drops_unusable_entries():
    specs = parse_universe([
        THREEPOOL_RAW,
        {"address": "0xONE", "pool_type": "main", "coins": [coin("0xa", "A", 18, 0)]},
        {"address": "", "pool_type": "main", "coins": []},
    ])
    assert len(specs) == 1


# ------------------------------------------------------ dialect resolution


@pytest.mark.parametrize(
    ("table", "stable_ok", "crypto_ok", "expected", "note"),
    [
        (Dialect.STABLE, True, False, Dialect.STABLE, "PROBED"),
        (Dialect.CRYPTO, False, True, Dialect.CRYPTO, "PROBED"),
        # The measured mis-type: table says stable, only uint256 answers.
        (Dialect.STABLE, False, True, Dialect.CRYPTO, "PROBED"),
        (None, True, False, Dialect.STABLE, "PROBED"),
        # Neither answers: paused/dust.  Keep the table verdict -- 4 real pools
        # have the *reverting* spelling as the implemented one.
        (Dialect.CRYPTO, False, False, Dialect.CRYPTO, "NO_ANSWER"),
        (None, False, False, None, "NO_ANSWER"),
    ],
)
def test_dialect_resolution(table, stable_ok, crypto_ok, expected, note):
    assert dialect_from_probes(table, stable_ok, crypto_ok) == (expected, note)


def test_both_answering_is_flagged_as_a_decoder_bug():
    """Impossible on a real pool; measured `both = 0` across the universe."""
    got, note = dialect_from_probes(Dialect.STABLE, True, True)
    assert note == "AMBIGUOUS"
    assert got is Dialect.STABLE
