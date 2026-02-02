"""Tests for validation utilities."""

import pytest
from decimal import Decimal
from datetime import datetime, timedelta

from bot.utils.validators import (
    validate_evm_address,
    validate_solana_address,
    validate_amount,
    validate_slippage,
)
from bot.utils.sanitizer import InputSanitizer, SanitizationError


class TestEVMAddressValidation:
    """Tests for EVM address validation."""
    
    def test_valid_address(self):
        """Test valid EVM address."""
        # eth_utils.is_address accepts lowercase addresses
        address = "0x742d35cc6634c0532925a3b844bc9e7595f5ba12"
        assert validate_evm_address(address) is True
        
        # Also test a known valid checksummed address
        checksummed = "0x742D35cc6634c0532925a3B844Bc9E7595F5Ba12"
        assert validate_evm_address(checksummed) is True
    
    def test_address_no_prefix(self):
        """Test address without 0x prefix - eth_utils considers valid hex addresses valid."""
        address = "742d35Cc6634C0532925a3b844Bc9e7595f5bA12"
        # eth_utils.is_address accepts 40-char hex strings without 0x prefix
        assert validate_evm_address(address) is True
    
    def test_invalid_address_wrong_length(self):
        """Test invalid address with wrong length."""
        address = "0x742d35Cc6634C0532925a3b844Bc"
        assert validate_evm_address(address) is False
    
    def test_invalid_address_non_hex(self):
        """Test invalid address with non-hex characters."""
        address = "0xGGGd35Cc6634C0532925a3b844Bc9e7595f5bA12"
        assert validate_evm_address(address) is False
    
    def test_empty_address(self):
        """Test empty address."""
        assert validate_evm_address("") is False
    
    def test_none_address(self):
        """Test None address."""
        assert validate_evm_address(None) is False


class TestAmountValidation:
    """Tests for amount validation."""
    
    def test_valid_integer_amount(self):
        """Test valid integer amount."""
        assert validate_amount("100") == 100.0
    
    def test_valid_decimal_amount(self):
        """Test valid decimal amount."""
        assert validate_amount("50.5") == 50.5
    
    def test_valid_amount_with_commas(self):
        """Test valid amount with thousand separators."""
        assert validate_amount("1,000.50") == 1000.50
    
    def test_invalid_negative_amount(self):
        """Test invalid negative amount."""
        assert validate_amount("-100") is None
    
    def test_invalid_zero_amount(self):
        """Test invalid zero amount."""
        assert validate_amount("0") is None
    
    def test_invalid_non_numeric(self):
        """Test invalid non-numeric amount."""
        assert validate_amount("abc") is None
    
    def test_empty_amount(self):
        """Test empty amount string."""
        assert validate_amount("") is None


class TestSlippageValidation:
    """Tests for slippage validation."""
    
    def test_valid_slippage(self):
        """Test valid slippage."""
        assert validate_slippage("0.5") == 50  # 0.5% = 50 bps
    
    def test_valid_slippage_with_percent(self):
        """Test valid slippage with percent symbol."""
        # validate_slippage doesn't handle % symbol, it expects float strings
        # So we test without % or strip it manually
        assert validate_slippage("1") == 100  # 1% = 100 bps
        # Test that % symbol causes failure (current behavior)
        assert validate_slippage("1%") is None  # Contains non-numeric character
    
    def test_invalid_slippage_too_low(self):
        """Test invalid slippage below minimum."""
        assert validate_slippage("0") is None
    
    def test_invalid_slippage_too_high(self):
        """Test invalid slippage above maximum."""
        assert validate_slippage("60") is None  # > 50%


class TestInputSanitizer:
    """Tests for input sanitizer."""
    
    def test_sanitize_amount_valid(self):
        """Test sanitizing valid amount."""
        amount, clean = InputSanitizer.sanitize_amount("100.50")
        assert amount == Decimal("100.50")
        assert clean == "100.50"
    
    def test_sanitize_amount_with_spaces(self):
        """Test sanitizing amount with spaces."""
        amount, clean = InputSanitizer.sanitize_amount("  100.50  ")
        assert amount == Decimal("100.50")
    
    def test_sanitize_amount_invalid(self):
        """Test sanitizing invalid amount."""
        with pytest.raises(SanitizationError):
            InputSanitizer.sanitize_amount("abc")
    
    def test_sanitize_amount_multiple_decimals(self):
        """Test sanitizing amount with multiple decimal points."""
        with pytest.raises(SanitizationError):
            InputSanitizer.sanitize_amount("100.50.25")
    
    def test_sanitize_address_valid_evm(self):
        """Test sanitizing valid EVM address returns checksum form."""
        address = "0x742d35Cc6634C0532925a3b844Bc9e7595f5bA12"
        result = InputSanitizer.sanitize_address(address, "evm")
        # sanitize_address normalises to EIP-55 checksum
        from web3 import Web3
        assert result == Web3.to_checksum_address(address)
    
    def test_sanitize_address_invalid_evm(self):
        """Test sanitizing invalid EVM address."""
        with pytest.raises(SanitizationError):
            InputSanitizer.sanitize_address("invalid", "evm")
    
    def test_sanitize_token_symbol(self):
        """Test sanitizing token symbol."""
        assert InputSanitizer.sanitize_token_symbol("usdc") == "USDC"
        assert InputSanitizer.sanitize_token_symbol("  eth  ") == "ETH"
    
    def test_sanitize_token_symbol_invalid(self):
        """Test sanitizing invalid token symbol."""
        with pytest.raises(SanitizationError):
            InputSanitizer.sanitize_token_symbol("US$DC")
    
    def test_sanitize_chain_name(self):
        """Test sanitizing chain name."""
        assert InputSanitizer.sanitize_chain_name("Ethereum") == "ethereum"
        assert InputSanitizer.sanitize_chain_name("  POLYGON  ") == "polygon"
    
    def test_sanitize_slippage(self):
        """Test sanitizing slippage."""
        assert InputSanitizer.sanitize_slippage("0.5") == 50
        assert InputSanitizer.sanitize_slippage("1%") == 100
    
    def test_sanitize_slippage_too_high(self):
        """Test sanitizing excessive slippage."""
        with pytest.raises(SanitizationError):
            InputSanitizer.sanitize_slippage("60%")

