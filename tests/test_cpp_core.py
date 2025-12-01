"""Tests for suwappu_core C++ extension module."""

import time
import pytest

# Try to import C++ module, skip tests if not available
try:
    import suwappu_core
    HAS_CPP_CORE = True
except ImportError:
    HAS_CPP_CORE = False

pytestmark = pytest.mark.skipif(not HAS_CPP_CORE, reason="C++ extension not built")


class TestMathUtils:
    """Test C++ math utility functions."""
    
    def test_to_raw_amount_basic(self):
        """Test basic decimal conversion."""
        result = suwappu_core.to_raw_amount(1.5, 18)
        assert result == "1500000000000000000"
    
    def test_to_raw_amount_whole_number(self):
        """Test whole number conversion."""
        result = suwappu_core.to_raw_amount(1.0, 18)
        assert result == "1000000000000000000"
    
    def test_to_raw_amount_small_decimals(self):
        """Test with small decimal places (like USDC with 6 decimals)."""
        result = suwappu_core.to_raw_amount(100.5, 6)
        assert result == "100500000"
    
    def test_to_raw_amount_zero(self):
        """Test zero amount."""
        result = suwappu_core.to_raw_amount(0, 18)
        assert result == "0"
    
    def test_to_human_amount_basic(self):
        """Test raw to human conversion."""
        result = suwappu_core.to_human_amount("1500000000000000000", 18)
        assert result == 1.5
    
    def test_to_human_amount_small(self):
        """Test small raw amount."""
        result = suwappu_core.to_human_amount("100500000", 6)
        assert result == 100.5
    
    def test_to_human_amount_zero(self):
        """Test zero raw amount."""
        result = suwappu_core.to_human_amount("0", 18)
        assert result == 0.0
    
    def test_to_human_amount_hex(self):
        """Test hex string parsing."""
        # 0x1234 = 4660
        result = suwappu_core.to_human_amount("0x1234", 2)
        assert result == 46.6
    
    def test_parse_int_decimal(self):
        """Test parsing decimal string."""
        result = suwappu_core.parse_int("12345")
        assert result == 12345
    
    def test_parse_int_hex(self):
        """Test parsing hex string."""
        result = suwappu_core.parse_int("0x1234")
        assert result == 4660
    
    def test_parse_int_hex_uppercase(self):
        """Test parsing uppercase hex."""
        result = suwappu_core.parse_int("0X1234")
        assert result == 4660
    
    def test_parse_int_default(self):
        """Test default value for invalid input."""
        result = suwappu_core.parse_int("invalid", 42)
        assert result == 42
    
    def test_parse_int_empty(self):
        """Test empty string returns default."""
        result = suwappu_core.parse_int("", 0)
        assert result == 0
    
    def test_roundtrip_conversion(self):
        """Test that conversions are reversible."""
        original = 123.456789
        decimals = 18
        raw = suwappu_core.to_raw_amount(original, decimals)
        human = suwappu_core.to_human_amount(raw, decimals)
        # Allow small floating point difference
        assert abs(human - original) < 1e-10


class TestNativeQuoteValidator:
    """Test C++ quote validation functions."""
    
    def test_validate_freshness_valid(self):
        """Test valid fresh quote."""
        now = int(time.time())
        result = suwappu_core.NativeQuoteValidator.validate_freshness(now - 10)
        assert result is True
    
    def test_validate_freshness_expired(self):
        """Test expired quote raises error."""
        now = int(time.time())
        with pytest.raises(Exception) as exc_info:
            suwappu_core.NativeQuoteValidator.validate_freshness(now - 60)
        assert "expired" in str(exc_info.value).lower()
    
    def test_validate_freshness_custom_expiry(self):
        """Test custom expiry time."""
        now = int(time.time())
        # Should pass with 120s max age
        result = suwappu_core.NativeQuoteValidator.validate_freshness(now - 60, 120)
        assert result is True
    
    def test_validate_slippage_valid(self):
        """Test valid slippage."""
        result = suwappu_core.NativeQuoteValidator.validate_slippage(50)  # 0.5%
        assert result is True
    
    def test_validate_slippage_too_high(self):
        """Test slippage too high raises error."""
        with pytest.raises(Exception) as exc_info:
            suwappu_core.NativeQuoteValidator.validate_slippage(2000)  # 20%
        assert "slippage" in str(exc_info.value).lower()
    
    def test_validate_slippage_custom_max(self):
        """Test custom max slippage."""
        # Should pass with 50% max
        result = suwappu_core.NativeQuoteValidator.validate_slippage(2000, 5000)
        assert result is True
    
    def test_validate_balance_sufficient(self):
        """Test sufficient balance."""
        result = suwappu_core.NativeQuoteValidator.validate_balance(100.0, 50.0, "USDT")
        assert result is True
    
    def test_validate_balance_insufficient(self):
        """Test insufficient balance raises error."""
        with pytest.raises(Exception) as exc_info:
            suwappu_core.NativeQuoteValidator.validate_balance(10.0, 50.0, "USDT")
        assert "insufficient" in str(exc_info.value).lower()
    
    def test_validate_gas_sufficient(self):
        """Test sufficient gas."""
        result = suwappu_core.NativeQuoteValidator.validate_gas(0.1, 1.0, "ethereum")
        assert result is True
    
    def test_validate_gas_insufficient(self):
        """Test insufficient gas raises error."""
        with pytest.raises(Exception) as exc_info:
            suwappu_core.NativeQuoteValidator.validate_gas(0.00001, 100.0, "ethereum")
        assert "gas" in str(exc_info.value).lower()


class TestEncryption:
    """Test C++ encryption functions."""
    
    def test_derive_key(self):
        """Test key derivation."""
        key, salt = suwappu_core.derive_key("test_password")
        assert len(key) > 0
        assert len(salt) > 0
    
    def test_derive_key_with_salt(self):
        """Test key derivation with provided salt."""
        _, salt1 = suwappu_core.derive_key("password")
        key1, _ = suwappu_core.derive_key("password", salt1)
        key2, _ = suwappu_core.derive_key("password", salt1)
        assert key1 == key2
    
    def test_encrypt_decrypt_roundtrip(self):
        """Test encryption and decryption roundtrip."""
        private_key = "0x1234567890abcdef" * 4
        encryption_key = "a" * 64
        
        encrypted = suwappu_core.encrypt_private_key(private_key, encryption_key)
        decrypted = suwappu_core.decrypt_private_key(encrypted, encryption_key)
        
        assert decrypted == private_key
    
    def test_encrypt_different_outputs(self):
        """Test that encrypting same key twice gives different outputs (due to random salt)."""
        private_key = "test_key"
        encryption_key = "b" * 64
        
        encrypted1 = suwappu_core.encrypt_private_key(private_key, encryption_key)
        encrypted2 = suwappu_core.encrypt_private_key(private_key, encryption_key)
        
        # Different ciphertexts due to random salt/IV
        assert encrypted1 != encrypted2
        
        # But both decrypt to same value
        assert suwappu_core.decrypt_private_key(encrypted1, encryption_key) == private_key
        assert suwappu_core.decrypt_private_key(encrypted2, encryption_key) == private_key
    
    def test_decrypt_wrong_key(self):
        """Test that wrong key fails decryption."""
        private_key = "secret"
        
        encrypted = suwappu_core.encrypt_private_key(private_key, "a" * 64)
        
        with pytest.raises(Exception):
            suwappu_core.decrypt_private_key(encrypted, "b" * 64)


class TestBenchmark:
    """Benchmark C++ vs Python implementations."""
    
    def test_math_performance(self):
        """Benchmark math conversions."""
        import timeit
        
        # C++ version
        cpp_time = timeit.timeit(
            'suwappu_core.to_raw_amount(123.456789, 18)',
            globals={'suwappu_core': suwappu_core},
            number=10000
        )
        
        # Python version
        def py_to_raw_amount(amount, decimals):
            raw = int(amount * (10 ** decimals))
            return str(raw)
        
        py_time = timeit.timeit(
            'py_to_raw_amount(123.456789, 18)',
            globals={'py_to_raw_amount': py_to_raw_amount},
            number=10000
        )
        
        print(f"\nC++ time: {cpp_time:.4f}s")
        print(f"Python time: {py_time:.4f}s")
        print(f"Speedup: {py_time/cpp_time:.2f}x")
        
        # C++ should be at least comparable (may not always be faster for simple ops)
        assert cpp_time < py_time * 5  # Allow some variance

