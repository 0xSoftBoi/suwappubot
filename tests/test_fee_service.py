"""Tests for FeeService."""

import pytest
from decimal import Decimal
from bot.services.fee_service import FeeService, SWAP_FEE_PERCENTAGE, REFERRAL_REWARD_PERCENTAGE


@pytest.fixture
def fee_service():
    return FeeService()


class TestCalculateFee:
    def test_basic_fee_calculation(self, fee_service):
        calc = fee_service.calculate_fee(1000.0)
        assert calc.fee_amount_usd == Decimal("8.00")
        assert calc.fee_percentage == SWAP_FEE_PERCENTAGE
        assert calc.referral_reward_usd == Decimal("0")
        assert calc.net_fee_usd == Decimal("8.00")
        assert calc.has_referrer is False

    def test_fee_with_referrer(self, fee_service):
        calc = fee_service.calculate_fee(1000.0, referrer_id=42)
        assert calc.fee_amount_usd == Decimal("8.00")
        assert calc.referral_reward_usd == Decimal("2.40")  # 30% of 8.00
        assert calc.net_fee_usd == Decimal("5.60")
        assert calc.has_referrer is True
        assert calc.referrer_id == 42

    def test_zero_amount(self, fee_service):
        calc = fee_service.calculate_fee(0)
        assert calc.fee_amount_usd == Decimal("0.00")
        assert calc.net_fee_usd == Decimal("0.00")

    def test_small_amount(self, fee_service):
        calc = fee_service.calculate_fee(1.0)
        # 0.8% of $1 = $0.008, truncated to $0.00
        assert calc.fee_amount_usd == Decimal("0.00")

    def test_large_amount(self, fee_service):
        calc = fee_service.calculate_fee(100000.0)
        assert calc.fee_amount_usd == Decimal("800.00")


class TestValidateSwapAmount:
    def test_valid_amount(self, fee_service):
        is_valid, msg = fee_service.validate_swap_amount(100.0)
        assert is_valid is True
        assert msg == ""

    def test_below_minimum(self, fee_service):
        is_valid, msg = fee_service.validate_swap_amount(0.5)
        assert is_valid is False
        assert "Minimum" in msg

    def test_above_maximum(self, fee_service):
        is_valid, msg = fee_service.validate_swap_amount(200000.0)
        assert is_valid is False
        assert "Maximum" in msg

    def test_exact_minimum(self, fee_service):
        is_valid, _ = fee_service.validate_swap_amount(1.0)
        assert is_valid is True

    def test_exact_maximum(self, fee_service):
        is_valid, _ = fee_service.validate_swap_amount(100000.0)
        assert is_valid is True


class TestCalculateFeeInToken:
    def test_token_fee(self, fee_service):
        calc = fee_service.calculate_fee_in_token(
            swap_amount=10.0,
            token_price_usd=100.0,
            token_symbol="ETH",
        )
        assert calc.token_symbol == "ETH"
        assert calc.fee_amount_token is not None
        assert float(calc.fee_amount_token) > 0

    def test_zero_price(self, fee_service):
        calc = fee_service.calculate_fee_in_token(
            swap_amount=10.0,
            token_price_usd=0.0,
            token_symbol="UNKNOWN",
        )
        assert calc.fee_amount_token is None


class TestFormatFeeInfo:
    def test_format_returns_string(self, fee_service):
        info = fee_service.format_fee_info()
        assert isinstance(info, str)
        assert "0.8%" in info
        assert "30%" in info
