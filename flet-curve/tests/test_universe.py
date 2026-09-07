"""The list of coins a person can pick, built out of the pool rows."""

from __future__ import annotations

# -- the chain's own gas token ----------------------------------------------


def entry(address, symbol, name="", decimals=18, volume=0.0, pools=0):
    from router.universe import CoinEntry

    return CoinEntry(address, symbol, name, decimals, volume, pools)


WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"


def test_the_gas_token_goes_in_beside_its_wrapper():
    """Nothing on gnosis or base names its gas token, so the list built out
    of the pool rows was missing the one coin everybody arrives holding."""
    from router.universe import NATIVE, with_native

    coins = [entry("0x" + "11" * 20, "USDC", "USD Coin", 6, 900.0, 3),
             entry(WETH, "WETH", "Wrapped Ether", 18, 500.0, 2),
             entry("0x" + "22" * 20, "DAI", "Dai", 18, 100.0, 1)]

    out = with_native(coins, symbol="ETH", wrapped=WETH)

    assert [c.symbol for c in out] == ["USDC", "ETH", "WETH", "DAI"]
    native = out[1]
    assert native.address == NATIVE
    assert native.name == "Ether", "it kept the wrapper's own name"
    assert (native.volume, native.pools, native.decimals) == (500.0, 2, 18), (
        "the two are the same liquidity seen from either side"
    )


def test_a_gas_token_a_pool_already_names_is_left_alone():
    """Eight mainnet pools name ETH with the sentinel, and that entry carries
    real volume of its own -- replacing it would throw that away."""
    from router.universe import NATIVE, with_native

    coins = [entry(NATIVE, "ETH", "Ether", 18, 2_134_522.0, 8),
             entry(WETH, "WETH", "Wrapped Ether", 18, 500.0, 2)]

    out = with_native(coins, symbol="ETH", wrapped=WETH)

    assert out == coins


def test_no_wrapper_in_the_list_means_no_gas_token_offered():
    """The router aliases the gas token onto its wrapper's node.  Where the
    wrapper cannot be routed, neither can the thing that wraps into it."""
    from router.universe import with_native

    coins = [entry("0x" + "11" * 20, "USDC", "USD Coin", 6, 900.0, 3)]

    assert with_native(coins, symbol="ETH", wrapped=WETH) == coins
