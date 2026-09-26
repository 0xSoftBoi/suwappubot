"""Unit tests for the /portfolio execution-savings receipt block
(bot/handlers/portfolio.py).

`_compute_pro_delta_usd` is the pure, synchronous piece of the FREE->PRO
upsell math (fee rows -> "PRO would have kept you ~$Y this month" delta) —
no DB, no SwapEngine instance needed, so it's tested directly here.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.handlers.portfolio import PRO_FEE_RATE, _compute_pro_delta_usd  # noqa: E402


class TestComputeProDeltaUsd:
    def test_free_tier_row_yields_positive_delta(self):
        # $10 fee at 1.0% (FREE) -> volume=$1000; PRO (0.5%) fee would be $5.
        # delta = 10 - 5 = 5.
        delta = _compute_pro_delta_usd([(10.0, 1.0)])
        assert abs(delta - 5.0) < 1e-9

    def test_multiple_rows_sum(self):
        # Row 1: $10 @ 1.0% -> volume $1000, pro fee $5, delta $5
        # Row 2: $4 @ 1.0% -> volume $400, pro fee $2, delta $2
        delta = _compute_pro_delta_usd([(10.0, 1.0), (4.0, 1.0)])
        assert abs(delta - 7.0) < 1e-9

    def test_row_already_at_pro_rate_yields_zero_delta(self):
        # $5 @ 0.5% (already PRO rate) -> volume $1000, pro fee $5, delta $0.
        delta = _compute_pro_delta_usd([(5.0, 0.5)])
        assert abs(delta - 0.0) < 1e-9

    def test_row_below_pro_rate_yields_negative_delta(self):
        # ENTERPRISE-rate row (0.1%) sneaking into a FREE user's history
        # shouldn't happen in practice, but the math must not blow up —
        # it correctly yields a negative delta rather than clamping here;
        # callers gate display on the summed total being positive.
        delta = _compute_pro_delta_usd([(1.0, 0.1)])
        assert delta < 0

    def test_zero_fee_percentage_row_skipped_not_divide_by_zero(self):
        delta = _compute_pro_delta_usd([(10.0, 0.0), (10.0, 1.0)])
        # Only the second row (10 @ 1.0%) contributes: delta = 10 - 5 = 5.
        assert abs(delta - 5.0) < 1e-9

    def test_negative_fee_percentage_row_skipped(self):
        delta = _compute_pro_delta_usd([(10.0, -1.0)])
        assert delta == 0.0

    def test_empty_rows_returns_zero(self):
        assert _compute_pro_delta_usd([]) == 0.0

    def test_pro_fee_rate_matches_business_context(self):
        # PRO tier's swap fee is 50bps per the business context in the brief.
        assert abs(PRO_FEE_RATE - 0.005) < 1e-12
