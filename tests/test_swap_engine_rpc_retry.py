import os
import asyncio
from datetime import datetime, timezone

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.swap_engine import SwapEngine, SwapQuote  # noqa: E402


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

    quote = SwapQuote(
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

    result = asyncio.run(engine._execute_lifi_swap(quote, {"address": "0xabc"}))

    assert result == "0xsubmitted"
    assert calls["count"] == 2
    assert calls["reported"][0][0] == "ethereum"
    assert calls["reported"][0][1] == "https://rate-limited.example"
