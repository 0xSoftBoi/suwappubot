"""
Tests for wallet signing dispatch — routing to local vs Turnkey.

Tests sign_evm_transaction(), sign_typed_data(), and _serialize_evm_transaction().
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from eth_account import Account

from bot.services.wallet import WalletService
from bot.models.user import Wallet


@pytest.fixture
def wallet_service():
    return WalletService()


KNOWN_PRIVATE_KEY = "0x" + "ab" * 32
KNOWN_ADDRESS = Account.from_key(KNOWN_PRIVATE_KEY).address

SAMPLE_TX = {
    "to": KNOWN_ADDRESS,
    "value": 0,
    "gas": 21000,
    "gasPrice": 20_000_000_000,
    "nonce": 0,
    "chainId": 1,
}


class TestLocalWalletUsesAccountSign:
    """wallet_provider=local -> calls Account.sign_transaction with decrypted key."""

    @pytest.mark.asyncio
    async def test_local_signing(self, wallet_service, mock_wallet_local):
        mock_signed = MagicMock()
        mock_signed.raw_transaction = b"\xab" * 32
        mock_signed.rawTransaction = b"\xab" * 32

        with patch.object(wallet_service, "get_private_key", return_value=KNOWN_PRIVATE_KEY):
            with patch("bot.services.wallet.Account") as mock_account_cls:
                mock_account_cls.sign_transaction.return_value = mock_signed

                result = await wallet_service.sign_evm_transaction(mock_wallet_local, SAMPLE_TX)

                assert isinstance(result, str)
                assert len(result) > 0
                mock_account_cls.sign_transaction.assert_called_once()


class TestTurnkeyWalletUsesTurnkeyApi:
    """wallet_provider=turnkey -> calls client.sign_transaction."""

    @pytest.mark.asyncio
    async def test_turnkey_signing(self, wallet_service, mock_wallet_turnkey, mock_turnkey_client):
        with patch("bot.services.turnkey_client.get_turnkey_client", return_value=mock_turnkey_client):
            result = await wallet_service.sign_evm_transaction(mock_wallet_turnkey, SAMPLE_TX)

            assert result == "0xdeadbeef"
            mock_turnkey_client.sign_transaction.assert_called_once()
            call_kwargs = mock_turnkey_client.sign_transaction.call_args
            assert call_kwargs[1]["organization_id"] == "sub-org-test-123"


class TestGetPrivateKeyRaisesForTurnkey:
    """get_private_key(turnkey_wallet) -> ValueError."""

    def test_raises_for_turnkey(self, wallet_service, mock_wallet_turnkey):
        with pytest.raises(ValueError, match="Cannot access private key"):
            wallet_service.get_private_key(mock_wallet_turnkey)


class TestSignTypedDataTurnkey:
    """sign_typed_data(turnkey_wallet) -> calls client.sign_typed_data."""

    @pytest.mark.asyncio
    async def test_typed_data_turnkey(self, wallet_service, mock_wallet_turnkey, mock_turnkey_client):
        typed_data = {
            "types": {"EIP712Domain": []},
            "primaryType": "EIP712Domain",
            "domain": {},
            "message": {},
        }

        with patch("bot.services.turnkey_client.get_turnkey_client", return_value=mock_turnkey_client):
            result = await wallet_service.sign_typed_data(mock_wallet_turnkey, typed_data)

            assert result == "0xcafebabe"
            mock_turnkey_client.sign_typed_data.assert_called_once()


class TestSerializeEip1559Tx:
    """EIP-1559 tx -> valid hex via TypedTransaction."""

    def test_eip1559_serialization(self, wallet_service):
        tx = {
            "to": KNOWN_ADDRESS,
            "value": 0,
            "gas": 21000,
            "maxFeePerGas": 30_000_000_000,
            "maxPriorityFeePerGas": 1_000_000_000,
            "nonce": 0,
            "chainId": 1,
            "type": 2,
        }

        result = wallet_service._serialize_evm_transaction(tx)
        assert result.startswith("0x")
        # Should be valid hex
        bytes.fromhex(result[2:])


class TestSerializeLegacyTx:
    """Legacy tx -> valid RLP hex."""

    def test_legacy_serialization(self, wallet_service):
        result = wallet_service._serialize_evm_transaction(SAMPLE_TX)
        assert result.startswith("0x")
        # Should be valid hex
        data = bytes.fromhex(result[2:])
        assert len(data) > 0
