"""
Tests for webapp wallet auto-provision endpoint.

Tests POST /webapp/wallets/default.
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime

from bot.models.user import User, Wallet
from bot.services.turnkey_client import TurnkeySubOrganization, TurnkeyWallet


@pytest.fixture
def mock_user():
    user = User(
        id=1,
        telegram_id=123456789,
        username="testuser",
        created_at=datetime.utcnow(),
    )
    # Simulate having first_name and last_name attributes
    user.first_name = "Test"
    user.last_name = "User"
    return user


@pytest.fixture
def mock_db(mock_user):
    """Mock DB session for webapp tests."""
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = mock_user
    return db


@pytest.fixture
def tg_user():
    """TelegramUser dependency override."""
    from api.webapp import TelegramUser
    return TelegramUser(
        id=123456789,
        first_name="Test",
        last_name="User",
        username="testuser",
    )


class TestNewUserGetsTurnkeyWallet:
    """No existing wallet -> Turnkey wallet created, is_default=True."""

    @pytest.mark.asyncio
    async def test_new_user_turnkey(self, tg_user, mock_user):
        from api.webapp import get_or_create_wallet

        mock_db = MagicMock()
        # User exists
        mock_db.query.return_value.filter.return_value.first.side_effect = [
            mock_user,  # First query: find user
            None,       # Second query: find default wallet (none)
        ]
        mock_db.add = MagicMock()
        mock_db.commit = MagicMock()

        mock_turnkey = AsyncMock()
        mock_turnkey.create_sub_organization.return_value = TurnkeySubOrganization(
            sub_org_id="sub-org-new",
            sub_org_name="tg_user_1",
        )
        mock_turnkey.create_wallet.return_value = TurnkeyWallet(
            wallet_id="wallet-new",
            wallet_name="Telegram Wallet",
            accounts=["0xnewwallet1234567890abcdef1234567890abcdef"],
        )

        with patch("bot.services.turnkey_client.is_turnkey_configured", return_value=True):
            with patch("bot.services.turnkey_client.get_turnkey_client", return_value=mock_turnkey):
                result = await get_or_create_wallet(tg_user=tg_user, db=mock_db)

                assert result.success is True
                assert result.address == "0xnewwallet1234567890abcdef1234567890abcdef"
                assert result.chain == "ethereum"
                mock_db.add.assert_called()


class TestExistingUserWithWalletReturnsExisting:
    """User has active wallet -> returns it without creating new."""

    @pytest.mark.asyncio
    async def test_returns_existing(self, tg_user, mock_user):
        from api.webapp import get_or_create_wallet

        existing_wallet = Wallet(
            id=5,
            user_id=1,
            address="0xexistingwallet",
            chain_type="evm",
            is_active=True,
            is_default=True,
            created_at=datetime.utcnow(),
        )

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.side_effect = [
            mock_user,         # Find user
            existing_wallet,   # Find default wallet
        ]

        result = await get_or_create_wallet(tg_user=tg_user, db=mock_db)

        assert result.success is True
        assert result.address == "0xexistingwallet"


class TestTurnkeyNotConfiguredFallsBack:
    """is_turnkey_configured()=False -> local wallet created."""

    @pytest.mark.asyncio
    async def test_fallback_to_local(self, tg_user, mock_user):
        from api.webapp import get_or_create_wallet

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.side_effect = [
            mock_user,  # Find user
            None,       # No default wallet
        ]

        mock_wallet_service = MagicMock()
        mock_wallet = Wallet(
            id=10, user_id=1, address="0xlocalwallet",
            chain_type="evm", wallet_provider="local",
        )
        mock_wallet_service.create_wallet = AsyncMock(return_value=mock_wallet)

        with patch("bot.services.turnkey_client.is_turnkey_configured", return_value=False):
            with patch("bot.services.wallet.WalletService", return_value=mock_wallet_service):
                result = await get_or_create_wallet(tg_user=tg_user, db=mock_db)

                assert result.success is True
                assert result.address == "0xlocalwallet"


class TestTurnkeyApiErrorReturnsFailure:
    """Turnkey raises -> success=False with error message."""

    @pytest.mark.asyncio
    async def test_api_error(self, tg_user, mock_user):
        from api.webapp import get_or_create_wallet

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.side_effect = [
            mock_user,  # Find user
            None,       # No default wallet
        ]

        mock_turnkey = AsyncMock()
        mock_turnkey.create_sub_organization.side_effect = RuntimeError("Turnkey API timeout")

        with patch("bot.services.turnkey_client.is_turnkey_configured", return_value=True):
            with patch("bot.services.turnkey_client.get_turnkey_client", return_value=mock_turnkey):
                result = await get_or_create_wallet(tg_user=tg_user, db=mock_db)

                assert result.success is False
                assert "Turnkey API timeout" in result.message
