"""Lightweight shape/logic tests for the public read-only Final Stretch
(pre-migration) discovery route in api/routes/terminal.py — no network calls,
no auth, display/filter data only."""

import pytest

from api.routes.terminal import (
    _final_stretch_bundle_pct,
    _final_stretch_insiders_pct,
    _final_stretch_row,
)


def test_insiders_pct_none_without_enough_tape():
    assert _final_stretch_insiders_pct(2, 1) is None


def test_insiders_pct_reflects_buy_skew():
    # Heavily buy-skewed tape -> high insiders proxy.
    pct = _final_stretch_insiders_pct(90, 10)
    assert pct is not None
    assert 70 <= pct <= 100


def test_insiders_pct_balanced_tape_is_low():
    pct = _final_stretch_insiders_pct(50, 50)
    assert pct == 0.0


def test_bundle_pct_is_honestly_unknown():
    # No real bundle-buy detector wired yet — must not fabricate a number.
    assert _final_stretch_bundle_pct({"any": "pair"}) is None


def _sample_pair(**overrides):
    pair = {
        "baseToken": {"address": "MintAbc123", "symbol": "TEST", "name": "Test Token"},
        "chainId": "solana",
        "pairCreatedAt": 1_700_000_000_000,
        "marketCap": 25000,
        "fdv": 30000,
        "volume": {"h24": 120000},
        "liquidity": {"usd": 8000},
        "priceUsd": "0.00042",
        "txns": {"h24": {"buys": 80, "sells": 20}},
    }
    pair.update(overrides)
    return pair


def test_final_stretch_row_shape_has_new_fields():
    row = _final_stretch_row(_sample_pair())

    # Established Pulse fields.
    assert row["address"] == "MintAbc123"
    assert row["symbol"] == "TEST"
    assert row["stage"] == "final_stretch"
    assert row["marketCap"] == 25000
    assert row["volume24h"] == 120000
    assert row["liquidityUsd"] == 8000
    assert row["txns24h"] == 100

    # New Final Stretch fields required by the acceptance criteria.
    assert "insidersPercent" in row
    assert "bundlePercent" in row
    assert row["insidersPercent"] is not None  # 80 buys vs 20 sells -> enough tape
    assert row["bundlePercent"] is None  # honest unknown, not fabricated


def test_final_stretch_row_degrades_gracefully_on_missing_fields():
    pair = {"baseToken": {"address": "MintNoData"}}
    row = _final_stretch_row(pair)
    assert row["address"] == "MintNoData"
    assert row["marketCap"] == 0
    assert row["txns24h"] == 0
    assert row["insidersPercent"] is None
    assert row["bundlePercent"] is None


@pytest.mark.asyncio
async def test_final_stretch_endpoint_degrades_to_empty_list_on_upstream_failure(monkeypatch):
    """Matches the established pattern in this module: never 5xx, degrade to []."""
    import httpx

    from api.routes import terminal as terminal_module

    class _FailingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, *args, **kwargs):
            raise httpx.ConnectError("boom")

    monkeypatch.setattr(terminal_module.httpx, "AsyncClient", lambda **kwargs: _FailingClient())

    result = await terminal_module.get_terminal_final_stretch(limit=30)
    assert result == []
