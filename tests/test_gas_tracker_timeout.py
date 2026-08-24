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

from bot.config.chains import ChainType  # noqa: E402
from bot.services.gas_tracker import GasTracker  # noqa: E402


@pytest.mark.asyncio
async def test_get_evm_gas_price_session_has_bounded_timeout():
    """get_evm_gas_price now uses the SHARED pooled session (get_http_session)
    instead of constructing its own ClientSession, so the bounded-timeout
    invariant lives on the per-request `session.post(..., timeout=...)`
    kwarg — the shared session's own (longer) default must NOT be what
    governs this call. Capture the post() kwargs and assert the same bound
    the old session-level test enforced."""
    tracker = GasTracker()

    captured_post_kwargs = {}

    class _FailingPostCtx:
        # `async with session.post(...)` raises immediately — we only care
        # about the kwargs post() itself was called with.
        async def __aenter__(self):
            raise RuntimeError("no real HTTP in this test")

        async def __aexit__(self, *_):
            return False

    mock_session = MagicMock()

    def _post(url, **kwargs):
        captured_post_kwargs.update(kwargs)
        return _FailingPostCtx()

    mock_session.post = _post

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
        patch(
            "bot.services.gas_tracker.get_http_session",
            new=AsyncMock(return_value=mock_session),
        ),
    ):
        result = await tracker.get_evm_gas_price("arbitrum")

    assert result is None  # failed safely, as expected
    assert "timeout" in captured_post_kwargs, "gas RPC post() must pass a bounded timeout"
    timeout = captured_post_kwargs["timeout"]
    assert isinstance(timeout, aiohttp.ClientTimeout)
    assert timeout.total is not None
    assert 0 < timeout.total <= 5.0  # bounded and short — not "no timeout"
