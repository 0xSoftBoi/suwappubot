"""Pytest configuration and fixtures."""

import pytest
import asyncio
import os
from unittest.mock import MagicMock, AsyncMock

# Set test environment variables before importing app code
os.environ["TELEGRAM_BOT_TOKEN"] = "test_token"
os.environ["ENCRYPTION_KEY"] = "a" * 64
os.environ["DATABASE_URL"] = "sqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_web3():
    """Mock Web3 instance."""
    mock = MagicMock()
    mock.eth.get_balance.return_value = 1000000000000000000  # 1 ETH
    mock.eth.gas_price = 20000000000  # 20 gwei
    mock.eth.get_transaction_count.return_value = 0
    return mock


@pytest.fixture
def mock_telegram_update():
    """Mock Telegram update object."""
    update = MagicMock()
    update.effective_user.id = 123456789
    update.effective_user.username = "testuser"
    update.effective_user.first_name = "Test"
    update.message.reply_text = AsyncMock()
    update.callback_query = None
    return update


@pytest.fixture
def mock_telegram_context():
    """Mock Telegram context object."""
    context = MagicMock()
    context.user_data = {}
    context.bot.send_message = AsyncMock()
    return context


@pytest.fixture
def sample_wallet_data():
    """Sample wallet data for testing."""
    return {
        "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5bA12",
        "chain_type": "evm",
        "encrypted_private_key": "encrypted_key_placeholder",
    }


@pytest.fixture
def sample_quote_data():
    """Sample swap quote data for testing."""
    from datetime import datetime
    return {
        "provider": "lifi",
        "from_chain": "ethereum",
        "to_chain": "polygon",
        "from_token": "USDC",
        "to_token": "USDC",
        "from_amount": "100000000",
        "from_amount_human": 100.0,
        "to_amount": "99500000",
        "to_amount_human": 99.5,
        "to_amount_min": "99000000",
        "gas_cost_usd": 5.0,
        "fee_cost_usd": 0.5,
        "total_cost_usd": 5.5,
        "estimated_time": 300,
        "price_impact": 0.1,
        "exchange_rate": 0.995,
        "raw_quote": {},
        "timestamp": datetime.utcnow(),
        "expires_in": 30,
    }

