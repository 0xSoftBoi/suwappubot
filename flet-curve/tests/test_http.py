"""What the two HTTP halves put on the wire."""

from __future__ import annotations

import json
import sys
import types

import pytest

from curve import http

# -- the browser half ------------------------------------------------------


class FakeResponse:
    def __init__(self, payload: object, status: int = 200) -> None:
        self.payload = payload
        self.status = status

    async def json(self) -> object:
        return self.payload


@pytest.fixture
def pyfetch(monkeypatch):
    """Stand in for `pyodide.http.pyfetch` and record every call."""
    seen: list[dict] = []

    async def fake_pyfetch(url, **kwargs):
        seen.append({"url": url, **kwargs})
        return FakeResponse({"ok": True})

    module = types.ModuleType("pyodide.http")
    module.pyfetch = fake_pyfetch  # type: ignore[attr-defined]
    package = types.ModuleType("pyodide")
    package.http = module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "pyodide", package)
    monkeypatch.setitem(sys.modules, "pyodide.http", module)
    monkeypatch.setattr(http, "is_browser", lambda: True)
    return seen


async def test_a_browser_get_sends_no_headers_at_all(pyfetch) -> None:
    assert await http.get_json("https://chainlist.org/rpcs.json") == {"ok": True}
    assert pyfetch[0]["url"] == "https://chainlist.org/rpcs.json"
    assert "headers" not in pyfetch[0] or not pyfetch[0]["headers"]


async def test_a_browser_post_sends_content_type_and_nothing_else(pyfetch) -> None:
    await http.post_json("https://eth.example", {"method": "eth_call"})
    headers = pyfetch[0]["headers"]
    assert headers == {"Content-Type": "application/json"}


@pytest.mark.parametrize(
    "call",
    [
        lambda: http.get_json("https://chainlist.org/rpcs.json"),
        lambda: http.post_json("https://eth.example", {"method": "eth_call"}),
    ],
)
async def test_the_browser_never_names_a_user_agent(pyfetch, call) -> None:
    await call()
    headers = {k.lower() for k in (pyfetch[0].get("headers") or {})}
    assert "user-agent" not in headers


async def test_a_browser_post_still_sends_the_body(pyfetch) -> None:
    await http.post_json("https://eth.example", {"method": "eth_chainId", "id": 7})
    assert json.loads(pyfetch[0]["body"]) == {"method": "eth_chainId", "id": 7}
    assert pyfetch[0]["method"] == "POST"


async def test_a_browser_http_error_is_an_api_error(pyfetch, monkeypatch) -> None:
    async def failing(url, **kwargs):
        return FakeResponse(None, status=503)

    sys.modules["pyodide.http"].pyfetch = failing  # type: ignore[attr-defined]
    with pytest.raises(http.ApiError, match="HTTP 503"):
        await http.get_json("https://chainlist.org/rpcs.json")


async def test_a_stalled_bundle_fetch_gives_up_instead_of_hanging(monkeypatch) -> None:
    """It used to have no deadline at all, and `load_pools` awaits this
    before drawing the first page of rows -- so a connection that was
    accepted and never answered meant no pools, ever. A gateway that 504s
    raises; one that goes quiet did not."""
    import asyncio

    async def never(url):
        await asyncio.Event().wait()

    monkeypatch.setattr(http, "is_browser", lambda: True)
    monkeypatch.setattr(http, "_browser_bytes", never)

    with pytest.raises(http.ApiError, match="Timed out"):
        await http.get_bytes("https://curve.eth.limo/curve/chains/marks@80.bin", timeout=0.01)


async def test_bytes_that_arrive_are_handed_back(monkeypatch) -> None:
    async def quick(url):
        return b"\x89PNG"

    monkeypatch.setattr(http, "is_browser", lambda: True)
    monkeypatch.setattr(http, "_browser_bytes", quick)

    assert await http.get_bytes("https://x/marks@80.bin") == b"\x89PNG"


# -- the desktop half ------------------------------------------------------


class FakeUrlopen:
    """Records the `Request` it was handed and answers with JSON."""

    def __init__(self) -> None:
        self.requests: list[object] = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return b'{"ok": true}'


@pytest.fixture
def urlopen(monkeypatch):
    import urllib.request

    fake = FakeUrlopen()
    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr(http, "is_browser", lambda: False)
    return fake


async def test_the_desktop_half_still_names_itself(urlopen) -> None:
    await http.get_json("https://api.curve.finance/api/getPools/all/ethereum")
    assert urlopen.requests[0].get_header("User-agent") == http.USER_AGENT


async def test_the_desktop_post_names_itself_too(urlopen) -> None:
    await http.post_json("https://eth.example", {"method": "eth_call"})
    request = urlopen.requests[0]
    assert request.get_header("User-agent") == http.USER_AGENT
    assert request.get_header("Content-type") == "application/json"
