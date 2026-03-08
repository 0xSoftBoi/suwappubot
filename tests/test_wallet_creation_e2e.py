"""
Tests for wallet creation flow — local vs Turnkey routing.

Tests WalletService.create_wallet() and _create_turnkey_wallet().
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from bot.services.wallet import WalletService
from bot.models.user import Wallet
from bot.services.turnkey_client import TurnkeySubOrganization, TurnkeyWallet


@pytest.fixture
def wallet_service():
    return WalletService()


@pytest.fixture
def mock_session():
    """Mock DB session that captures wallet saves."""
    session = MagicMock()
    session.add = MagicMock()
    session.flush = MagicMock()
    session.query.return_value.filter.return_value.first.return_value = None
    return session


@pytest.fixture
def saved_wallet():
    """A Wallet returned by save_wallet or get_wallet_by_id."""
    w = Wallet(
        id=99,
        user_id=1,
        address="0x1111111111111111111111111111111111111111",
        chain_type="evm",
        wallet_provider="local",
        is_active=True,
        is_default=False,
    )
    return w


class TestCreateLocalEvmWallet:
    """wallet_provider=local -> generates keypair, encrypts with v2, saves to DB."""

    @pytest.mark.asyncio
    async def test_create_local_evm(self, wallet_service, saved_wallet):
        with patch.object(wallet_service, "save_wallet", return_value=saved_wallet) as mock_save:
            with patch("bot.services.wallet.settings") as mock_settings:
                mock_settings.wallet_provider = "local"

                result = await wallet_service.create_wallet(
                    user_id=1, name="Test Wallet", chain_type="evm"
                )

                assert result.address is not None
                mock_save.assert_called_once()
                call_kwargs = mock_save.call_args
                assert call_kwargs[1]["chain_type"] == "evm" or call_kwargs[0][3] == "evm"


class TestCreateTurnkeyEvmWallet:
    """wallet_provider=turnkey -> creates sub-org, calls Turnkey API, saves."""

    @pytest.mark.asyncio
    async def test_create_turnkey_evm(self, wallet_service, mock_turnkey_client):
        with patch("bot.services.wallet.settings") as mock_settings:
            mock_settings.wallet_provider = "turnkey"

            with patch("bot.services.turnkey_client.get_turnkey_client", return_value=mock_turnkey_client):
                with patch("bot.services.wallet.get_session") as mock_get_session:
                    mock_session = MagicMock()
                    mock_session.__enter__ = MagicMock(return_value=mock_session)
                    mock_session.__exit__ = MagicMock(return_value=False)
                    # First call: _ensure_user_sub_org query (no existing wallet)
                    mock_session.query.return_value.filter.return_value.first.return_value = None
                    mock_get_session.return_value = mock_session

                    # Mock Wallet flush to set ID
                    def flush_side_effect():
                        pass
                    mock_session.flush = MagicMock(side_effect=flush_side_effect)

                    with patch.object(wallet_service, "get_wallet_by_id") as mock_get:
                        mock_wallet = Wallet(
                            id=10,
                            user_id=1,
                            address="0x1234567890abcdef1234567890abcdef12345678",
                            wallet_provider="turnkey",
                            chain_type="evm",
                        )
                        mock_get.return_value = mock_wallet

                        result = await wallet_service.create_wallet(
                            user_id=1, name="TK Wallet", chain_type="evm"
                        )

                        assert result.wallet_provider == "turnkey"
                        mock_turnkey_client.create_sub_organization.assert_called_once()
                        mock_turnkey_client.create_wallet.assert_called_once()


class TestTurnkeyReusesExistingSubOrg:
    """User with existing Turnkey wallet -> skips create_sub_organization."""

    @pytest.mark.asyncio
    async def test_reuses_sub_org(self, wallet_service, mock_turnkey_client):
        existing_wallet = Wallet(
            id=5,
            user_id=1,
            wallet_provider="turnkey",
            turnkey_sub_org_id="existing-sub-org-789",
            address="0xexisting",
            chain_type="evm",
        )

        with patch("bot.services.wallet.settings") as mock_settings:
            mock_settings.wallet_provider = "turnkey"

            with patch("bot.services.turnkey_client.get_turnkey_client", return_value=mock_turnkey_client):
                with patch("bot.services.wallet.get_session") as mock_get_session:
                    mock_session = MagicMock()
                    mock_session.__enter__ = MagicMock(return_value=mock_session)
                    mock_session.__exit__ = MagicMock(return_value=False)
                    # Return existing wallet with sub-org
                    mock_session.query.return_value.filter.return_value.first.return_value = existing_wallet
                    mock_get_session.return_value = mock_session

                    with patch.object(wallet_service, "get_wallet_by_id") as mock_get:
                        mock_get.return_value = Wallet(
                            id=11, user_id=1, address="0x1234567890abcdef1234567890abcdef12345678",
                            wallet_provider="turnkey", chain_type="evm",
                        )

                        result = await wallet_service.create_wallet(
                            user_id=1, name="Second Wallet", chain_type="evm"
                        )

                        # create_sub_organization should NOT have been called
                        mock_turnkey_client.create_sub_organization.assert_not_called()
                        # But create_wallet should use the existing sub-org
                        mock_turnkey_client.create_wallet.assert_called_once()
                        call_kwargs = mock_turnkey_client.create_wallet.call_args
                        assert call_kwargs[1]["organization_id"] == "existing-sub-org-789"


class TestTurnkeyNoAddressRaises:
    """Empty accounts list -> RuntimeError."""

    @pytest.mark.asyncio
    async def test_no_address(self, wallet_service, mock_turnkey_client):
        # Override to return wallet with no accounts
        mock_turnkey_client.create_wallet.return_value = TurnkeyWallet(
            wallet_id="wallet-empty",
            wallet_name="Empty",
            accounts=[],
        )

        with patch("bot.services.wallet.settings") as mock_settings:
            mock_settings.wallet_provider = "turnkey"

            with patch("bot.services.turnkey_client.get_turnkey_client", return_value=mock_turnkey_client):
                with patch("bot.services.wallet.get_session") as mock_get_session:
                    mock_session = MagicMock()
                    mock_session.__enter__ = MagicMock(return_value=mock_session)
                    mock_session.__exit__ = MagicMock(return_value=False)
                    mock_session.query.return_value.filter.return_value.first.return_value = None
                    mock_get_session.return_value = mock_session

                    with pytest.raises(RuntimeError, match="no address"):
                        await wallet_service.create_wallet(
                            user_id=1, name="Empty Wallet", chain_type="evm"
                        )


class TestInvalidChainTypeRaises:
    """chain_type='invalid' -> ValueError."""

    @pytest.mark.asyncio
    async def test_invalid_chain(self, wallet_service):
        with patch("bot.services.wallet.settings") as mock_settings:
            mock_settings.wallet_provider = "local"

            with pytest.raises(ValueError, match="Unsupported chain type"):
                await wallet_service.create_wallet(
                    user_id=1, name="Bad Wallet", chain_type="invalid"
                )
