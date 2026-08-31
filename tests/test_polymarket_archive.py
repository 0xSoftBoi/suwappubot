"""Tests for the Polymarket Orderbook Archive client (pure logic + fetch caching)."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bot.services import polymarket_archive as archive


def _utc(y, m, d, h):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


class TestEraResolution:
    def test_v3_hour(self):
        era = archive.resolve_era(_utc(2026, 8, 30, 23))
        assert era is not None and era.key == "v3"

    def test_v3_is_open_ended(self):
        era = archive.resolve_era(_utc(2027, 1, 1, 0))
        assert era is not None and era.key == "v3"

    def test_v1_v2_overlap_prefers_v2(self):
        # 2026-04-14 is inside both pmxt/v1 and pmxt/v2 spans.
        era = archive.resolve_era(_utc(2026, 4, 14, 12))
        assert era is not None and era.key == "pmxt/v2"

    def test_overlap_can_pin_v1(self):
        era = archive.resolve_era(_utc(2026, 4, 14, 12), era_key="pmxt/v1")
        assert era is not None and era.key == "pmxt/v1"

    def test_ag6_serves_after_pmxt_ends(self):
        # pmxt/v2 ends 2026-08-09T23; ag6 carries 08-10T00 .. 08-15T09.
        era = archive.resolve_era(_utc(2026, 8, 12, 0))
        assert era is not None and era.key == "third-party/ag6"

    def test_v2_ag6_overlap_prefers_v2(self):
        # ag6 starts 08-09T20, four hours before pmxt/v2 ends.
        era = archive.resolve_era(_utc(2026, 8, 9, 21))
        assert era is not None and era.key == "pmxt/v2"

    def test_true_gap_between_ag6_and_v3(self):
        # The only real hole: 68h, 2026-08-15T10 .. 2026-08-18T05.
        assert archive.resolve_era(_utc(2026, 8, 15, 10)) is None
        assert archive.resolve_era(_utc(2026, 8, 16, 0)) is None
        assert archive.resolve_era(_utc(2026, 8, 18, 5)) is None
        assert archive.resolve_era(_utc(2026, 8, 15, 9)).key == "third-party/ag6"
        assert archive.resolve_era(_utc(2026, 8, 18, 6)).key == "v3"

    def test_before_all_eras(self):
        assert archive.resolve_era(_utc(2026, 1, 1, 0)) is None

    def test_pinned_era_outside_span(self):
        assert archive.resolve_era(_utc(2026, 8, 30, 0), era_key="pmxt/v2") is None


class TestUrls:
    def test_v3_layout(self):
        entry = archive.hour_urls(_utc(2026, 8, 30, 23))
        assert entry["url"] == (
            "https://archive.pendulumflow.com/v3/2026-08-30/23/2026-08-30T23.parquet"
        )
        assert entry["manifest_url"] == (
            "https://archive.pendulumflow.com/v3/2026-08-30/23/manifest.json"
        )
        assert entry["era"] == "v3"

    def test_pmxt_layout_no_manifest(self):
        entry = archive.hour_urls(_utc(2026, 5, 1, 7))
        assert entry["url"] == (
            "https://archive.pendulumflow.com/pmxt/v2/polymarket_orderbook_2026-05-01T07.parquet"
        )
        assert entry["manifest_url"] is None

    def test_unserved_hour_is_none(self):
        assert archive.hour_urls(_utc(2026, 8, 16, 0)) is None

    def test_ag6_layout(self):
        entry = archive.hour_urls(_utc(2026, 8, 10, 0))
        assert entry["url"] == (
            "https://archive.pendulumflow.com/third-party/ag6/"
            "polymarket_orderbook_2026-08-10T00.parquet"
        )
        assert entry["era"] == "third-party/ag6"
        assert entry["manifest_url"] is None

    def test_sha256sums_urls(self):
        assert archive.sha256sums_url("v3") == (
            "https://archive.pendulumflow.com/v3/SHA256SUMS.txt"
        )
        assert archive.sha256sums_url("third-party/ag6") is None
        assert archive.sha256sums_url("bogus") is None

    def test_sub_hour_times_floor(self):
        entry = archive.hour_urls(datetime(2026, 8, 30, 23, 59, 59, tzinfo=timezone.utc))
        assert entry["hour_utc"] == "2026-08-30T23:00Z"


class TestRange:
    def test_range_v2_hands_off_to_ag6(self):
        entries = archive.hours_in_range(_utc(2026, 8, 9, 22), _utc(2026, 8, 10, 1))
        expected = ["pmxt/v2", "pmxt/v2", "third-party/ag6", "third-party/ag6"]
        assert [e["era"] for e in entries] == expected

    def test_range_includes_gaps_as_unserved(self):
        entries = archive.hours_in_range(_utc(2026, 8, 15, 8), _utc(2026, 8, 15, 11))
        expected = ["third-party/ag6", "third-party/ag6", None, None]
        assert [e["era"] for e in entries] == expected

    def test_range_cap(self):
        with pytest.raises(ValueError):
            archive.hours_in_range(_utc(2026, 8, 20, 0), _utc(2026, 8, 30, 0))

    def test_reversed_range(self):
        with pytest.raises(ValueError):
            archive.hours_in_range(_utc(2026, 8, 21, 0), _utc(2026, 8, 20, 0))


def _fake_session(payload, status=200):
    resp = MagicMock()
    resp.status = status
    resp.json = AsyncMock(return_value=payload)
    resp.raise_for_status = MagicMock()
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=resp)
    ctx.__aexit__ = AsyncMock(return_value=False)
    session = MagicMock()
    session.get = MagicMock(return_value=ctx)
    return session


@pytest.mark.asyncio
async def test_metadata_fetch_and_cache():
    await archive._metadata_cache.clear()
    session = _fake_session({"hours": {}})
    with patch("bot.services.polymarket_archive.get_session", AsyncMock(return_value=session)):
        first = await archive.get_coverage("v3")
        second = await archive.get_coverage("v3")
    assert first == {"hours": {}} and second == {"hours": {}}
    assert session.get.call_count == 1  # second hit served from cache
    session.get.assert_called_with("https://archive.pendulumflow.com/v3/COVERAGE.json")


@pytest.mark.asyncio
async def test_manifest_404_returns_none():
    await archive._metadata_cache.clear()
    session = _fake_session(None, status=404)
    with patch("bot.services.polymarket_archive.get_session", AsyncMock(return_value=session)):
        assert await archive.get_hour_manifest(_utc(2026, 8, 30, 23)) is None


@pytest.mark.asyncio
async def test_latest_available_hour_probes_backwards():
    # First probe (newest hour) 404s, second responds 200.
    resp_404 = MagicMock(status=404)
    resp_200 = MagicMock(status=200)
    ctxs = []
    for resp in (resp_404, resp_200):
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=resp)
        ctx.__aexit__ = AsyncMock(return_value=False)
        ctxs.append(ctx)
    session = MagicMock()
    session.head = MagicMock(side_effect=ctxs)
    with patch("bot.services.polymarket_archive.get_session", AsyncMock(return_value=session)):
        entry = await archive.latest_available_hour(max_probes=3)
    assert entry is not None and entry["era"] == "v3"
    assert session.head.call_count == 2
    # The returned hour is the second one probed (one further back).
    assert entry["url"] == session.head.call_args_list[1][0][0]


@pytest.mark.asyncio
async def test_unknown_era_metadata_is_none():
    assert await archive.get_coverage("v9") is None
    assert await archive.get_schema("nope") is None
