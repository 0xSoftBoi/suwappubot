"""Calldata encoding."""

from __future__ import annotations

import pytest

from curve import abi

# -- selectors -------------------------------------------------------------
# Verified against mainnet contracts: 3pool (StableSwap, 3 coins) and
# tricrypto2 (CryptoSwap, 3 coins).
KNOWN_SELECTORS = {
    "transfer(address,uint256)": "a9059cbb",
    "approve(address,uint256)": "095ea7b3",
    "allowance(address,address)": "dd62ed3e",
    "totalSupply()": "18160ddd",
    # `fee()` is on every pool; `dynamic_fee` only on StableSwap-NG.
    "fee()": "ddca3f43",
    "dynamic_fee(int128,int128)": "76a9cd3e",
    "get_dy(int128,int128,uint256)": "5e0d443f",
    "exchange(int128,int128,uint256,uint256)": "3df02124",
    "add_liquidity(uint256[3],uint256)": "4515cef3",
    "remove_liquidity(uint256,uint256[3])": "ecb586a5",
    "remove_liquidity_one_coin(uint256,int128,uint256)": "1a4d01d2",
    "calc_withdraw_one_coin(uint256,int128)": "cc2b27d7",
    "calc_token_amount(uint256[3],bool)": "3883e119",
    "deposit(uint256)": "b6b55f25",
    "withdraw(uint256)": "2e1a7d4d",
}


@pytest.mark.parametrize("signature,expected", KNOWN_SELECTORS.items())
def test_selector_matches_deployed_contract(signature: str, expected: str) -> None:
    assert abi.selector(signature) == expected


def test_stableswap_and_cryptoswap_selectors_differ() -> None:
    stable = abi.encode_get_dy(0, 1, 10**18, stableswap=True)
    crypto = abi.encode_get_dy(0, 1, 10**18, stableswap=False)
    assert stable[:10] != crypto[:10]
    assert stable[:10] == "0x5e0d443f"
    assert stable[10:] == crypto[10:]


# -- encoding --------------------------------------------------------------


def test_approve_encoding() -> None:
    data = abi.encode_approve("0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7", 12_500_000)
    assert data == (
        "0x095ea7b3"
        "000000000000000000000000bebc44782c7db0a1a60cb6fe97d0b483032ff1c7"
        "0000000000000000000000000000000000000000000000000000000000bebc20"
    )


def test_add_liquidity_array_length_is_in_the_signature() -> None:
    two = abi.encode_add_liquidity([1, 2], 0)
    three = abi.encode_add_liquidity([1, 2, 3], 0)
    assert two[:10] != three[:10]
    assert len(three) == 2 + 8 + 64 * 4
    assert len(two) == 2 + 8 + 64 * 3


def test_fixed_array_is_encoded_inline_without_offset() -> None:
    data = abi.encode_remove_liquidity(5, [7, 9])
    body = data[10:]
    words = [body[i : i + 64] for i in range(0, len(body), 64)]
    assert [int(w, 16) for w in words] == [5, 7, 9]


def test_negative_index_uses_twos_complement() -> None:
    # Never happens with real coin indices, but the encoder should be correct.
    data = abi.encode_get_dy(-1, 0, 0, stableswap=True)
    assert data[10:74] == "f" * 64


def test_uint_range_is_enforced() -> None:
    with pytest.raises(ValueError):
        abi.encode_approve("0x" + "11" * 20, abi.MAX_UINT256 + 1)


def test_bad_address_is_rejected() -> None:
    with pytest.raises(ValueError):
        abi.encode_approve("not-an-address", 1)


# -- slippage --------------------------------------------------------------


def test_slippage_rounds_down() -> None:
    assert abi.apply_slippage(1000, 0.5) == 995
    assert abi.apply_slippage(10**18, 1.0) == 990_000_000_000_000_000


def test_zero_slippage_is_identity() -> None:
    assert abi.apply_slippage(12345, 0.0) == 12345


def test_slippage_never_exceeds_the_estimate() -> None:
    for tolerance in (0.0, 0.01, 0.5, 1.0, 5.0, 50.0):
        assert abi.apply_slippage(10**18, tolerance) <= 10**18


def test_slippage_on_zero_is_zero() -> None:
    assert abi.apply_slippage(0, 0.5) == 0
    assert abi.apply_slippage(-5, 0.5) == 0


def test_out_of_range_slippage_is_rejected() -> None:
    with pytest.raises(ValueError):
        abi.apply_slippage(100, 100.0)
    with pytest.raises(ValueError):
        abi.apply_slippage(100, -1.0)
