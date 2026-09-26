"""Tests for the Polymarket prediction-market monitor — PnL math and market
resolution detection. Pure logic only (no live network / funds): we exercise the
static helpers that drive the reconciliation loop.
"""

import os
from decimal import Decimal

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.services.predict_monitor import PredictMonitor  # noqa: E402
from bot.services.polymarket_api import PolymarketClient  # noqa: E402

# --- unrealized PnL ---------------------------------------------------------


def test_compute_pnl_gain():
    # 100 shares bought for $40, now worth 0.60 -> $60 value, +$20 PnL.
    pnl = PredictMonitor.compute_pnl(Decimal("100"), 0.60, Decimal("40"))
    assert pnl == Decimal("20.000000")


def test_compute_pnl_loss():
    pnl = PredictMonitor.compute_pnl(Decimal("100"), 0.20, Decimal("40"))
    assert pnl == Decimal("-20.000000")


def test_compute_pnl_handles_none():
    assert PredictMonitor.compute_pnl(None, None, None) == Decimal("0")


# --- resolution detection ---------------------------------------------------


def test_resolve_winner_picks_winning_token():
    market = {
        "closed": True,
        "tokens": [
            {"token_id": "111", "outcome": "Yes", "winner": True},
            {"token_id": "222", "outcome": "No", "winner": False},
        ],
    }
    res = PolymarketClient.resolve_winner(market)
    assert res is not None
    assert res["winning_token_ids"] == {"111"}


def test_resolve_winner_unresolved_when_not_closed():
    market = {
        "closed": False,
        "tokens": [{"token_id": "111", "outcome": "Yes", "winner": True}],
    }
    assert PolymarketClient.resolve_winner(market) is None


def test_resolve_winner_unresolved_when_no_winner_flag():
    # Closed but mid-resolution: no winner flags yet -> don't settle early.
    market = {
        "closed": True,
        "tokens": [
            {"token_id": "111", "outcome": "Yes", "winner": False},
            {"token_id": "222", "outcome": "No", "winner": False},
        ],
    }
    assert PolymarketClient.resolve_winner(market) is None


def test_resolve_winner_empty_market():
    assert PolymarketClient.resolve_winner({}) is None
    assert PolymarketClient.resolve_winner(None) is None
