"""Tests for balance caching, Alchemy batch integration, and balance refresher."""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from bot.utils.cache import AsyncCache, balance_cache
from bot.services.wallet import WalletService


class TestBalanceCacheIntegration:
    """Test cache-first reads in get_balances_by_address."""

    @pytest.mark.asyncio
    async def test_cache_hit_returns_cached_value(self):
        """Cache hit should return instantly without calling _fetch_balances_live."""
        ws = WalletService()
        cached_data = {"ethereum": {"ETH": 1.5, "USDC": 100.0}}

        with patch.object(balance_cache, "get", new_callable=AsyncMock, return_value=cached_data) as mock_get:
            with patch.object(ws, "_fetch_balances_live", new_callable=AsyncMock) as mock_fetch:
                result = await ws.get_balances_by_address("0xABC123", "evm")

                assert result == cached_data
                mock_get.assert_called_once_with("bal:0xABC123:evm")
                mock_fetch.assert_not_called()

    @pytest.mark.asyncio
    async def test_cache_miss_fetches_live_and_caches(self):
        """Cache miss should fetch live and store result."""
        ws = WalletService()
        live_data = {"base": {"ETH": 0.5}}

        with patch.object(balance_cache, "get", new_callable=AsyncMock, return_value=None):
            with patch.object(ws, "_fetch_balances_live", new_callable=AsyncMock, return_value=live_data):
                with patch.object(balance_cache, "set", new_callable=AsyncMock) as mock_set:
                    result = await ws.get_balances_by_address("0xDEF456", "evm")

                    assert result == live_data
                    mock_set.assert_called_once_with("bal:0xDEF456:evm", live_data)

    @pytest.mark.asyncio
    async def test_cache_key_includes_chain_type(self):
        """EVM and Solana wallets at the same address should have separate cache entries."""
        ws = WalletService()

        with patch.object(balance_cache, "get", new_callable=AsyncMock, return_value=None):
            with patch.object(ws, "_fetch_balances_live", new_callable=AsyncMock, return_value={}):
                with patch.object(balance_cache, "set", new_callable=AsyncMock) as mock_set:
                    await ws.get_balances_by_address("0xABC", "evm")
                    await ws.get_balances_by_address("0xABC", "solana")

                    keys = [call.args[0] for call in mock_set.call_args_list]
                    assert "bal:0xABC:evm" in keys
                    assert "bal:0xABC:solana" in keys


class TestAlchemyBatchIntegration:
    """Test Alchemy batch token balance fetching."""

    @pytest.mark.asyncio
    async def test_alchemy_raw_balances_returns_dict(self):
        """get_token_balances_raw should return {contract_lower: raw_balance}."""
        from bot.services.alchemy_client import AlchemyClient

        mock_response = {
            "result": {
                "tokenBalances": [
                    {"contractAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "tokenBalance": "0x5F5E100"},
                    {"contractAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7", "tokenBalance": "0x0"},
                ]
            }
        }

        client = AlchemyClient(api_key="test_key")

        with patch.object(client, "_get_session") as mock_session:
            mock_resp = AsyncMock()
            mock_resp.status = 200
            mock_resp.json = AsyncMock(return_value=mock_response)
            mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
            mock_resp.__aexit__ = AsyncMock(return_value=False)

            session = AsyncMock()
            session.post = MagicMock(return_value=mock_resp)
            mock_session.return_value = session

            result = await client.get_token_balances_raw("0xABC", "ethereum")

            # USDC has balance, USDT has 0 (filtered out)
            assert "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" in result
            assert result["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"] == 100000000
            assert "0xdac17f958d2ee523a2206206994597c13d831ec7" not in result

    @pytest.mark.asyncio
    async def test_alchemy_raw_balances_empty_on_error(self):
        """get_token_balances_raw should return {} on API error."""
        from bot.services.alchemy_client import AlchemyClient

        client = AlchemyClient(api_key="test_key")

        with patch.object(client, "_get_session") as mock_session:
            mock_resp = AsyncMock()
            mock_resp.status = 500
            mock_resp.text = AsyncMock(return_value="Server Error")
            mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
            mock_resp.__aexit__ = AsyncMock(return_value=False)

            session = AsyncMock()
            session.post = MagicMock(return_value=mock_resp)
            mock_session.return_value = session

            result = await client.get_token_balances_raw("0xABC", "ethereum")
            assert result == {}

    @pytest.mark.asyncio
    async def test_alchemy_not_configured_returns_empty(self):
        """Without API key, get_token_balances_raw returns {}."""
        from bot.services.alchemy_client import AlchemyClient

        client = AlchemyClient(api_key=None)
        result = await client.get_token_balances_raw("0xABC", "ethereum")
        assert result == {}

    @pytest.mark.asyncio
    async def test_alchemy_unsupported_chain_returns_empty(self):
        """Unsupported chain should return {}."""
        from bot.services.alchemy_client import AlchemyClient

        client = AlchemyClient(api_key="test_key")
        result = await client.get_token_balances_raw("0xABC", "fantom")
        assert result == {}


class TestCacheInvalidation:
    """Test cache invalidation after swaps/transactions."""

    @pytest.mark.asyncio
    async def test_cache_delete_after_swap(self):
        """Balance cache entry should be deleted after a swap."""
        cache = AsyncCache(default_ttl=60)
        await cache.set("bal:0xABC:evm", {"ethereum": {"ETH": 1.0}})

        # Simulate swap completion cache invalidation
        await cache.delete("bal:0xABC:evm")

        result = await cache.get("bal:0xABC:evm")
        assert result is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_key_is_safe(self):
        """Deleting a key that doesn't exist should not raise."""
        cache = AsyncCache(default_ttl=60)
        await cache.delete("bal:nonexistent:evm")  # Should not raise


class TestBalanceRefresher:
    """Test balance refresher background service."""

    @pytest.mark.asyncio
    async def test_start_stop(self):
        """Refresher should start and stop cleanly."""
        from bot.services.balance_refresher import BalanceRefresher

        refresher = BalanceRefresher(refresh_interval=1)
        await refresher.start()
        assert refresher._running is True
        assert refresher._task is not None

        await refresher.stop()
        assert refresher._running is False

    @pytest.mark.asyncio
    async def test_double_start_is_noop(self):
        """Calling start twice should not create two tasks."""
        from bot.services.balance_refresher import BalanceRefresher

        refresher = BalanceRefresher(refresh_interval=1)
        await refresher.start()
        task1 = refresher._task

        await refresher.start()
        task2 = refresher._task

        assert task1 is task2
        await refresher.stop()

    @pytest.mark.asyncio
    async def test_refresh_all_respects_running_flag(self):
        """_refresh_all should exit early if not running."""
        from bot.services.balance_refresher import BalanceRefresher

        refresher = BalanceRefresher(refresh_interval=1)
        refresher._running = False

        # Should return without doing anything
        await refresher._refresh_all()
