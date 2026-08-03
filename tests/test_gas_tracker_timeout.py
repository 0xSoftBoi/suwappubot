"""Regression test: gas_tracker's RPC session must have a bounded timeout.

Before this fix, `GasTracker.get_evm_gas_price` opened an
`aiohttp.ClientSession()` with NO timeout at all — a slow/hanging RPC could
block indefinitely, which (when raced alongside OKX/1inch/0x's real-gas
computation in swap_engine._real_gas_cost_usd) could push the whole quote
race past its own FAST_TIMEOUT. A bounded total timeout (~2s) caps the
damage a single bad RPC endpoint can do to quote latency.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.config.chains import ChainType
from bot.services.gas_tracker import GasTracker


@pytest.mark.asyncio
async def test_get_evm_gas_price_session_has_bounded_timeout():
    tracker = GasTracker()

    # Force a cache miss and past the chain/RPC-URL checks so we reach the
    # aiohttp.ClientSession(...) construction. We don't need a full working
    # fake HTTP round trip — get_evm_gas_price wraps everything in a broad
    # try/except and returns None on any failure, so it's enough to capture
    # the ClientSession(...) call args and let the mocked session fail.
    with (
        patch("bot.services.gas_tracker.gas_cache.get", new=AsyncMock(return_value=None)),
        patch(
            "bot.services.gas_tracker.get_chain_by_name",
            return_value=SimpleNamespace(chain_type=ChainType.EVM),
        ),
        patch(
            "bot.services.gas_tracker.rpc_manager.get_rpc_url",
            return_value="http://fake-rpc.invalid",
        ),
        patch("bot.services.gas_tracker.aiohttp.ClientSession") as mock_session_cls,
    ):
        # The mocked session's `async with` raises immediately — we only
        # care about how ClientSession(...) itself was constructed.
        mock_session_cls.side_effect = RuntimeError("no real HTTP in this test")

        result = await tracker.get_evm_gas_price("arbitrum")

    assert result is None  # failed safely, as expected
    assert mock_session_cls.called
    _, kwargs = mock_session_cls.call_args
    assert "timeout" in kwargs, "aiohttp.ClientSession must be given a bounded timeout"
    timeout = kwargs["timeout"]
    assert isinstance(timeout, aiohttp.ClientTimeout)
    assert timeout.total is not None
    assert 0 < timeout.total <= 5.0  # bounded and short — not "no timeout"
