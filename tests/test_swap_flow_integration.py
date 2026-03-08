
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timedelta
from decimal import Decimal

from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.models.swap import SwapStatus
from bot.utils.exceptions import SwapError
from bot.models.user import Wallet, User

@pytest.mark.asyncio
class TestSwapFlowIntegration:
    """Integration tests for the swap flow using mocks."""

    async def test_end_to_end_swap_flow(self):
        """Test the complete swap flow from quote to execution."""
        
        # 1. Setup Mocks
        mock_wallet_service = MagicMock()
        mock_wallet_service.get_evm_native_balance = AsyncMock(return_value=1.5)  # 1.5 ETH
        mock_wallet_service.get_evm_token_balance = AsyncMock(return_value=1000.0)  # 1000 USDC
        mock_wallet_service._get_web3 = MagicMock()
        
        mock_web3 = MagicMock()
        mock_web3.eth.gas_price = 20000000000  # 20 gwei
        mock_web3.eth.get_transaction_count.return_value = 5
        mock_web3.eth.send_raw_transaction.return_value = b'\xab\xcd'  # Mock hash bytes
        
        # Correctly return the mock web3 when called
        mock_wallet_service._get_web3.return_value = mock_web3
        
        # Mock signers
        mock_signed_tx = MagicMock()
        mock_signed_tx.rawTransaction = b'signed_tx_bytes'
        mock_web3.eth.account.sign_transaction.return_value = mock_signed_tx
        
        # Setup DB session mock
        mock_session = MagicMock()
        
        # Mock Wallet object
        mock_wallet = Wallet(
            id=1,
            user_id=1,
            address="0xUserWalletAddress",
            encrypted_private_key="encrypted_key",
            chain_type="evm",
            is_active=True
        )
        
        # Mock SwapTransaction that will be created
        mock_swap_tx = MagicMock()
        mock_swap_tx.id = 1
        mock_swap_tx.status = "submitted"
        mock_swap_tx.tx_hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
        mock_swap_tx.from_amount_usd = 100.0
        
        # Query mock that returns different results based on model type
        def smart_query(model):
            mock_query = MagicMock()
            mock_filter = MagicMock()
            if model.__name__ == "Wallet":
                mock_filter.first.return_value = mock_wallet
            else:  # SwapTransaction
                mock_filter.first.return_value = mock_swap_tx
            mock_query.filter.return_value = mock_filter
            return mock_query
        
        mock_session.query.side_effect = smart_query
        
        # Create context manager for get_session
        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=mock_session)
        mock_context.__exit__ = MagicMock(return_value=None)
        mock_get_session = MagicMock(return_value=mock_context)
        
        # Mock encryption/decryption
        with patch('bot.services.swap_engine.WalletService', return_value=mock_wallet_service), \
             patch('bot.utils.encryption.decrypt_private_key', return_value='0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'), \
             patch('bot.services.swap_engine.get_session', mock_get_session), \
             patch('database.db.get_session', mock_get_session):
            
            # Initialize Engine
            engine = SwapEngine()
            
            # Mock API providers to return quotes
            engine.lifi = AsyncMock()
            engine.jupiter = AsyncMock()
            
            # 2. Get Quote
            # Simulate a LiFi quote response
            mock_quote = SwapQuote(
                provider="lifi",
                from_chain="ethereum",
                to_chain="polygon",
                from_token="USDC",
                to_token="USDC",
                from_amount="100000000",  # 100 USDC (6 decimals)
                from_amount_human=100.0,
                to_amount="99500000",    # 99.5 USDC
                to_amount_human=99.5,
                to_amount_min="99000000",
                gas_cost_usd=5.0,
                fee_cost_usd=2.0,
                total_cost_usd=7.0,
                estimated_time=300,
                price_impact=0.1,
                exchange_rate=0.995,
                raw_quote={
                    "transactionRequest": {
                        "to": "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",  # Valid LiFi router address
                        "data": "0x1234",
                        "value": "0x0",
                        "gasLimit": "0x7a120",
                        "gasPrice": "0x4a817c800"
                    }
                },
                timestamp=datetime.utcnow(),
                expires_in=60
            )
            
            engine.lifi.get_quote.return_value = MagicMock(
                to_amount="99500000",
                to_amount_min="99000000",
                gas_cost_usd=5.0,
                fee_cost_usd=2.0,
                estimated_time=300,
                raw_response=mock_quote.raw_quote
            )
            
            # Mock internal helpers that convert amounts
            engine._get_token_amount_raw = MagicMock(return_value="100000000")
            engine._get_token_amount_human = MagicMock(side_effect=[99.5, 99.0]) # for to_amount and to_amount_min
            
            # 3. Execute Swap
            # Mock the wallet service signature method specifically for this call (must be valid hex)
            mock_wallet_service.sign_evm_transaction_raw.return_value = "0xabcdef1234567890abcdef1234567890"
            mock_web3.eth.send_raw_transaction.return_value = bytes.fromhex("abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890")

            # Perform Execution
            swap_tx = await engine.execute_swap(
                quote=mock_quote,
                wallet_id=1,
                user_id=1
            )
            
            # 4. Assertions
            assert swap_tx is not None
            assert swap_tx.status == SwapStatus.SUBMITTED.value
            assert swap_tx.tx_hash == "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
            assert swap_tx.from_amount_usd == 100.0
            
            # Verify DB interactions
            # Should add the transaction
            assert mock_session.add.called 
            # Should update with hash
            assert mock_session.flush.called

    async def test_swap_insufficient_balance(self):
        """Test swap fails when balance is insufficient."""
        
        # Setup Mock Wallet Service returning low balance
        mock_wallet_service = MagicMock()
        mock_wallet_service.get_evm_token_balance = AsyncMock(return_value=50.0)  # Only 50 USDC
        
        # Create mock session that works as context manager
        mock_session = MagicMock()
        mock_wallet = Wallet(id=1, user_id=1, address="0xUser", chain_type="evm", is_active=True)
        mock_session.query.return_value.filter.return_value.first.return_value = mock_wallet
        
        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=mock_session)
        mock_context.__exit__ = MagicMock(return_value=None)
        mock_get_session = MagicMock(return_value=mock_context)
        
        with patch('bot.services.swap_engine.WalletService', return_value=mock_wallet_service), \
             patch('bot.services.swap_engine.get_session', mock_get_session), \
             patch('database.db.get_session', mock_get_session):
            
            engine = SwapEngine()
            
            quote = SwapQuote(
                provider="lifi", from_chain="ethereum", to_chain="polygon",
                from_token="USDC", to_token="USDC",
                from_amount="100000000", from_amount_human=100.0,
                to_amount="0", to_amount_human=0, to_amount_min="0",
                gas_cost_usd=0, fee_cost_usd=0, total_cost_usd=0,
                estimated_time=0, price_impact=0, exchange_rate=0,
                raw_quote={}, timestamp=datetime.utcnow()
            )
            
            # Expect failure
            with pytest.raises(SwapError) as excinfo:
                await engine.execute_swap(quote, wallet_id=1, user_id=1)
            
            assert "Insufficient" in str(excinfo.value)

    async def test_swap_quote_expired(self):
        """Test swap fails when quote is expired."""
        
        mock_wallet_service = MagicMock()
        
        with patch('bot.services.swap_engine.WalletService', return_value=mock_wallet_service), \
             patch('bot.services.swap_engine.get_session') as mock_get_session:
            
            mock_session = MagicMock()
            mock_get_session.return_value.__enter__.return_value = mock_session
            mock_wallet = Wallet(id=1, address="0xUser", chain_type="evm")
            mock_session.query.return_value.filter.return_value.first.return_value = mock_wallet
            
            engine = SwapEngine()
            
            # Create old quote
            old_quote = SwapQuote(
                provider="lifi", from_chain="ethereum", to_chain="polygon",
                from_token="USDC", to_token="USDC",
                from_amount="100", from_amount_human=100.0,
                to_amount="0", to_amount_human=0, to_amount_min="0",
                gas_cost_usd=0, fee_cost_usd=0, total_cost_usd=0,
                estimated_time=0, price_impact=0, exchange_rate=0,
                raw_quote={}, 
                timestamp=datetime.utcnow() - timedelta(seconds=61), # 61s old
                expires_in=60
            )
            
            with pytest.raises(SwapError) as excinfo:
                await engine.execute_swap(old_quote, wallet_id=1, user_id=1)
            
            assert "expired" in str(excinfo.value).lower()

