"""Terminal quote serialization — the numbers and timestamps the swap ticket renders.

Three defects shipped through str()/isoformat(): scientific-notation amounts
("4.2e-05"), minimum output in raw base units ("2904646066843236691869696 PEPE"),
and naive expiry timestamps that browsers parse as local time (every client
east of UTC saw quotes expire on arrival).
"""

import os
from datetime import datetime, timezone
from types import SimpleNamespace

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from api.webapp import _iso_utc, _min_received_human, _plain_amount  # noqa: E402


def test_plain_amount_never_uses_scientific_notation():
    assert _plain_amount(4.2048360001236e-05) == "0.000042048360001236"
    assert _plain_amount(1e-7) == "0.0000001"
    assert _plain_amount(2919242.2782344082) == "2919242.2782344082"
    assert _plain_amount(5.0) == "5"
    assert _plain_amount(0) == "0"


def test_plain_amount_passes_through_garbage():
    assert _plain_amount("n/a") == "n/a"
    assert _plain_amount(float("nan")) == "nan"


def test_iso_utc_always_carries_an_offset():
    naive = datetime(2026, 9, 2, 11, 25, 49, 475634)
    assert _iso_utc(naive) == "2026-09-02T11:25:49.475Z"
    aware = datetime(2026, 9, 2, 13, 25, 49, tzinfo=timezone.utc)
    assert _iso_utc(aware).endswith("Z")


def _quote(to_amount_human, to_amount_min, slippage=0.5):
    return SimpleNamespace(
        to_amount_human=to_amount_human, to_amount_min=to_amount_min, slippage=slippage
    )


def test_min_received_scales_base_units_by_token_decimals():
    # 18-decimal PEPE, provider min in wei
    q = _quote(2919242.2782344082, "2904646066843236691869696")
    assert _min_received_human(q, "PEPE", "ethereum") == "2904646.066843236691869696"
    # 6-decimal USDC
    q = _quote(100.0, "99500000")
    assert _min_received_human(q, "USDC", "ethereum") == "99.5"


def test_min_received_keeps_already_human_values():
    q = _quote(100.0, "99.5")
    assert _min_received_human(q, "USDC", "ethereum") == "99.5"
    # Whole-number human amount: base-unit reading (0.000099) is implausible
    q = _quote(100.0, "99")
    assert _min_received_human(q, "USDC", "ethereum") == "99"


def test_min_received_falls_back_to_slippage_bound():
    q = _quote(100.0, "", slippage=1.0)
    assert _min_received_human(q, "USDC", "ethereum") == "99"
    q = _quote(100.0, "garbage", slippage=0.5)
    assert _min_received_human(q, "USDC", "ethereum") == "99.5"
