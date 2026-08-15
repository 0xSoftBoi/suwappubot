"""Tests for Multicall3 batched EVM balance fetching.

Covers: bot/utils/multicall.multicall_balances (one aggregate3 eth_call for
N tokens + native, per-call failure omission) and the wallet.py fallback to
the per-token RPC path when the whole multicall fails.

All web3/RPC interaction is mocked — no network calls.
"""

from __future__ import annotations

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from unittest.mock import MagicMock  # noqa: E402

import pytest  # noqa: E402
from eth_abi import encode as abi_encode  # noqa: E402
from web3 import Web3  # noqa: E402

from bot.utils.multicall import (  # noqa: E402
    MULTICALL3_ADDRESS,
    NATIVE_KEY,
    multicall_balances,
)

HOLDER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"


@pytest.fixture(autouse=True)
def _asyncio_timeout_shim(monkeypatch):
    """asyncio.timeout is 3.11+; shim it for older local interpreters."""
    import asyncio
    import contextlib

    if not hasattr(asyncio, "timeout"):

        @contextlib.asynccontextmanager
        async def _noop_timeout(_seconds):
            yield

        monkeypatch.setattr(asyncio, "timeout", _noop_timeout, raising=False)
    yield


TOKEN_A = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
TOKEN_B = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
TOKEN_C = "0x6B175474E89094C44Da98b954EedeAC495271d0F"


def _encode_aggregate3_result(results: list[tuple[bool, int | None]]) -> bytes:
    """ABI-encode an aggregate3 return value: (bool success, bytes returnData)[]."""
    tuples = []
    for success, balance in results:
        data = b"" if balance is None else balance.to_bytes(32, "big")
        tuples.append((success, data))
    return abi_encode(["(bool,bytes)[]"], [tuples])


def _mock_web3(aggregate3_results: list[tuple[bool, int | None]]) -> Web3:
    """Real Web3 (for ABI encoding) with eth.call mocked to return canned data."""
    w3 = Web3(Web3.HTTPProvider("http://127.0.0.1:1"))
    return_bytes = _encode_aggregate3_result(aggregate3_results)
    mock_call = MagicMock(return_value=return_bytes)
    # Shadow the class-level Method descriptor with an instance attribute
    w3.eth.call = mock_call
    w3.eth._mock_call = mock_call
    return w3


@pytest.mark.asyncio
async def test_single_aggregate3_call_for_n_tokens():
    """N tokens + native are fetched with exactly ONE eth_call."""
    w3 = _mock_web3(
        [
            (True, 10**18),  # native
            (True, 111),  # TOKEN_A
            (True, 222),  # TOKEN_B
            (True, 0),  # TOKEN_C
        ]
    )

    result = await multicall_balances(w3, HOLDER, [TOKEN_A, TOKEN_B, TOKEN_C])

    assert w3.eth._mock_call.call_count == 1
    # The single eth_call targets the Multicall3 contract
    tx = w3.eth._mock_call.call_args[0][0]
    assert tx["to"].lower() == MULTICALL3_ADDRESS.lower()

    assert result[NATIVE_KEY] == 10**18
    assert result[TOKEN_A] == 111
    assert result[TOKEN_B] == 222
    assert result[TOKEN_C] == 0  # zero balance still reported (raw)


@pytest.mark.asyncio
async def test_results_map_back_to_token_addresses():
    """Result dict is keyed by the original token addresses as passed in."""
    w3 = _mock_web3([(True, 5), (True, 7), (True, 9)])

    result = await multicall_balances(w3, HOLDER, [TOKEN_B, TOKEN_A])

    assert result == {NATIVE_KEY: 5, TOKEN_B: 7, TOKEN_A: 9}


@pytest.mark.asyncio
async def test_failed_inner_call_omits_only_that_token():
    """A reverted inner call omits that token only; others survive."""
    w3 = _mock_web3(
        [
            (True, 42),  # native
            (False, None),  # TOKEN_A reverted
            (True, 999),  # TOKEN_B
        ]
    )

    result = await multicall_balances(w3, HOLDER, [TOKEN_A, TOKEN_B])

    assert TOKEN_A not in result
    assert result[NATIVE_KEY] == 42
    assert result[TOKEN_B] == 999


@pytest.mark.asyncio
async def test_empty_return_data_omitted():
    """success=True but empty returnData (non-contract target) is omitted."""
    w3 = _mock_web3([(True, 1), (True, None), (True, 2)])

    result = await multicall_balances(w3, HOLDER, [TOKEN_A, TOKEN_B])

    assert TOKEN_A not in result
    assert result == {NATIVE_KEY: 1, TOKEN_B: 2}


@pytest.mark.asyncio
async def test_full_call_exception_propagates():
    """RPC error on the batched call raises so callers can fall back."""
    w3 = Web3(Web3.HTTPProvider("http://127.0.0.1:1"))
    w3.eth.call = MagicMock(side_effect=ConnectionError("rpc down"))

    with pytest.raises(Exception):
        await multicall_balances(w3, HOLDER, [TOKEN_A])


@pytest.mark.asyncio
async def test_wallet_falls_back_to_per_token_path(monkeypatch):
    """wallet.py: multicall failure → existing per-token RPC path used."""
    from bot.services.wallet import WalletService

    ws = WalletService()

    async def boom(chain_name, chain, address):
        raise RuntimeError("no multicall3 on this chain")

    per_token_calls = []

    async def fake_native(chain_name, address):
        per_token_calls.append(("native", chain_name))
        return 1.5

    async def fake_token(chain_name, token_symbol, address):
        per_token_calls.append((token_symbol, chain_name))
        return 2.5

    monkeypatch.setattr(ws, "_fetch_evm_chain_multicall", boom)
    monkeypatch.setattr(ws, "get_evm_native_balance", fake_native)
    monkeypatch.setattr(ws, "get_evm_token_balance", fake_token)

    balances = await ws._fetch_balances_live(HOLDER, "evm")

    # Per-token fallback path was exercised
    assert per_token_calls, "expected fallback per-token RPC calls"
    assert any(k == "native" for k, _ in per_token_calls)
    # Balances populated from the fallback values
    assert balances
    for chain_balances in balances.values():
        assert all(v in (1.5, 2.5) for v in chain_balances.values())


@pytest.mark.asyncio
async def test_wallet_uses_multicall_when_it_succeeds(monkeypatch):
    """wallet.py: when multicall works, per-token path is NOT used."""
    from bot.services.wallet import WalletService

    ws = WalletService()

    async def fake_multicall(chain_name, chain, address):
        return chain_name, {"USDC": 12.34}

    async def fail_per_token(*args, **kwargs):
        raise AssertionError("per-token path should not run when multicall succeeds")

    monkeypatch.setattr(ws, "_fetch_evm_chain_multicall", fake_multicall)
    monkeypatch.setattr(ws, "get_evm_native_balance", fail_per_token)
    monkeypatch.setattr(ws, "get_evm_token_balance", fail_per_token)

    balances = await ws._fetch_balances_live(HOLDER, "evm")

    assert balances
    for chain_balances in balances.values():
        assert chain_balances == {"USDC": 12.34}
