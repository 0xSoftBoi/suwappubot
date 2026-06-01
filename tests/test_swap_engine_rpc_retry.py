import os
import asyncio
from datetime import datetime, timezone

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from web3 import Web3

from bot.services.swap_engine import SwapEngine, SwapQuote, SwapError


def _make_quote():
    return SwapQuote(
        provider="lifi",
        from_chain="ethereum",
        to_chain="ethereum",
        from_token="ETH",
        to_token="USDC",
        from_amount="100000000000000",
        from_amount_human=0.0001,
        to_amount="1",
        to_amount_human=1,
        to_amount_min="1",
        gas_cost_usd=0.1,
        fee_cost_usd=0,
        total_cost_usd=0.1,
        estimated_time=30,
        price_impact=0,
        exchange_rate=1,
        raw_quote={"transactionRequest": {"to": "0x0000000000000000000000000000000000000001"}},
        timestamp=datetime.now(timezone.utc),
    )


def test_lifi_evm_execution_retries_rate_limited_rpc(monkeypatch):
    engine = SwapEngine()
    calls = {"count": 0, "reported": []}

    class FakeProvider:
        endpoint_uri = "https://rate-limited.example"

    class FakeWeb3:
        provider = FakeProvider()

    async def fake_wallet_for_signing(_wallet_data):
        return object()

    def fake_get_web3(_chain):
        return FakeWeb3()

    async def fake_execute_lifi_evm_swap(**_kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            raise RuntimeError("429 Too Many Requests")
        return "0xsubmitted"

    def fake_report_failure(chain_name, url, error):
        calls["reported"].append((chain_name, url, error))

    monkeypatch.setattr(engine, "_get_wallet_for_signing", fake_wallet_for_signing)
    monkeypatch.setattr(engine.wallet_service, "_get_web3", fake_get_web3)
    monkeypatch.setattr(engine, "_execute_lifi_evm_swap", fake_execute_lifi_evm_swap)
    monkeypatch.setattr("bot.services.swap_engine.rpc_manager.report_failure", fake_report_failure)

    quote = _make_quote()

    result = asyncio.run(engine._execute_lifi_swap(quote, {"address": "0xabc"}))

    assert result == "0xsubmitted"
    assert calls["count"] == 2
    assert calls["reported"][0][0] == "ethereum"
    assert calls["reported"][0][1] == "https://rate-limited.example"


def test_execute_swap_rejects_mismatched_user_id(monkeypatch):
    """Auth binding: a wallet that belongs to another user must be rejected."""
    engine = SwapEngine()

    async def fake_run_in_db(fn):
        # The first run_in_db call in execute_swap (without an idempotency key)
        # is the wallet lookup. Return a wallet owned by a different user.
        return {
            "id": 1,
            "wallet_id": 1,
            "user_id": 999,  # wallet belongs to user 999
            "address": "0xabc",
            "chain_type": "evm",
            "encrypted_private_key": "x",
        }

    monkeypatch.setattr("bot.services.swap_engine.run_in_db", fake_run_in_db)

    with pytest.raises(SwapError) as exc:
        asyncio.run(engine.execute_swap(_make_quote(), wallet_id=1, user_id=42))

    assert "does not belong to user 42" in str(exc.value)


def test_lifi_evm_swap_rejects_mismatched_tx_hash(monkeypatch):
    """A tampering RPC that returns a hash for a different tx must be rejected."""
    engine = SwapEngine()

    class FakeEth:
        gas_price = 1

        def get_transaction_count(self, _sender):
            return 0

        def send_raw_transaction(self, _raw):
            # Honest hash would be Web3.keccak(_raw); return a bogus one.
            return b"\x00" * 32

    class FakeWeb3:
        eth = FakeEth()

    async def fake_sign(_wallet, _tx):
        return "0xdeadbeef"

    monkeypatch.setattr(engine.wallet_service, "sign_evm_transaction", fake_sign)

    class FakeChain:
        chain_id = 1

    quote = _make_quote()
    # Native token (ETH) so the ERC20 approval branch is skipped.
    tx_request = {"to": "0x0000000000000000000000000000000000000001", "value": "0x0"}

    with pytest.raises(SwapError) as exc:
        asyncio.run(
            engine._execute_lifi_evm_swap(
                quote=quote,
                wallet_data={"address": "0x0000000000000000000000000000000000000002"},
                wallet=object(),
                chain=FakeChain(),
                web3=FakeWeb3(),
                tx_request=tx_request,
            )
        )

    assert "mismatched transaction hash" in str(exc.value)


def test_lifi_evm_swap_accepts_matching_tx_hash(monkeypatch):
    """Happy path: an honest RPC returning the correct hash succeeds unchanged."""
    engine = SwapEngine()
    signed_hex = "0xdeadbeef"
    expected = Web3.keccak(bytes.fromhex(signed_hex.replace("0x", "")))

    class FakeEth:
        gas_price = 1

        def get_transaction_count(self, _sender):
            return 0

        def send_raw_transaction(self, _raw):
            return expected

    class FakeWeb3:
        eth = FakeEth()

    async def fake_sign(_wallet, _tx):
        return signed_hex

    monkeypatch.setattr(engine.wallet_service, "sign_evm_transaction", fake_sign)

    class FakeChain:
        chain_id = 1

    result = asyncio.run(
        engine._execute_lifi_evm_swap(
            quote=_make_quote(),
            wallet_data={"address": "0x0000000000000000000000000000000000000002"},
            wallet=object(),
            chain=FakeChain(),
            web3=FakeWeb3(),
            tx_request={"to": "0x0000000000000000000000000000000000000001", "value": "0x0"},
        )
    )

    assert result == expected.hex()
