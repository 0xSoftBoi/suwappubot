"""Wave 5: token-security signal integrity.

The liquidity check previously hardcoded liquidity_sol=0 and emitted a fabricated
MEDIUM "very low liquidity" risk factor for EVERY token. This verifies it no
longer fabricates a measurement or a scored risk factor when liquidity is unknown.
"""

import asyncio
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.token_security.token_analyzer import (
    token_analyzer, TokenSafetyReport, RiskCategory,
)


def test_liquidity_check_does_not_fabricate_low_liquidity():
    report = TokenSafetyReport(token_mint="SoMeMint1111111111111111111111111111111111")
    asyncio.run(token_analyzer._check_liquidity(report.token_mint, report))

    # No fabricated LOW_LIQUIDITY risk factor (the old bug added one every time).
    assert not any(f.category == RiskCategory.LOW_LIQUIDITY for f in report.risk_factors)
    # Liquidity is honestly reported as unknown, not a fake measured 0.
    assert report.liquidity_sol is None
    # An honest, non-scoring warning is surfaced instead.
    assert any("not verified" in w.lower() for w in report.warnings)


def test_report_serializes_unknown_liquidity_as_null():
    report = TokenSafetyReport(token_mint="m")
    assert report.to_dict()["liquidity_sol"] is None
