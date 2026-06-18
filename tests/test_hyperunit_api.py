"""Tests for the HyperUnit native-deposit client — session-mocked, no network."""

from unittest.mock import AsyncMock, patch

import pytest

from bot.services.hyperunit_api import (
    HyperUnitAPI,
    HyperUnitError,
    get_minimum,
    normalize_asset,
)

HL_ADDR = "0x1111111111111111111111111111111111111111"


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
    def __init__(self, resp):
        self._resp = resp
        self.urls = []
        self.kwargs = []

    def get(self, url, **kwargs):
        self.urls.append(url)
        self.kwargs.append(kwargs)
        return self._resp


def _patch(resp):
    """Patch get_session + rate limiter for the hyperunit module."""
    session = _FakeSession(resp)
    return (
        patch("bot.services.hyperunit_api.get_session", AsyncMock(return_value=session)),
        patch(
            "bot.services.hyperunit_api.api_limiter.wait_and_acquire",
            AsyncMock(return_value=None),
        ),
        session,
    )


# --------------------------- pure helpers ---------------------------------- #
def test_normalize_asset_aliases():
    assert normalize_asset("BTC") == "btc"
    assert normalize_asset("bitcoin") == "btc"
    assert normalize_asset("Ethereum") == "eth"
    assert normalize_asset("weth") == "eth"
    assert normalize_asset("solana") == "sol"


def test_normalize_asset_rejects_unknown():
    with pytest.raises(HyperUnitError):
        normalize_asset("doge")


def test_get_minimum():
    assert get_minimum("btc") == 0.002
    assert get_minimum("eth") == 0.05
    assert get_minimum("sol") == 0.1


# --------------------------- non-US egress hook ---------------------------- #
def test_egress_base_url_override():
    from types import SimpleNamespace
    import bot.services.hyperunit_api as hu

    with patch.object(
        hu, "settings", SimpleNamespace(hyperunit_egress_url="https://eu-proxy.example.com/")
    ):
        api = hu.HyperUnitAPI()
        assert api.api_url == "https://eu-proxy.example.com"


@pytest.mark.asyncio
async def test_proxy_forwarded_on_requests():
    resp = _FakeResp(
        200,
        {"address": "bc1q", "signatures": {"a": "1", "b": "2"}, "status": "OK"},
    )
    p_sess, p_lim, session = _patch(resp)
    with p_sess, p_lim, patch("bot.services.hyperunit_api._egress_proxy", lambda: "http://eu:3128"):
        api = HyperUnitAPI()
        await api.generate_deposit_address("btc", HL_ADDR)
    assert session.kwargs[0].get("proxy") == "http://eu:3128"


# --------------------------- generate address ------------------------------ #
@pytest.mark.asyncio
async def test_generate_deposit_address_happy_path():
    resp = _FakeResp(
        200,
        {
            "address": "bc1qexampledepositaddressxxxxxxxxxxxxxxxxx",
            "signatures": {"field-node": "a", "hl-node": "b", "node-1": "c"},
            "status": "OK",
        },
    )
    p_sess, p_lim, session = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        out = await api.generate_deposit_address("btc", HL_ADDR)

    assert out.address.startswith("bc1q")
    assert out.asset == "btc"
    assert out.src_chain == "bitcoin"
    assert out.hl_address == HL_ADDR
    assert out.min_amount == 0.002
    assert out.signatures == {"field-node": "a", "hl-node": "b", "node-1": "c"}
    # Path is built as /gen/<src>/hyperliquid/<asset>/<hl_addr>
    assert session.urls[0].endswith(f"/gen/bitcoin/hyperliquid/btc/{HL_ADDR}")


@pytest.mark.asyncio
async def test_generate_rejects_bad_hl_address():
    resp = _FakeResp(200, {})
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        with pytest.raises(HyperUnitError):
            await api.generate_deposit_address("btc", "not-an-evm-address")


@pytest.mark.asyncio
async def test_generate_raises_on_missing_address():
    resp = _FakeResp(200, {"status": "OK", "signatures": {"hl-node": "x"}})
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        with pytest.raises(HyperUnitError):
            await api.generate_deposit_address("eth", HL_ADDR)


@pytest.mark.asyncio
async def test_generate_rejects_below_guardian_threshold():
    # Only 1 of 3 guardian signatures -> not jointly attested -> refuse.
    resp = _FakeResp(200, {"address": "0xabc", "status": "OK", "signatures": {"hl-node": "x"}})
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        with pytest.raises(HyperUnitError, match="guardian"):
            await api.generate_deposit_address("eth", HL_ADDR)


@pytest.mark.asyncio
async def test_generate_accepts_two_of_three_guardian_sigs():
    resp = _FakeResp(
        200,
        {"address": "0xabc", "status": "OK", "signatures": {"hl-node": "x", "node-1": "y"}},
    )
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        out = await api.generate_deposit_address("eth", HL_ADDR)
    assert out.address == "0xabc"
    assert len(out.signatures) == 2


@pytest.mark.asyncio
async def test_generate_raises_on_missing_signatures():
    resp = _FakeResp(200, {"address": "0xabc", "status": "OK"})
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        with pytest.raises(HyperUnitError):
            await api.generate_deposit_address("eth", HL_ADDR)


@pytest.mark.asyncio
async def test_generate_raises_on_non_ok_status():
    resp = _FakeResp(200, {"address": "0xabc", "signatures": {"a": "b"}, "status": "REJECTED"})
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        with pytest.raises(HyperUnitError):
            await api.generate_deposit_address("eth", HL_ADDR)


@pytest.mark.asyncio
async def test_generate_raises_on_http_error():
    resp = _FakeResp(500, None, "upstream boom")
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        with pytest.raises(HyperUnitError):
            await api.generate_deposit_address("sol", HL_ADDR)


# --------------------------- operations poll ------------------------------- #
@pytest.mark.asyncio
async def test_get_operation_done():
    resp = _FakeResp(200, {"state": "done", "destinationTxHash": "0xdeadbeef"})
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        op = await api.get_operation("bc1qaddr")
    assert op.is_done
    assert op.destination_tx_hash == "0xdeadbeef"


@pytest.mark.asyncio
async def test_get_operation_pending_on_404():
    resp = _FakeResp(404)
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        op = await api.get_operation("bc1qaddr")
    assert not op.is_done
    assert op.state == "pending"


@pytest.mark.asyncio
async def test_get_operation_list_shape_takes_latest():
    resp = _FakeResp(
        200,
        {"operations": [{"state": "pending"}, {"state": "done", "destinationTxHash": "0xfeed"}]},
    )
    p_sess, p_lim, _ = _patch(resp)
    with p_sess, p_lim:
        api = HyperUnitAPI()
        op = await api.get_operation("bc1qaddr")
    assert op.is_done
    assert op.destination_tx_hash == "0xfeed"
