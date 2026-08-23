"""The candle-size picker and the aggregation it maps to."""

from __future__ import annotations

import pytest

from curve.api import (
    CANDLE_COUNT,
    CANDLE_SIZES,
    DEFAULT_CANDLE_SIZE,
    CandleSize,
    CurveApi,
    get_candle_size,
)


def test_every_size_the_picker_offers() -> None:
    assert [s.label for s in CANDLE_SIZES] == [
        "15m", "30m", "1h", "4h", "6h", "12h", "1d", "7d", "14d",
    ]


def test_units_stay_inside_the_api_enum() -> None:
    for size in CANDLE_SIZES:
        assert size.agg_units in ("minute", "hour", "day"), size.label


def test_seconds_match_the_aggregation() -> None:
    per_unit = {"minute": 60, "hour": 3600, "day": 86400}
    for size in CANDLE_SIZES:
        assert size.seconds == size.agg_number * per_unit[size.agg_units], size.label


def test_sizes_are_ordered_shortest_first() -> None:
    seconds = [s.seconds for s in CANDLE_SIZES]
    assert seconds == sorted(seconds)


def test_the_window_follows_from_the_candle() -> None:
    assert get_candle_size("15m").window() == 900 * CANDLE_COUNT
    assert get_candle_size("1d").window(10) == 86400 * 10


def test_default_is_offered_and_matches_curve() -> None:
    assert DEFAULT_CANDLE_SIZE == "1d"
    assert get_candle_size(DEFAULT_CANDLE_SIZE).label == DEFAULT_CANDLE_SIZE


def test_unknown_label_falls_back_to_the_default() -> None:
    assert get_candle_size("nonsense").label == DEFAULT_CANDLE_SIZE
    assert get_candle_size("").label == DEFAULT_CANDLE_SIZE


# -- what actually gets sent -----------------------------------------------


class RecordingApi(CurveApi):
    """Captures the query instead of making it."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[tuple[str, dict]] = []

    async def _v1(self, path, params=None):
        self.calls.append((path, params or {}))
        return {"data": []}


async def test_lp_candles_sends_the_aggregation_and_window() -> None:
    api = RecordingApi()
    size = get_candle_size("15m")
    await api.lp_candles("ethereum", "0xpool", size=size, count=200, now=1_000_000)
    path, params = api.calls[-1]
    assert path == "/lp_ohlc/ethereum/0xpool"
    assert params["agg_number"] == 15
    assert params["agg_units"] == "minute"
    assert params["end"] - params["start"] == 900 * 200


async def test_pair_candles_sends_the_same_aggregation() -> None:
    api = RecordingApi()
    await api.pair_candles(
        "ethereum", "0xpool", "0xa", "0xb", size=get_candle_size("4h"), now=1_000_000
    )
    _, params = api.calls[-1]
    assert (params["agg_number"], params["agg_units"]) == (4, "hour")


async def test_a_pair_is_sent_the_way_the_endpoint_reads_it() -> None:
    api = RecordingApi()
    await api.pair_candles(
        "ethereum", "0xpool", base="0xWBTC", quote="0xUSDC",
        size=get_candle_size("4h"), now=1_000_000,
    )
    _, params = api.calls[-1]
    assert params["main_token"] == "0xUSDC"
    assert params["reference_token"] == "0xWBTC"


async def test_the_two_directions_of_a_pair_are_cached_apart() -> None:
    api = RecordingApi()
    for base, quote in [("0xa", "0xb"), ("0xb", "0xa"), ("0xa", "0xb")]:
        await api.pair_candles(
            "ethereum", "0xpool", base, quote, size=get_candle_size("1h"), now=1_000_000
        )
    assert len(api.calls) == 2  # the repeat came from cache, the flip did not


async def test_each_size_is_cached_separately() -> None:
    api = RecordingApi()
    for label in ("1h", "4h", "1h"):
        await api.lp_candles(
            "ethereum", "0xpool", size=get_candle_size(label), now=1_000_000
        )
    assert len(api.calls) == 2


@pytest.mark.parametrize("size", CANDLE_SIZES, ids=lambda s: s.label)
def test_no_size_asks_for_an_absurd_window(size: CandleSize) -> None:
    assert 0 < size.window() <= 86400 * 365 * 10
