"""Shared HTTP client with connection pooling for faster API calls."""

import aiohttp
import logging
from typing import Optional, Callable, TypeVar, Any
import asyncio

logger = logging.getLogger(__name__)
T = TypeVar("T")

try:
    import orjson

    def _json_serialize(obj):
        return orjson.dumps(obj).decode()

    def _json_deserialize(s):
        return orjson.loads(s)

    HAS_ORJSON = True
except ImportError:
    import json

    _json_serialize = json.dumps
    _json_deserialize = json.loads
    HAS_ORJSON = False

# Global session for connection reuse
_session: Optional[aiohttp.ClientSession] = None
_lock = asyncio.Lock()


# aiohttp's default UA ("Python/3.x aiohttp/x") is blocked outright by the
# Cloudflare fronts on several quote providers: production logged a 403 HTML
# error page from api.cow.fi on every single quote, so CoW never contributed a
# route. The OKX client already sends a browser UA for the same reason; make it
# the session default so every provider behind a WAF gets the same treatment.
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 Suwappu/1.0"
)


async def get_session() -> aiohttp.ClientSession:
    """Get or create a shared aiohttp session with connection pooling."""
    global _session

    if _session is None or _session.closed:
        async with _lock:
            if _session is None or _session.closed:
                # Configure aggressive connection pool
                connector = aiohttp.TCPConnector(
                    limit=200,  # Max connections (increased)
                    limit_per_host=50,  # Max per host (increased)
                    ttl_dns_cache=600,  # DNS cache for 10 min
                    keepalive_timeout=120,  # Keep connections alive longer
                    enable_cleanup_closed=True,
                    force_close=False,  # Reuse connections
                    use_dns_cache=True,
                )

                timeout = aiohttp.ClientTimeout(
                    total=20,  # Reduced total timeout
                    connect=3,  # Faster connection timeout
                    sock_read=15,  # Faster read timeout
                )

                _session = aiohttp.ClientSession(
                    connector=connector,
                    timeout=timeout,
                    raise_for_status=False,
                    json_serialize=_json_serialize if HAS_ORJSON else None,
                    headers={"User-Agent": DEFAULT_USER_AGENT},
                )

    return _session


async def close_session():
    """Close the shared session (call on shutdown)."""
    global _session
    if _session and not _session.closed:
        await _session.close()
        _session = None


async def fetch_json(url: str, **kwargs) -> dict:
    """Fetch JSON from URL using shared session."""
    session = await get_session()
    async with session.get(url, **kwargs) as response:
        return await response.json()


async def post_json(url: str, json_data: dict = None, **kwargs) -> dict:
    """POST JSON to URL using shared session."""
    session = await get_session()
    async with session.post(url, json=json_data, **kwargs) as response:
        return await response.json()


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

# HTTP status codes that are transient and worth retrying.
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


async def with_retry(
    fn: Callable[[], Any],
    *,
    max_attempts: int = 3,
    base_delay: float = 1.0,
    label: str = "request",
) -> Any:
    """Retry ``fn`` with exponential backoff on transient errors.

    Retries on ``ConnectionError``, ``asyncio.TimeoutError``, and HTTP
    responses whose status codes are in ``_RETRYABLE_STATUSES``.  Raises
    immediately on any other exception (e.g. 4xx validation errors).

    Usage::

        async def _do():
            async with session.post(url, json=body) as r:
                if r.status not in (200, 201):
                    raise aiohttp.ClientResponseError(
                        r.request_info, r.history, status=r.status
                    )
                return await r.json()

        data = await with_retry(_do, label="CoW quote")
    """
    last_exc: Exception = RuntimeError("no attempts made")
    for attempt in range(1, max_attempts + 1):
        try:
            return await fn()
        except aiohttp.ClientResponseError as exc:
            if exc.status not in _RETRYABLE_STATUSES or attempt == max_attempts:
                raise
            last_exc = exc
        except (ConnectionError, asyncio.TimeoutError, aiohttp.ClientConnectionError) as exc:
            if attempt == max_attempts:
                raise
            last_exc = exc

        delay = base_delay * (2 ** (attempt - 1))
        logger.warning(
            "%s failed (attempt %d/%d), retrying in %.1fs: %s",
            label,
            attempt,
            max_attempts,
            delay,
            last_exc,
        )
        await asyncio.sleep(delay)
    raise last_exc
