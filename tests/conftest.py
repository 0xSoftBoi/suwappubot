"""Pytest configuration and fixtures."""

import pytest
import asyncio
import os
import time
from unittest.mock import MagicMock, AsyncMock
from tests.utils.fork_manager import ForkManager

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
def mock_turnkey_client():
    """Mock Turnkey client returning valid sub-org and wallet objects."""
    from bot.services.turnkey_client import TurnkeySubOrganization, TurnkeyWallet

    client = AsyncMock()
    client.create_sub_organization.return_value = TurnkeySubOrganization(
        sub_org_id="sub-org-test-123",
        sub_org_name="tg_user_1",
    )
    client.create_wallet.return_value = TurnkeyWallet(
        wallet_id="wallet-test-456",
        wallet_name="Test Wallet",
        accounts=["0x1234567890abcdef1234567890abcdef12345678"],
    )
    client.sign_transaction.return_value = "0xdeadbeef"
    client.sign_typed_data.return_value = "0xcafebabe"
    return client


@pytest.fixture
def mock_wallet_local():
    """A Wallet object with wallet_provider='local' and real v2-encrypted key."""
    from bot.models.user import Wallet
    from bot.services.kms_client import DevMockKmsClient
    from bot.utils.envelope_crypto import encrypt_private_key_v2, encode_for_db

    test_pk = "0x" + "ab" * 32
    kms = DevMockKmsClient(master_key="a" * 64)
    encrypted = encrypt_private_key_v2(test_pk, kms_client=kms)
    db_fields = encode_for_db(encrypted)

    wallet = Wallet(
        id=1,
        user_id=1,
        address="0x742d35Cc6634C0532925a3b844Bc9e7595f5bA12",
        chain_type="evm",
        wallet_provider="local",
        encrypted_private_key=db_fields["encrypted_private_key"],
        encryption_scheme=db_fields["encryption_scheme"],
        kms_wrapped_dek=db_fields["kms_wrapped_dek"],
        aesgcm_nonce=db_fields["aesgcm_nonce"],
        kms_key_id=db_fields["kms_key_id"],
        key_version=db_fields["key_version"],
        is_active=True,
        is_default=True,
    )
    return wallet


@pytest.fixture
def mock_wallet_turnkey():
    """A Wallet object with wallet_provider='turnkey' and Turnkey IDs set."""
    from bot.models.user import Wallet

    wallet = Wallet(
        id=2,
        user_id=1,
        address="0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        chain_type="evm",
        wallet_provider="turnkey",
        encrypted_private_key="turnkey_managed",
        encryption_scheme="turnkey",
        turnkey_sub_org_id="sub-org-test-123",
        turnkey_wallet_id="wallet-test-456",
        turnkey_account_id="0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        is_active=True,
        is_default=True,
    )
    return wallet


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


@pytest.fixture(scope="session")
def local_fork():
    """
    Start a local fork of Ethereum Mainnet.
    Returns the RPC URL of the fork.
    """
    # Use a public RPC for forking (in CI this would be an Alchemy key)
    # Default to LlamaRPC, but allow override
    FORK_RPC = os.getenv("ETH_RPC_URL", "https://1rpc.io/eth")
    PORT = 8545
    
    manager = ForkManager(rpc_url=FORK_RPC, port=PORT)
    try:
        manager.start()
        yield manager
    finally:
        manager.stop()


@pytest.fixture
def whale_account(local_fork):
    """
    Impersonate a USDC whale on the local fork.
    Returns the whale address and ensures it has ETH for gas.
    """
    # Binance 14
    WHALE_ADDRESS = "0x28C6c06298d514Db089934071355E5743bf21d60" 
    
    local_fork.impersonate_account(WHALE_ADDRESS)
    
    # Give the whale some ETH for gas (10 ETH)
    local_fork.set_balance(WHALE_ADDRESS, 10 * 10**18)
    
    return WHALE_ADDRESS
