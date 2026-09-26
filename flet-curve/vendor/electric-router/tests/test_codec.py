"""Differential test: our stdlib ABI codec against eth_abi.

`eth_abi` is a dev-only dependency and exists purely as the oracle here.  If
these pass, `core/codec.py` can be trusted in the browser where eth_abi cannot
be installed.
"""

from __future__ import annotations

import pytest
from eth_abi import decode as abi_decode
from eth_abi import encode as abi_encode
from eth_utils import function_signature_to_4byte_selector

from erouter.core import codec

# (types, values) pairs covering every shape the quoter ABI uses, plus the
# awkward ones: dynamic inside a tuple inside a dynamic array.
CASES = [
    (["uint256"], [0]),
    (["uint256"], [2**256 - 1]),
    (["int128", "int128", "uint256"], [0, 1, 10**18]),
    (["int128"], [-1]),
    (["int128"], [-(2**127)]),
    (["int256"], [-12345678901234567890]),
    (["address"], ["0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"]),
    (["address", "uint256"], ["0x" + "00" * 20, 5]),
    (["bool", "bool"], [True, False]),
    (["bytes"], [b""]),
    (["bytes"], [b"\x01\x02\x03"]),
    (["bytes"], [b"\xff" * 100]),
    (["string"], ["3pool"]),
    (["bytes4"], [b"\xde\xad\xbe\xef"]),
    (["bytes32"], [b"\x11" * 32]),
    (["uint256[]"], [[]]),
    (["uint256[]"], [[1, 2, 3]]),
    (["uint256[3]"], [[7, 8, 9]]),
    (["uint256[2]", "uint256"], [[1, 2], 3]),
    (["uint256", "uint256[]"], [1, [2, 3]]),
    # the RouteQuoter Probe struct
    (["(address,uint8,uint8,uint8,uint8,uint256)"], [("0x" + "11" * 20, 1, 0, 2, 3, 10**18)]),
    (
        ["(address,uint8,uint8,uint8,uint8,uint256)[]"],
        [[("0x" + "11" * 20, 1, 0, 2, 3, 10**18), ("0x" + "22" * 20, 0, 1, 0, 2, 5)]],
    ),
    # the RouteQuoter Leg struct
    (
        ["uint256", "uint8", "(address,uint8,uint8,uint8,uint8,uint8,uint8,uint16)[]"],
        [10**24, 3, [("0x" + "33" * 20, 0, 0, 1, 2, 0, 1, 4620)]],
    ),
    # dynamic member inside a tuple inside a dynamic array -- raw_batch's return
    (["(bool,bytes)[]"], [[(True, b"\x00" * 32), (False, b""), (True, b"\xab" * 64)]]),
    (["(uint256,uint256[])"], [(5, [1, 2, 3])]),
    (["(uint256,bytes,uint256)[]"], [[(1, b"\x01", 2), (3, b"", 4)]]),
    (["uint256[][]"], [[[1, 2], [], [3]]]),
    (["bool[2][]"], [[[True, False], [False, True]]]),
]


@pytest.mark.parametrize(("types", "values"), CASES, ids=lambda v: str(v)[:60])
def test_encode_matches_eth_abi(types, values):
    assert codec.encode(types, values) == abi_encode(types, values)


@pytest.mark.parametrize(("types", "values"), CASES, ids=lambda v: str(v)[:60])
def test_roundtrip(types, values):
    """Our decoder inverts eth_abi's encoder (so both directions are checked)."""
    got = codec.decode(types, abi_encode(types, values))

    def norm(v):
        if isinstance(v, (list, tuple)):
            return [norm(x) for x in v]
        if isinstance(v, str) and v.startswith("0x"):
            return v.lower()
        return v

    assert norm(got) == norm(list(values))


@pytest.mark.parametrize(("types", "values"), CASES, ids=lambda v: str(v)[:60])
def test_eth_abi_decodes_ours(types, values):
    """eth_abi inverts our encoder."""
    assert abi_decode(types, codec.encode(types, values)) is not None


@pytest.mark.parametrize(
    "sig",
    [
        "get_dy(int128,int128,uint256)",
        "get_dy(uint256,uint256,uint256)",
        "balances(uint256)",
        "balances(int128)",
        "calc_token_amount(uint256[3],bool)",
        "calc_token_amount(uint256[],bool)",
        "calc_withdraw_one_coin(uint256,int128)",
        "previewDeposit(uint256)",
        "aggregate3((address,bool,bytes)[])",
        "decimals()",
        "transfer(address,uint256)",
    ],
)
def test_selector_matches(sig):
    assert codec.selector(sig) == function_signature_to_4byte_selector(sig)


def test_signature_types_handles_nesting():
    assert codec.signature_types("f((address,uint8)[],uint256,(bool,bytes))") == [
        "(address,uint8)[]",
        "uint256",
        "(bool,bytes)",
    ]
    assert codec.signature_types("decimals()") == []


def test_encode_call_is_selector_plus_args():
    data = codec.encode_call("get_dy(int128,int128,uint256)", 0, 1, 10**18)
    assert data[:4] == codec.selector("get_dy(int128,int128,uint256)")
    assert codec.decode(["int128", "int128", "uint256"], data[4:]) == [0, 1, 10**18]


def test_decode_uint_rejects_empty_returndata():
    """The trap: a pool that lacks a function returns b'', not a revert.

    int.from_bytes(b'', 'big') == 0 would quote every swap at zero.
    """
    with pytest.raises(ValueError):
        codec.decode_uint(b"")
    with pytest.raises(ValueError):
        codec.decode_uint(b"\x01" * 31)
    assert codec.decode_uint((123).to_bytes(32, "big")) == 123


def test_out_of_range_values_raise():
    with pytest.raises(ValueError):
        codec.encode(["uint8"], [256])
    with pytest.raises(ValueError):
        codec.encode(["int128"], [2**127])
    with pytest.raises(ValueError):
        codec.encode(["uint256"], [-1])
