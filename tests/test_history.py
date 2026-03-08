"""Tests for history handler pagination and stats."""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from datetime import datetime

from bot.handlers.history import _get_status_emoji, SWAPS_PER_PAGE
from bot.models.swap import SwapStatus


class TestGetStatusEmoji:
    def test_completed(self):
        assert _get_status_emoji(SwapStatus.COMPLETED.value) == "✅"

    def test_failed(self):
        assert _get_status_emoji(SwapStatus.FAILED.value) == "❌"

    def test_pending(self):
        assert _get_status_emoji(SwapStatus.PENDING.value) == "⏳"

    def test_executing(self):
        assert _get_status_emoji(SwapStatus.EXECUTING.value) == "🔄"

    def test_submitted(self):
        assert _get_status_emoji(SwapStatus.SUBMITTED.value) == "📤"

    def test_cancelled(self):
        assert _get_status_emoji(SwapStatus.CANCELLED.value) == "🚫"

    def test_unknown(self):
        assert _get_status_emoji("unknown_status") == "❓"


class TestPaginationConstants:
    def test_swaps_per_page(self):
        assert SWAPS_PER_PAGE == 5
        assert SWAPS_PER_PAGE > 0

    def test_page_calculation(self):
        """Test page count calculation logic."""
        total = 13
        per_page = SWAPS_PER_PAGE
        total_pages = max(1, (total + per_page - 1) // per_page)
        assert total_pages == 3

    def test_page_calculation_exact(self):
        """Test page count when total is exact multiple."""
        total = 10
        per_page = SWAPS_PER_PAGE
        total_pages = max(1, (total + per_page - 1) // per_page)
        assert total_pages == 2

    def test_page_calculation_zero(self):
        """Test page count with zero swaps."""
        total = 0
        per_page = SWAPS_PER_PAGE
        total_pages = max(1, (total + per_page - 1) // per_page)
        assert total_pages == 1

    def test_page_calculation_single(self):
        """Test page count with single swap."""
        total = 1
        per_page = SWAPS_PER_PAGE
        total_pages = max(1, (total + per_page - 1) // per_page)
        assert total_pages == 1
