"""Tests for the Relay (relay.link) API client — session-mocked, no network.

Uses the real quote fixture captured live against api.relay.link
(docs/research/relay/probe/quote-v2-base-usdc-to-arb-usdc-appfee.json) so the
parsing logic is checked against an actual response shape, not a hand-rolled
approximation of one.
"""

import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.relay_api import RelayAPI, RelayError  # noqa: E402

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "docs" / "research" / "relay" / "probe"
QUOTE_FIXTURE = json.loads((FIXTURE_DIR / "quote-v2-base-usdc-to-arb-usdc-appfee.json").read_text())

BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
SENDER = "0x000000000000000000000000000000000000dEaD"


class _FakeResp:
    def __init__(self, status, json_data=None, text_data=""):
        self.status = status
        self._json = json_data
        self._text = text_data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._json

    async def text(self):
        return self._text


class _FakeSession:
    """Records the last call and returns a queue of canned responses."""

    def __init__(self, responses):
        # Allow a single response or a list consumed in order (GET/POST reuse it).
        self._responses = responses if isinstance(responses, list) else [responses]
        self.calls = []

    def _next(self):
        return self._responses.pop(0) if len(self._responses) > 1 else self._responses[0]

    def get(self, url, params=None, headers=None):
        self.calls.append(("GET", url, params, None, headers))
        return self._next()

    def post(self, url, json=None, headers=None):
        self.calls.append(("POST", url, None, json, headers))
        return self._next()


def _last_post(session):
    """The most recent POST recorded on the fake session (skips the GET /chains
    refresh that a fresh RelayAPI fires before its first quote)."""
    posts = [c for c in session.calls if c[0] == "POST"]
    assert posts, f"no POST recorded; calls={session.calls}"
    return posts[-1]


def _patch(resp):
    session = _FakeSession(resp)
    return (
        patch("bot.services.relay_api.get_session", AsyncMock(return_value=session)),
        patch(
            "bot.services.relay_api.api_limiter.wait_and_acquire",
            AsyncMock(return_value=None),
        ),
        session,
    )


@pytest.fixture()
def relay():
    return RelayAPI()


# --- Quote parsing -----------------------------------------------------------


@pytest.mark.asyncio
async def test_quote_v2_parses_fixture(relay):
    """Full round-trip through the real Base USDC -> Arbitrum USDC + app-fee fixture."""
    p_session, p_limiter, session = _patch(_FakeResp(200, json_data=QUOTE_FIXTURE))
    with p_session, p_limiter:
        quote = await relay.get_quote(
            from_chain="base",
            to_chain="arbitrum",
            from_token_address=BASE_USDC,
            to_token_address=ARB_USDC,
            amount_raw="25000000",
            from_address=SENDER,
        )

    # Request actually hit POST /quote/v2. (A fresh RelayAPI's chain cache is
    # stale by construction, so get_quote's _ensure_chains_fresh() fires a
    # GET /chains first — grab the POST specifically.)
    method, url, params, body, headers = _last_post(session)
    assert method == "POST"
    assert url.endswith("/quote/v2")
    assert body["originChainId"] == 8453
    assert body["destinationChainId"] == 42161
    assert body["tradeType"] == "EXACT_INPUT"
    assert "referrer" not in body  # no api key configured -> never send referrer

    # Parsed fields match the fixture's fees{}/details{} blocks.
    assert quote.request_id == QUOTE_FIXTURE["requestId"]
    assert quote.from_amount == "25000000"
    assert quote.to_amount == "24899610"
    assert quote.to_amount_min == "24401618"  # details.currencyOut.minimumAmount
    assert quote.gas_cost_usd == pytest.approx(0.001140, abs=1e-6)
    assert quote.relayer_fee_usd == pytest.approx(0.025387, abs=1e-6)
    assert quote.app_fee_usd == pytest.approx(0.074993, abs=1e-6)
    assert quote.total_cost_usd == pytest.approx(
        quote.gas_cost_usd + quote.relayer_fee_usd + quote.app_fee_usd
    )
    assert quote.price_impact_pct == pytest.approx(-0.40)
    assert quote.estimated_fill_time == 1

    # Steps normalized in order: approve, then deposit.
    assert [s["step_id"] for s in quote.steps] == ["approve", "deposit"]
    approve_step, deposit_step = quote.steps
    assert approve_step["to"].lower() == BASE_USDC.lower()
    assert deposit_step["to"] == "0x4cd00e387622c35bddb9b4c962c136462338bc31"
    assert deposit_step["value"] == 0
    assert deposit_step["chainId"] == 8453
    assert deposit_step["gas"] == 75925
    assert deposit_step["check_endpoint"] == (
        "/intents/status/v3?requestId=0x1788802983562ebd9817070de86143ea7c0768f7fa2624ee611fafc441512c91"
    )


@pytest.mark.asyncio
async def test_app_fee_attached_when_configured(relay, monkeypatch):
    monkeypatch.setattr(
        "bot.services.relay_api.settings.relay_app_fee_recipient",
        "0x00000000000000000000000000000000000fee",
        raising=False,
    )
    monkeypatch.setattr("bot.services.relay_api.settings.relay_app_fee_bps", 30, raising=False)

    p_session, p_limiter, session = _patch(_FakeResp(200, json_data=QUOTE_FIXTURE))
    with p_session, p_limiter:
        await relay.get_quote(
            from_chain="base",
            to_chain="arbitrum",
            from_token_address=BASE_USDC,
            to_token_address=ARB_USDC,
            amount_raw="25000000",
            from_address=SENDER,
        )

    _, _, _, body, _ = _last_post(session)
    assert body["appFees"] == [
        {"recipient": "0x00000000000000000000000000000000000fee", "fee": "30"}
    ]


@pytest.mark.asyncio
async def test_referrer_only_sent_with_api_key(relay, monkeypatch):
    """Spec: sending `referrer` without a key 401s (UNAUTHORIZED_QUOTE) — only
    send it together with x-api-key."""
    monkeypatch.setattr("bot.services.relay_api.settings.relay_api_key", "test-key", raising=False)

    p_session, p_limiter, session = _patch(_FakeResp(200, json_data=QUOTE_FIXTURE))
    with p_session, p_limiter:
        await relay.get_quote(
            from_chain="base",
            to_chain="arbitrum",
            from_token_address=BASE_USDC,
            to_token_address=ARB_USDC,
            amount_raw="25000000",
            from_address=SENDER,
        )

    _, _, _, body, headers = _last_post(session)
    assert headers["x-api-key"] == "test-key"
    assert body["referrer"] == "suwappu"


@pytest.mark.asyncio
async def test_401_unauthorized_quote_raises(relay):
    error_body = '{"message":"Please provide an api key","errorCode":"UNAUTHORIZED_QUOTE"}'
    p_session, p_limiter, _ = _patch(_FakeResp(401, text_data=error_body))
    with p_session, p_limiter:
        with pytest.raises(RelayError):
            await relay.get_quote(
                from_chain="base",
                to_chain="arbitrum",
                from_token_address=BASE_USDC,
                to_token_address=ARB_USDC,
                amount_raw="25000000",
                from_address=SENDER,
            )


# --- Step validation -----------------------------------------------------------


def test_malformed_step_rejected(relay):
    bad_steps = [
        {
            "id": "deposit",
            "kind": "transaction",
            "items": [{"status": "incomplete", "data": {"value": "0", "chainId": 8453}}],
        }
    ]
    with pytest.raises(RelayError):
        relay._normalize_steps(bad_steps)


def test_signature_step_rejected(relay):
    sig_steps = [
        {
            "id": "authorize",
            "kind": "signature",
            "items": [{"status": "incomplete", "data": {"to": "0x1", "data": "0x2"}}],
        }
    ]
    with pytest.raises(RelayError, match="signature steps not supported"):
        relay._normalize_steps(sig_steps)


def test_step_with_no_items_rejected(relay):
    with pytest.raises(RelayError):
        relay._normalize_steps([{"id": "deposit", "kind": "transaction", "items": []}])


# --- Status mapping -----------------------------------------------------------


@pytest.mark.parametrize(
    "raw_status,expected",
    [
        ("success", "FILLED"),
        ("failure", "FAILED"),
        ("refund", "REFUNDED"),
        ("pending", "PENDING"),
        ("waiting", "PENDING"),
        ("depositing", "PENDING"),
        ("submitted", "PENDING"),
        ("delayed", "PENDING"),
        ("unknown", "PENDING"),
        ("something-new-relay-adds-later", "PENDING"),
    ],
)
@pytest.mark.asyncio
async def test_get_status_mapping(relay, raw_status, expected):
    p_session, p_limiter, session = _patch(
        _FakeResp(200, json_data={"status": raw_status, "txHashes": ["0xabc"]})
    )
    with p_session, p_limiter:
        status = await relay.get_status("0xrequest123")

    assert status.status == expected
    assert status.tx_hashes == ["0xabc"]
    method, url, _, _, _ = session.calls[-1]
    assert method == "GET"
    assert url.endswith("/intents/status/v3")


@pytest.mark.asyncio
async def test_get_status_429_raises(relay):
    p_session, p_limiter, _ = _patch(_FakeResp(429, json_data={}))
    with p_session, p_limiter:
        with pytest.raises(RelayError):
            await relay.get_status("0xrequest123")


# --- Chain id resolution -----------------------------------------------------------


def test_static_fallback_chain_ids(relay):
    assert relay.get_chain_id("base") == 8453
    assert relay.get_chain_id("solana") == 792703809
    assert relay.get_chain_id("not-a-real-chain") is None


def test_is_supported_route_cross_chain(relay):
    assert relay.is_supported_route("base", "arbitrum") is True
    assert relay.is_supported_route("base", "not-a-real-chain") is False
