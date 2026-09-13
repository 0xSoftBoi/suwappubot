"""Live OFAC SDN digital-currency address feed.

``ofac_list.py``'s bundled seed set (Tornado Cash et al.) and any
``COMPLIANCE_OFAC_LIST_PATH`` file are static — nothing pulls a live feed, so
the blocklist silently goes stale (see that module's docstring TODO). This
module closes that gap with the community-maintained daily extraction of the
OFAC SDN list's digital-currency addresses:

    https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses

One newline-delimited file per ticker at
``.../lists/sanctioned_addresses_<TICKER>.txt``. Verified live (200 OK) for
ETH, TRX, XBT (Bitcoin) and SOL — the address families
``AddressComplianceService`` can actually screen — on 2026-09-13.

OFF by default (``COMPLIANCE_SDN_FEED_ENABLED``); see
``docs/architecture/compliance-screening.md``.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Set

import httpx

from bot.config.settings import settings
from bot.services.compliance.ofac_list import _is_screenable_address, _normalize

logger = logging.getLogger(__name__)

# Tickers covering every address family the compliance service screens
# (EVM, TRON, Solana). Confirmed with a live curl (200 OK) against this feed
# on 2026-09-13; other tickers (e.g. BNB/BSC) 404 and are intentionally
# omitted rather than guessed at.
TICKERS: tuple[str, ...] = ("ETH", "TRX", "XBT", "SOL")

_FETCH_TIMEOUT_SECONDS = 5.0


def _parse_lines(text: str) -> Set[str]:
    """Parse address-per-line text (``#`` comments, blank lines skipped) into
    a normalized address set, mirroring ``ofac_list._parse_address_lines``.
    """
    out: Set[str] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        token = line.split(",")[0].split()
        if not token:
            continue
        candidate = token[0]
        if not _is_screenable_address(candidate):
            continue
        norm = _normalize(candidate)
        if norm:
            out.add(norm)
    return out


async def _fetch_ticker_text(base_url: str, ticker: str) -> Optional[str]:
    """Fetch raw list text for one ticker. Returns ``None`` on any error or
    non-200 response — the caller fails open by keeping the previous set.
    """
    url = base_url.format(ticker=ticker) if "{ticker}" in base_url else base_url
    try:
        async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT_SECONDS) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning("SDN feed %s: HTTP %s from %s", ticker, resp.status_code, url)
            return None
        return resp.text
    except Exception as exc:  # network/timeout/etc — fail open, never crash the loop
        logger.warning("SDN feed %s: fetch failed: %s", ticker, exc)
        return None


class SdnFeed:
    """Fetches the OFAC SDN digital-currency address lists and merges them
    into the live ``compliance_service`` blocklist.

    Fail-open per ticker: if a fetch fails, that ticker's previously-fetched
    set (if any) is kept rather than dropped, so a single flaky list never
    shrinks the merged blocklist.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sets: Dict[str, Set[str]] = {}
        self.last_refresh_at: Optional[datetime] = None
        self.last_count: int = 0
        self.last_error: Optional[str] = None

    @property
    def base_url(self) -> str:
        return getattr(settings, "compliance_sdn_feed_base_url", "") or (
            "https://raw.githubusercontent.com/0xB10C/"
            "ofac-sanctioned-digital-currency-addresses/lists/"
            "sanctioned_addresses_{ticker}.txt"
        )

    async def refresh(self) -> int:
        """Fetch every ticker's list and merge into the live blocklist.

        Returns the total number of unique addresses currently held across
        all tickers (not just newly-added ones).
        """
        base_url = self.base_url
        failed: list[str] = []
        for ticker in TICKERS:
            text = await _fetch_ticker_text(base_url, ticker)
            if text is None:
                failed.append(ticker)
                continue  # fail-open: keep whatever we had for this ticker
            parsed = _parse_lines(text)
            with self._lock:
                self._sets[ticker] = parsed

        with self._lock:
            merged: Set[str] = set()
            for addrs in self._sets.values():
                merged |= addrs
            count = len(merged)

        from bot.services.compliance.compliance_service import compliance_service

        compliance_service.extend_blocklist(merged)

        self.last_refresh_at = datetime.now(timezone.utc)
        self.last_count = count
        self.last_error = "fetch failed for: " + ", ".join(failed) if failed else None
        if failed:
            logger.warning(
                "SDN feed refresh: %d/%d list(s) failed (%s); merged %d address(es) "
                "from cached/successful lists",
                len(failed),
                len(TICKERS),
                ", ".join(failed),
                count,
            )
        else:
            logger.info(
                "SDN feed refresh: merged %d sanctioned address(es) from %d list(s)",
                count,
                len(TICKERS),
            )
        return count

    def stats(self) -> dict:
        return {
            "tickers": list(TICKERS),
            "last_refresh_at": (self.last_refresh_at.isoformat() if self.last_refresh_at else None),
            "last_count": self.last_count,
            "last_error": self.last_error,
        }


# Global instance — mirrors the other compliance singletons.
sdn_feed = SdnFeed()


async def run_sdn_feed_loop() -> None:
    """Background loop: refresh immediately, then every
    ``compliance_sdn_feed_interval_hours``. No-op unless
    ``compliance_sdn_feed_enabled``. Must never raise out of the loop — any
    unexpected error is logged and the loop keeps going on its normal cadence
    (``refresh()`` itself already fails open per-ticker).
    """
    if not getattr(settings, "compliance_sdn_feed_enabled", False):
        return

    while True:
        started = time.monotonic()
        try:
            await sdn_feed.refresh()
        except Exception as exc:  # pragma: no cover - defensive; refresh() fails open internally
            logger.error("SDN feed loop: unexpected error: %s", exc)

        try:
            interval_hours = max(
                1, int(getattr(settings, "compliance_sdn_feed_interval_hours", 24))
            )
        except (TypeError, ValueError):
            interval_hours = 24

        # Guard against a pathologically slow refresh eating into the sleep.
        elapsed = time.monotonic() - started
        await asyncio.sleep(max(1.0, interval_hours * 3600 - elapsed))
