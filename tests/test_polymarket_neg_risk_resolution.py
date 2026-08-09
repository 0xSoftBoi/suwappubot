"""Tests for PolymarketClient.is_neg_risk_market's CLOB retry + Gamma fallback.

Money-path adjacent: guessing neg-risk wrong signs an order against the wrong
exchange (rejected) or misredeems on-chain (reverts, wasting gas). Covers the
round-2 review findings:
  * the CLOB resolver gets ONE short-backoff retry before falling through to
    Gamma, rather than failing closed on a single transient blip;
  * the Gamma fallback uses the `condition_ids` QUERY form (Gamma's
    `/markets/{id}` path expects Gamma's own numeric id, not condition_id, and
    404s when passed one), and reads negRisk from the first result.
"""

import os
from unittest.mock import AsyncMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

from bot.services.polymarket_api import GAMMA_BASE_URL, PolymarketClient  # noqa: E402

CONDITION_ID = "0x" + "ab" * 32


class _FakeResp:
    def __init__(self, status, payload):
        self.status = status
        self._payload = payload

    async def json(self, content_type=None):
        return self._payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeSession:
    """Records the params passed to .get() and returns a canned response."""

    def __init__(self, status, payload):
        self._status = status
        self._payload = payload
        self.calls = []

    def get(self, url, params=None):
        self.calls.append((url, params))
        return _FakeResp(self._status, self._payload)


def _client():
    return PolymarketClient()


@pytest.mark.asyncio
async def test_retries_once_on_a_transient_clob_failure_then_succeeds():
    client = _client()
    clob_mock = AsyncMock(side_effect=[None, {"neg_risk": True}])
    with (
        patch.object(client, "get_clob_market", clob_mock),
        patch("asyncio.sleep", AsyncMock()),
    ):
        result = await client.is_neg_risk_market(CONDITION_ID)
    assert result is True
    assert clob_mock.await_count == 2


@pytest.mark.asyncio
async def test_falls_through_to_gamma_after_two_failed_clob_attempts():
    client = _client()
    session = _FakeSession(200, [{"negRisk": True}])
    clob_mock = AsyncMock(return_value=None)
    with (
        patch.object(client, "get_clob_market", clob_mock),
        patch.object(client, "_get_session", AsyncMock(return_value=session)),
        patch("asyncio.sleep", AsyncMock()),
    ):
        result = await client.is_neg_risk_market(CONDITION_ID)
    assert result is True
    assert clob_mock.await_count == 2
    # Gamma fallback must use the condition_ids QUERY form against /markets,
    # not /markets/{condition_id} (that path 404s — Gamma's numeric id, not
    # the on-chain condition_id, lives there).
    url, params = session.calls[0]
    assert url == f"{GAMMA_BASE_URL}/markets"
    assert params == {"condition_ids": CONDITION_ID}


@pytest.mark.asyncio
async def test_gamma_fallback_reads_negrisk_from_the_first_list_result():
    client = _client()
    session = _FakeSession(200, [{"negRisk": False}, {"negRisk": True}])
    with (
        patch.object(client, "get_clob_market", AsyncMock(return_value=None)),
        patch.object(client, "_get_session", AsyncMock(return_value=session)),
        patch("asyncio.sleep", AsyncMock()),
    ):
        result = await client.is_neg_risk_market(CONDITION_ID)
    assert result is False  # first element, not the second


@pytest.mark.asyncio
async def test_fails_closed_to_none_when_both_sources_are_unusable():
    client = _client()
    session = _FakeSession(200, [])  # empty result list — no market found
    with (
        patch.object(client, "get_clob_market", AsyncMock(return_value=None)),
        patch.object(client, "_get_session", AsyncMock(return_value=session)),
        patch("asyncio.sleep", AsyncMock()),
    ):
        result = await client.is_neg_risk_market(CONDITION_ID)
    assert result is None
