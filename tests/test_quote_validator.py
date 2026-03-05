"""Tests for quote validator."""

import pytest
from datetime import datetime, timedelta
from dataclasses import dataclass
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

from bot.utils.quote_validator import QuoteValidator
from bot.utils.exceptions import SwapError


@dataclass
class MockQuote:
    """Mock quote for testing."""
    from_chain: str = "ethereum"
    to_chain: str = "polygon"
    from_token: str = "USDC"
    to_token: str = "USDC"
    from_amount: str = "100000000"
    from_amount_human: float = 100.0
    to_amount: str = "99500000"
    to_amount_human: float = 99.5
    gas_cost_usd: float = 5.0
    timestamp: datetime = None
    expires_in: int = 30


class TestQuoteFreshness:
    """Tests for quote freshness validation."""
    
    def test_fresh_quote(self):
        """Test fresh quote passes validation."""
        quote = MockQuote(timestamp=datetime.utcnow())
        assert QuoteValidator.validate_quote_freshness(quote) is True
    
    def test_expired_quote(self):
        """Test expired quote raises error."""
        quote = MockQuote(timestamp=datetime.utcnow() - timedelta(seconds=60))
        with pytest.raises(SwapError, match="expired"):
            QuoteValidator.validate_quote_freshness(quote)
    
    def test_quote_without_timestamp(self):
        """Test quote without timestamp passes (backward compatibility)."""
        quote = MockQuote(timestamp=None)
        assert QuoteValidator.validate_quote_freshness(quote) is True
    
    def test_custom_expiry(self):
        """Test custom expiry time."""
        quote = MockQuote(timestamp=datetime.utcnow() - timedelta(seconds=45))
        # Should pass with 60 second max age
        assert QuoteValidator.validate_quote_freshness(quote, max_age_seconds=60) is True
        # Should fail with 30 second max age
        with pytest.raises(SwapError):
            QuoteValidator.validate_quote_freshness(quote, max_age_seconds=30)


class TestSlippageValidation:
    """Tests for slippage validation."""
    
    def test_valid_slippage(self):
        """Test valid slippage passes."""
        assert QuoteValidator.validate_slippage(50) is True  # 0.5%
        assert QuoteValidator.validate_slippage(100) is True  # 1%
        assert QuoteValidator.validate_slippage(500) is True  # 5%
    
    def test_high_slippage(self):
        """Test excessive slippage raises error."""
        with pytest.raises(SwapError, match="too high"):
            QuoteValidator.validate_slippage(1500)  # 15%
    
    def test_max_slippage(self):
        """Test max slippage boundary."""
        assert QuoteValidator.validate_slippage(1000) is True  # 10% exactly
        with pytest.raises(SwapError):
            QuoteValidator.validate_slippage(1001)  # Just over 10%


class TestBalanceValidation:
    """Tests for balance validation."""
    
    @pytest.mark.asyncio
    async def test_sufficient_balance(self):
        """Test sufficient balance passes."""
        quote = MockQuote()
        
        mock_wallet_service = MagicMock()
        mock_wallet_service.get_evm_token_balance = AsyncMock(return_value=150.0)
        
        # Mock the database session
        mock_wallet = MagicMock()
        mock_wallet.chain_type = "evm"
        mock_wallet.address = "0x123"
        
        mock_session = MagicMock()
        mock_query = MagicMock()
        mock_filter = MagicMock()
        mock_filter.first.return_value = mock_wallet
        mock_query.filter.return_value = mock_filter
        mock_session.query.return_value = mock_query
        
        # Create a context manager mock
        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=mock_session)
        mock_context.__exit__ = MagicMock(return_value=None)
        
        with pytest.MonkeyPatch().context() as m:
            m.setattr("database.db.get_session", lambda: mock_context)
            
            result = await QuoteValidator.validate_balance(
                wallet_id=1,
                quote=quote,
                wallet_service=mock_wallet_service,
            )
            assert result is True
    
    @pytest.mark.asyncio
    async def test_insufficient_balance(self):
        """Test insufficient balance raises error."""
        quote = MockQuote()
        
        mock_wallet_service = MagicMock()
        mock_wallet_service.get_evm_token_balance = AsyncMock(return_value=50.0)  # Less than 100
        
        # Mock the database session
        mock_wallet = MagicMock()
        mock_wallet.chain_type = "evm"
        mock_wallet.address = "0x123"
        
        mock_session = MagicMock()
        mock_query = MagicMock()
        mock_filter = MagicMock()
        mock_filter.first.return_value = mock_wallet
        mock_query.filter.return_value = mock_filter
        mock_session.query.return_value = mock_query
        
        # Create a context manager mock
        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=mock_session)
        mock_context.__exit__ = MagicMock(return_value=None)
        
        with pytest.MonkeyPatch().context() as m:
            m.setattr("database.db.get_session", lambda: mock_context)
            
            with pytest.raises(SwapError, match="Insufficient"):
                await QuoteValidator.validate_balance(
                    wallet_id=1,
                    quote=quote,
                    wallet_service=mock_wallet_service,
                )

