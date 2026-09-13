"""TRM Labs free public Sanctions Screening API client.

Live-verified endpoint: ``POST https://api.trmlabs.com/public/v1/sanctions/
screening`` with body ``[{"address": "<addr>"}]`` — **no** ``chain`` field
(the API rejects one) and no auth header. A successful screen returns HTTP
201 with ``[{"address": ..., "isSanctioned": bool, ...}]``. A 19-address
batch returned HTTP 413, so this client sends exactly one address per
request. Published limits: 1 req/s, 100 req/day — enforced here with a
rolling daily budget (default 90, leaving headroom) that resets at UTC
midnight, plus a 24h in-memory TTL cache so repeat lookups of the same
address don't burn budget at all.

Fully async (``httpx.AsyncClient``) so it is safe to call from
``AddressComplianceService.screen_recipient_remote`` inside the bot's async
call chain — see that method for why the sync ``screen()``/``screen_address``
path is never used for this.

Fail-open throughout: any error, timeout, HTTP 429, or exhausted budget
returns ``None`` (not "clean", not "sanctioned" — genuinely unknown). The
caller decides what to do with ``None`` (today: treat it like "no verdict",
same as the local list already ran).
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

import httpx

from bot.config.settings import settings

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.trmlabs.com/public/v1/sanctions/screening"
_CACHE_TTL_SECONDS = 24 * 3600
_REQUEST_TIMEOUT_SECONDS = 3.0


def _short(addr: str) -> str:
    if len(addr) <= 12:
        return addr
    return f"{addr[:6]}…{addr[-4:]}"


class TrmSanctionsClient:
    """Async client for TRM Labs' free public Sanctions Screening API.

    Callers must pass an already-normalized address (the same canonical form
    ``AddressComplianceService`` uses internally) — this client does not
    re-normalize, since TRON/Solana base58 is case-sensitive and re-casing it
    would silently change which address is queried.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cache: Dict[str, Tuple[float, bool]] = {}  # addr -> (expires_at, isSanctioned)
        self._budget_date: Optional[str] = None
        self._budget_used: int = 0
        self._last_error: Optional[str] = None

    # --- configuration ---------------------------------------------------

    @property
    def base_url(self) -> str:
        return getattr(settings, "compliance_trm_base_url", "") or DEFAULT_BASE_URL

    @property
    def daily_budget(self) -> int:
        try:
            return max(0, int(getattr(settings, "compliance_trm_daily_budget", 90)))
        except (TypeError, ValueError):
            return 90

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # --- lookup ------------------------------------------------------------

    async def is_sanctioned(self, address: Optional[str]) -> Optional[bool]:
        """Return ``True``/``False`` from TRM, or ``None`` if unknown
        (disabled, invalid input, cache miss + budget exhausted, timeout,
        429, or any other error).
        """
        if not getattr(settings, "compliance_trm_enabled", False):
            return None
        addr = (address or "").strip()
        if not addr:
            return None

        now = time.time()
        with self._lock:
            cached = self._cache.get(addr)
            if cached is not None:
                expires_at, value = cached
                if now < expires_at:
                    return value
                del self._cache[addr]  # expired

            today = self._today()
            if self._budget_date != today:
                self._budget_date = today
                self._budget_used = 0
            if self._budget_used >= self.daily_budget:
                logger.warning(
                    "TRM sanctions screening: daily budget (%d) exhausted, skipping %s",
                    self.daily_budget,
                    _short(addr),
                )
                self._last_error = "budget_exhausted"
                return None
            self._budget_used += 1

        try:
            async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.post(self.base_url, json=[{"address": addr}])
        except Exception as exc:  # network/timeout — fail open
            logger.warning("TRM sanctions screening failed for %s: %s", _short(addr), exc)
            self._last_error = str(exc)
            return None

        if resp.status_code == 429:
            logger.warning("TRM sanctions screening: rate limited (429) for %s", _short(addr))
            self._last_error = "rate_limited"
            return None
        if resp.status_code != 201:
            logger.warning(
                "TRM sanctions screening: HTTP %s for %s", resp.status_code, _short(addr)
            )
            self._last_error = f"http_{resp.status_code}"
            return None

        try:
            data = resp.json()
        except Exception as exc:
            logger.warning("TRM sanctions screening: bad JSON for %s: %s", _short(addr), exc)
            self._last_error = "bad_response"
            return None

        if not isinstance(data, list) or not data or not isinstance(data[0], dict):
            logger.warning(
                "TRM sanctions screening: unexpected response shape for %s", _short(addr)
            )
            self._last_error = "bad_response"
            return None

        result = bool(data[0].get("isSanctioned"))
        with self._lock:
            self._cache[addr] = (time.time() + _CACHE_TTL_SECONDS, result)
        self._last_error = None
        return result

    # --- introspection -------------------------------------------------

    def stats(self) -> dict:
        with self._lock:
            return {
                "enabled": bool(getattr(settings, "compliance_trm_enabled", False)),
                "daily_budget": self.daily_budget,
                "budget_used": self._budget_used,
                "budget_date": self._budget_date,
                "cache_size": len(self._cache),
                "last_error": self._last_error,
            }


# Global instance — mirrors the other compliance singletons.
trm_sanctions_client = TrmSanctionsClient()
