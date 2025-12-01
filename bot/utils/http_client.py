"""Shared HTTP client with connection pooling for faster API calls."""

import aiohttp
from typing import Optional
import asyncio

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

