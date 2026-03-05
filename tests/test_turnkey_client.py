"""
Unit tests for Turnkey wallet integration.

Tests:
- TurnkeyClient API signing
- Sub-organization creation
- Wallet creation and management
- Transaction signing routing
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from dataclasses import dataclass

from bot.services.turnkey_client import (
    TurnkeyClient,
    TurnkeyWallet,
    TurnkeySubOrganization,
    TurnkeyAPIError,
    TurnkeyActivityError,
    get_turnkey_client,
    reset_turnkey_client,
    is_turnkey_configured,
)


class TestTurnkeyWallet:
    """Tests for TurnkeyWallet dataclass."""
    
    def test_address_property(self):
        """Test address property with accounts as string list."""
        wallet = TurnkeyWallet(
            wallet_id="wallet_123",
            wallet_name="Test Wallet",
            accounts=["0xabc123", "0xdef456"],
        )
        
        # First account is the default address
        assert wallet.address == "0xabc123"
        assert wallet.account_id == "0xabc123"  # Account ID is the address
    
    def test_single_account(self):
        """Test wallet with single account."""
        wallet = TurnkeyWallet(
            wallet_id="wallet_123",
            wallet_name="Test Wallet",
            accounts=["0x123"],
        )
        
        assert wallet.address == "0x123"
    
    def test_empty_accounts(self):
        """Test wallet with no accounts."""
        wallet = TurnkeyWallet(
            wallet_id="wallet_123",
            wallet_name="Test Wallet",
            accounts=[],
        )
        
        assert wallet.address is None
        assert wallet.account_id is None


class TestTurnkeySubOrganization:
    """Tests for TurnkeySubOrganization dataclass."""
    
    def test_basic_creation(self):
        """Test basic sub-org creation."""
        sub_org = TurnkeySubOrganization(
            sub_org_id="sub_org_123",
            sub_org_name="user_456",
            root_user_id="user_789",
        )
        
        assert sub_org.sub_org_id == "sub_org_123"
        assert sub_org.sub_org_name == "user_456"
        assert sub_org.root_user_id == "user_789"


class TestTurnkeyClientStamp:
    """Tests for Turnkey API request signing (stamps)."""
    
    def test_stamp_creation(self):
        """Test that stamp is created correctly."""
        import base64
        import json
        
        # Since we need a real P-256 key for the test, let's generate one
        from ecdsa import SigningKey, NIST256p
        
        sk = SigningKey.generate(curve=NIST256p)
        vk = sk.get_verifying_key()
        
        private_hex = sk.to_string().hex()
        public_hex = "04" + vk.to_string().hex()  # Uncompressed format
        
        client = TurnkeyClient(
            organization_id="org_123",
            api_public_key=public_hex,
            api_private_key=private_hex,
            base_url="https://api.turnkey.com",
        )
        
        # _create_stamp returns a base64-encoded JSON string
        stamp_b64 = client._create_stamp('{"test":"body"}')
        
        # Decode and verify the stamp structure
        stamp_json = base64.urlsafe_b64decode(stamp_b64 + "==")
        stamp = json.loads(stamp_json)
        
        assert "publicKey" in stamp
        assert "signature" in stamp
        assert "scheme" in stamp
        assert stamp["scheme"] == "SIGNATURE_SCHEME_TK_API_P256"
        assert stamp["publicKey"] == public_hex
        # Signature should be hex-encoded
        assert all(c in '0123456789abcdef' for c in stamp["signature"])


class TestTurnkeyClientFactory:
    """Tests for Turnkey client factory."""
    
    def setup_method(self):
        """Reset Turnkey client before each test."""
        reset_turnkey_client()
    
    def test_not_configured(self):
        """Test that ValueError is raised when Turnkey is not configured."""
        from bot.config.settings import settings
        
        original_org_id = settings.turnkey_organization_id
        try:
            object.__setattr__(settings, "turnkey_organization_id", None)
            reset_turnkey_client()
            
            with pytest.raises(ValueError, match="missing turnkey_organization_id"):
                get_turnkey_client()
        finally:
            object.__setattr__(settings, "turnkey_organization_id", original_org_id)
            reset_turnkey_client()
    
    def test_is_turnkey_configured_false(self):
        """Test is_turnkey_configured returns False when not set up."""
        from bot.config.settings import settings
        
        original_provider = settings.wallet_provider
        try:
            object.__setattr__(settings, "wallet_provider", "local")
            assert is_turnkey_configured() is False
        finally:
            object.__setattr__(settings, "wallet_provider", original_provider)


class TestTurnkeyClientAsync:
    """Tests for async Turnkey client methods."""
    
    @pytest.fixture
    def mock_client(self):
        """Create a mock Turnkey client."""
        from ecdsa import SigningKey, NIST256p
        
        sk = SigningKey.generate(curve=NIST256p)
        vk = sk.get_verifying_key()
        
        return TurnkeyClient(
            organization_id="org_123",
            api_public_key="04" + vk.to_string().hex(),
            api_private_key=sk.to_string().hex(),
            base_url="https://api.turnkey.com",
        )
    
    @pytest.mark.asyncio
    async def test_create_sub_organization(self, mock_client):
        """Test sub-organization creation."""
        mock_response = {
            "activity": {
                "id": "activity_123",
                "status": "ACTIVITY_STATUS_COMPLETED",
                "result": {
                    "createSubOrganizationResultV4": {
                        "subOrganizationId": "sub_org_456",
                        "rootUserIds": ["user_789"],
                    }
                }
            }
        }
        
        with patch.object(mock_client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_response
            
            result = await mock_client.create_sub_organization("user_123")
            
            assert isinstance(result, TurnkeySubOrganization)
            assert result.sub_org_id == "sub_org_456"
            assert result.sub_org_name == "user_123"
    
    @pytest.mark.asyncio
    async def test_create_wallet(self, mock_client):
        """Test wallet creation."""
        # Turnkey API returns addresses as a list of strings
        mock_response = {
            "activity": {
                "id": "activity_123",
                "status": "ACTIVITY_STATUS_COMPLETED",
                "result": {
                    "createWalletResult": {
                        "walletId": "wallet_456",
                        "addresses": ["0xabc123"],
                    }
                }
            }
        }
        
        with patch.object(mock_client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_response
            
            result = await mock_client.create_wallet(
                wallet_name="Test Wallet",
                chain_type="evm",
            )
            
            assert isinstance(result, TurnkeyWallet)
            assert result.wallet_id == "wallet_456"
            assert result.address == "0xabc123"
    
    @pytest.mark.asyncio
    async def test_create_solana_wallet(self, mock_client):
        """Test Solana wallet creation."""
        # Turnkey API returns addresses as a list of strings
        mock_response = {
            "activity": {
                "id": "activity_123",
                "status": "ACTIVITY_STATUS_COMPLETED",
                "result": {
                    "createWalletResult": {
                        "walletId": "wallet_789",
                        "addresses": ["So1anaAddress123"],
                    }
                }
            }
        }
        
        with patch.object(mock_client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_response
            
            result = await mock_client.create_wallet(
                wallet_name="Solana Wallet",
                chain_type="solana",
            )
            
            assert result.wallet_id == "wallet_789"
            assert result.address == "So1anaAddress123"
    
    @pytest.mark.asyncio
    async def test_sign_transaction(self, mock_client):
        """Test transaction signing."""
        mock_response = {
            "activity": {
                "id": "activity_123",
                "status": "ACTIVITY_STATUS_COMPLETED",
                "result": {
                    "signTransactionResult": {
                        "signedTransaction": "0xsigned_tx_hex",
                    }
                }
            }
        }
        
        with patch.object(mock_client, "_request", new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_response
            
            result = await mock_client.sign_transaction(
                unsigned_transaction="0xunsigned_tx",
                sign_with="0xwallet_address",
            )
            
            assert result == "0xsigned_tx_hex"


class TestTurnkeyErrors:
    """Tests for Turnkey error handling."""
    
    def test_api_error(self):
        """Test TurnkeyAPIError."""
        error = TurnkeyAPIError(400, "Bad request")
        
        assert error.status_code == 400
        assert error.message == "Bad request"
        assert "400" in str(error)
        assert "Bad request" in str(error)
    
    def test_activity_error(self):
        """Test TurnkeyActivityError."""
        error = TurnkeyActivityError("activity_123", "Timed out")
        
        assert error.activity_id == "activity_123"
        assert error.message == "Timed out"
        assert "activity_123" in str(error)


class TestWalletServiceTurnkeyIntegration:
    """Tests for WalletService Turnkey integration."""
    
    @pytest.mark.asyncio
    async def test_create_turnkey_wallet_routing(self):
        """Test that wallet creation routes to Turnkey when configured."""
        from bot.services.wallet import WalletService
        from bot.config.settings import settings
        
        original_provider = settings.wallet_provider
        
        try:
            object.__setattr__(settings, "wallet_provider", "turnkey")
            
            service = WalletService()
            
            # Mock the Turnkey creation method
            with patch.object(
                service,
                "_create_turnkey_wallet",
                new_callable=AsyncMock
            ) as mock_create:
                mock_wallet = MagicMock()
                mock_create.return_value = mock_wallet
                
                result = await service.create_wallet(user_id=1, name="Test", chain_type="evm")
                
                mock_create.assert_called_once_with(1, "Test", "evm")
                assert result == mock_wallet
        finally:
            object.__setattr__(settings, "wallet_provider", original_provider)
    
    def test_get_private_key_turnkey_raises(self):
        """Test that get_private_key raises for Turnkey wallets."""
        from bot.services.wallet import WalletService
        from bot.models.user import Wallet
        
        service = WalletService()
        
        # Create a mock Turnkey wallet
        mock_wallet = MagicMock(spec=Wallet)
        mock_wallet.is_turnkey_wallet = True
        
        with pytest.raises(ValueError, match="Cannot access private key"):
            service.get_private_key(mock_wallet)


class TestHotWalletServiceTurnkeyIntegration:
    """Tests for HotWalletService Turnkey integration."""
    
    def test_get_private_key_turnkey_raises(self):
        """Test that get_private_key raises for Turnkey hot wallets."""
        from bot.services.hot_wallet import HotWalletService
        from bot.models.custodial import HotWallet
        
        service = HotWalletService()
        
        # Create a mock Turnkey hot wallet
        mock_wallet = MagicMock(spec=HotWallet)
        mock_wallet.is_turnkey_wallet = True
        
        with pytest.raises(ValueError, match="Cannot access private key"):
            service.get_private_key(mock_wallet)

