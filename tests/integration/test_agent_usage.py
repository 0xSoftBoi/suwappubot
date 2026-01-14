import pytest
import asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, MagicMock
from api.main import app
from bot.models.user import User, Wallet
from database.db import get_session, init_db
import os
from datetime import datetime

# Use a test-specific SQLite DB
TEST_DB_URL = "sqlite:///test_agent_usage.db"

@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    init_db(TEST_DB_URL)
    # Create test user
    with get_session() as session:
        user = User(id=1, username="agent_test_user")
        session.merge(user)
        wallet = Wallet(
            id=1,
            user_id=1,
            address="0x1234567890123456789012345678901234567890",
            chain_type="evm",
            is_active=True,
            is_default=True,
            encrypted_private_key="mock_encrypted_key"
        )
        session.merge(wallet)
        session.commit()
    yield
    if os.path.exists("test_agent_usage.db"):
        os.remove("test_agent_usage.db")

@pytest.mark.asyncio
async def test_agent_tools_discovery():
    """Verify that agents can discover available tools."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/tools", headers={"X-Agent-Key": "dev-key"})
        assert response.status_code == 200
        data = response.json()
        assert "provider" in data
        assert "tools" in data
        tool_names = [t["name"] for t in data["tools"]]
        assert "get_portfolio" in tool_names
        assert "execute_command" in tool_names

@pytest.mark.asyncio
async def test_agent_execute_command():
    """Verify that an agent can execute a natural language command via REST."""
    # Mock the handle_command to avoid real RPC/Bot calls
    mock_response = MagicMock()
    mock_response.text = "Your balance is 1.0 ETH"
    mock_response.buttons = []
    
    with patch("bot.services.unified_bot_service.unified_bot_service.handle_command", 
               new_callable=MagicMock) as mock_handle:
        mock_handle.return_value = asyncio.Future()
        mock_handle.return_value.set_result(mock_response)
        
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            payload = {
                "text": "balance",
                "user_id": 1
            }
            response = await ac.post(
                "/v1/agent/execute",
                headers={"X-Agent-Key": "dev-key"},
                json=payload
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "success"
            assert "Your balance is 1.0 ETH" in data["response"]
            mock_handle.assert_called_once()

@pytest.mark.asyncio
async def test_agent_provision_wallet():
    """Verify that agents can programmatically create wallets."""
    # Mock wallet creation to avoid generating real keys/calling core
    mock_wallet = MagicMock()
    mock_wallet.id = 2
    mock_wallet.user_id = 1
    mock_wallet.name = "Agent Solana"
    mock_wallet.address = "SolanaAddres111111111111111111111111111111"
    mock_wallet.chain_type = "solana"
    mock_wallet.is_active = True
    mock_wallet.is_default = False
    mock_wallet.created_at = datetime.utcnow()

    with patch("bot.services.wallet.WalletService.create_wallet", 
               new_callable=MagicMock) as mock_create:
        mock_create.return_value = asyncio.Future()
        mock_create.return_value.set_result(mock_wallet)
        
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            payload = {
                "user_id": 1,
                "chain_type": "solana",
                "name": "Agent Solana"
            }
            response = await ac.post(
                "/v1/agent/wallets",
                headers={"X-Agent-Key": "dev-key"},
                json=payload
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data["chainType"] == "solana"
            assert data["address"] == "SolanaAddres111111111111111111111111111111"
            mock_create.assert_called_once()

@pytest.mark.asyncio
async def test_agent_auth_failure():
    """Verify that discovery fails without a valid key."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Patch the settings object in the context of api.main where it is used
        with patch("api.main.settings.agent_api_key", "top-secret"):
            response = await ac.get("/tools", headers={"X-Agent-Key": "wrong-key"})
            assert response.status_code == 403
