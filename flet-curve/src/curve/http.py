"""Fetching JSON, on whatever platform this app happens to be running on."""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any
from urllib.parse import urlencode

#: Curve's edge returns 403 to the default `Python-urllib/x.y` agent.
USER_AGENT = "flet-curve/0.1"

#: Cloudflare serves these with `s-maxage=300`; polling faster just returns
#: the same cached bytes.
DEFAULT_TIMEOUT = 30.0


class ApiError(Exception):
    """A request failed, or the API answered with something unusable.

    `status` is the HTTP code where there was one, and None where the request
    never got an answer at all.  The two are different questions: a 404 says
    the thing is not there and asking again will not help, where a dropped
    connection says nothing about whether it exists.
    """

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def is_browser() -> bool:
    return sys.platform == "emscripten"


def build_url(base: str, path: str, params: dict[str, Any] | None = None) -> str:
    url = f"{base.rstrip('/')}/{path.lstrip('/')}"
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url = f"{url}?{urlencode(clean, doseq=True)}"
    return url


async def get_json(url: str, timeout: float = DEFAULT_TIMEOUT) -> Any:
    """GET a URL and parse the response as JSON. Raises `ApiError`."""
    if is_browser():
        return await _get_json_browser(url, timeout)
    return await _get_json_desktop(url, timeout)


async def post_json(url: str, payload: Any, timeout: float = DEFAULT_TIMEOUT) -> Any:
    """POST JSON and parse the answer. Raises `ApiError`."""
    body = json.dumps(payload)
    if is_browser():
        return await _post_json_browser(url, body, timeout)
    return await asyncio.to_thread(_post_blocking, url, body, timeout)


async def _post_json_browser(url: str, body: str, timeout: float) -> Any:
    from pyodide.http import pyfetch

    try:
        response = await asyncio.wait_for(
            pyfetch(
                url,
                method="POST",
                body=body,
                headers={"Content-Type": "application/json"},
            ),
            timeout,
        )
    except TimeoutError:
        raise ApiError(f"Timed out after {timeout:.0f}s: {url}") from None
    except Exception as exc:
        raise ApiError(f"Network error: {exc}") from exc

    if response.status >= 400:
        raise ApiError(f"HTTP {response.status} from {url}",
                       status=response.status)
    try:
        return await response.json()
    except Exception as exc:
        raise ApiError(f"Response was not valid JSON: {url}") from exc


def _post_blocking(url: str, body: str, timeout: float) -> Any:
    import urllib.error
    import urllib.request

    request = urllib.request.Request(
        url,
        data=body.encode(),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        raise ApiError(f"HTTP {exc.code} from {url}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"Could not reach {url}: {exc.reason}") from exc
    except TimeoutError:
        raise ApiError(f"Timed out after {timeout:.0f}s: {url}") from None
    try:
        return json.loads(payload)
    except ValueError as exc:
        raise ApiError(f"Response was not valid JSON: {url}") from exc


async def get_bytes(url: str, timeout: float = DEFAULT_TIMEOUT) -> bytes:
    """Raw bytes at a URL. For files that are not JSON and not images."""
    if is_browser():
        try:
            return await asyncio.wait_for(_browser_bytes(url), timeout)
        except TimeoutError:
            raise ApiError(f"Timed out after {timeout:.0f}s: {url}") from None
    return await asyncio.to_thread(_read_blocking, url, timeout)


async def _browser_bytes(url: str) -> bytes:
    """The fetch itself. Separated so the deadline above can be tested.

    It needs one: a stalled connection here used to block the pool list
    indefinitely, because `CurveApp._load_marks` fetches the mark bundles
    through this and `load_pools` awaits it before the first page of rows.
    A gateway that answers 504 raises; one that accepts and never replies
    did not.
    """
    from js import fetch as js_fetch

    response = await js_fetch(url)
    if not response.ok:
        raise ApiError(f"HTTP {response.status} from {url}",
                       status=response.status)
    buffer = await response.arrayBuffer()
    return bytes(buffer.to_py())


def _read_blocking(url: str, timeout: float) -> bytes:
    import urllib.error
    import urllib.request

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except (urllib.error.HTTPError, urllib.error.URLError, OSError) as exc:
        raise ApiError(f"could not read {url}: {exc}") from exc


async def _get_json_browser(url: str, timeout: float) -> Any:
    from pyodide.http import pyfetch

    try:
        response = await asyncio.wait_for(pyfetch(url), timeout)
    except TimeoutError:
        raise ApiError(f"Timed out after {timeout:.0f}s: {url}") from None
    except Exception as exc:  # pyfetch raises bare JsException on network fail
        raise ApiError(f"Network error: {exc}") from exc

    if response.status >= 400:
        raise ApiError(f"HTTP {response.status} from {url}",
                       status=response.status)
    try:
        return await response.json()
    except Exception as exc:
        raise ApiError(f"Response was not valid JSON: {url}") from exc


async def _get_json_desktop(url: str, timeout: float) -> Any:
    # urllib blocks, so it goes to a worker thread; otherwise a slow API
    # call would freeze the whole UI, which on desktop is the same event
    # loop.
    return await asyncio.to_thread(_fetch_blocking, url, timeout)


def _fetch_blocking(url: str, timeout: float) -> Any:
    import urllib.error
    import urllib.request

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        raise ApiError(f"HTTP {exc.code} from {url}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"Could not reach {url}: {exc.reason}") from exc
    except TimeoutError:
        raise ApiError(f"Timed out after {timeout:.0f}s: {url}") from None

    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ApiError(f"Response was not valid JSON: {url}") from exc
