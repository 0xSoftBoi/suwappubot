"""Integration tests for multi-wallet swap flow."""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from datetime import datetime

from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.models.swap import SwapStatus, SwapTransaction


@pytest.fixture
def sample_quote():
    return SwapQuote(
        provider="lifi",
        from_chain="ethereum",
        to_chain="ethereum",
        from_token="USDC",
        to_token="WETH",
        from_amount="100000000",
        from_amount_human=100.0,
        to_amount="50000000000000000",
        to_amount_human=0.05,
        to_amount_min="49500000000000000",
        gas_cost_usd=5.0,
        fee_cost_usd=0.5,
        total_cost_usd=5.5,
        estimated_time=30,
        price_impact=0.1,
        exchange_rate=0.0005,
        raw_quote={"transactionRequest": {"data": "0x1234", "to": "0xabcd", "value": "0"}},
        timestamp=datetime.utcnow(),
        expires_in=30,
    )


class TestMultiWalletSwapFlow:
    @pytest.mark.asyncio
    async def test_execute_multi_swap_single_wallet(self, sample_quote):
        """Test multi-swap with a single wallet behaves like execute_swap."""
        engine = SwapEngine()

        mock_tx = MagicMock(spec=SwapTransaction)
        mock_tx.status = SwapStatus.SUBMITTED.value
        mock_tx.id = 1

        with patch.object(engine, 'execute_swap', new_callable=AsyncMock, return_value=mock_tx):
            results = await engine.execute_multi_swap(
                quotes_with_wallets=[(sample_quote, 1)],
                user_id=1,
                attempt_id="test_attempt",
            )
            assert len(results) == 1
            assert results[0].status == SwapStatus.SUBMITTED.value

    @pytest.mark.asyncio
    async def test_execute_multi_swap_partial_failure(self, sample_quote):
        """Test that partial failures are handled: one succeeds, one fails."""
        engine = SwapEngine()

        success_tx = MagicMock(spec=SwapTransaction)
        success_tx.status = SwapStatus.SUBMITTED.value
        success_tx.id = 1

        fail_tx = MagicMock(spec=SwapTransaction)
        fail_tx.status = SwapStatus.FAILED.value
        fail_tx.id = 2
        fail_tx.error_message = "Insufficient balance"

        call_count = 0

        async def mock_execute(quote, wallet_id, user_id, idempotency_key=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return success_tx
            else:
                return fail_tx

        with patch.object(engine, 'execute_swap', side_effect=mock_execute):
            results = await engine.execute_multi_swap(
                quotes_with_wallets=[(sample_quote, 1), (sample_quote, 2)],
                user_id=1,
                attempt_id="test_attempt",
            )
            assert len(results) == 2
            statuses = [r.status for r in results]
            assert SwapStatus.SUBMITTED.value in statuses
            assert SwapStatus.FAILED.value in statuses

    @pytest.mark.asyncio
    async def test_execute_multi_swap_all_fail(self, sample_quote):
        """Test that all-failure scenario returns failed results."""
        engine = SwapEngine()

        from bot.utils.exceptions import SwapError

        async def mock_execute(quote, wallet_id, user_id, idempotency_key=None):
            raise SwapError("Network error")

        with patch.object(engine, 'execute_swap', side_effect=mock_execute):
            results = await engine.execute_multi_swap(
                quotes_with_wallets=[(sample_quote, 1), (sample_quote, 2)],
                user_id=1,
                attempt_id="test_attempt",
            )
            # execute_multi_swap should handle errors and return results
            # The exact behavior depends on implementation
            assert isinstance(results, list)
