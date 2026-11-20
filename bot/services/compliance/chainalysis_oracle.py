"""Chainalysis on-chain Sanctions Oracle client — free, keyless, unmetered.

Chainalysis publishes a public ``SanctionsList`` contract that answers
``isSanctioned(address) -> bool`` against the OFAC SDN designations it
tracks. Reading it is an ``eth_call``: no API key, no signup, no daily
budget, no contractual terms on caching — unlike every commercial
screening API. We already hold RPC endpoints for these chains, so each
lookup is free.

**Verified on-chain 2026-11-20** (``eth_getCode`` + a live-SDN probe
address) at the single deterministic address below:

    ethereum · polygon · bsc · avalanche · optimism · arbitrum

``base`` has **no** deployment (``eth_getCode`` returned empty) and is
deliberately absent from ``ORACLE_CHAINS``; calling it there would hit an
EOA and decode ``0x`` as "clean", which is exactly the false-negative this
module must never produce.

Calibration measured the same day, against the live OFAC SDN ETH list
(123 addresses) published by the ``ofac-sanctioned-digital-currency-
addresses`` extractor:

* 16 of a 25-address live-SDN sample returned ``True`` — the oracle is
  real and current, not an empty stub.
* All 15 addresses in our bundled ``ofac_list`` seed returned ``False``,
  and **none** of them appear on the live SDN list any more (the Tornado
  Cash delisting). See that module's header: the seed is history, not a
  blocklist.

Fail-open throughout: any RPC error, timeout, unsupported chain, or
short/empty return value yields ``None`` — "unknown", never "clean".
Callers treat ``None`` as no verdict, so a *dead* RPC cannot silently
un-block a sanctioned recipient or block a legitimate one. That guarantee
does NOT extend to a *wrong, compromised or forked* RPC: one that answers
successfully with ``0x00..00`` is indistinguishable from "clean" and will
un-block a sanctioned recipient. The oracle is only as trustworthy as the
RPC endpoint serving it; the local blocklist remains the independent layer.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Dict, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# Same deterministic address on every chain where Chainalysis deployed it.
ORACLE_ADDRESS = "0x40C57923924B5c5c5455c48D93317139ADDaC8fb"

# keccak256("isSanctioned(address)")[:4]
IS_SANCTIONED_SELECTOR = "0xdf592f7d"

# Chains with a verified deployment. NOT a guess: each was confirmed with
# eth_getCode plus a positive probe on 2026-11-20. Adding a chain here
# without that check risks decoding an empty return as "clean".
ORACLE_CHAINS = frozenset({"ethereum", "polygon", "bsc", "avalanche", "optimism", "arbitrum"})

_CACHE_TTL_SECONDS = 24 * 3600
_REQUEST_TIMEOUT_SECONDS = 3.0


def _short(addr: str) -> str:
    return addr if len(addr) <= 12 else f"{addr[:6]}…{addr[-4:]}"


class ChainalysisSanctionsOracle:
    """Reads the public Chainalysis sanctions oracle over plain ``eth_call``.

    Addresses must arrive already normalized by the caller (the canonical
    form ``AddressComplianceService`` uses). Only EVM ``0x`` addresses are
    answerable; anything else returns ``None``.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # (chain, addr) -> (expires_at, isSanctioned)
        self._cache: Dict[Tuple[str, str], Tuple[float, bool]] = {}
        self._last_error: Optional[str] = None
        self._calls = 0
        self._hits = 0

    # --- helpers ---------------------------------------------------------

    @staticmethod
    def supports(chain: Optional[str]) -> bool:
        return bool(chain) and chain.strip().lower() in ORACLE_CHAINS

    @staticmethod
    def _calldata(address: str) -> str:
        """ABI-encode ``isSanctioned(address)``: selector + 32-byte word."""
        return IS_SANCTIONED_SELECTOR + address[2:].lower().rjust(64, "0")

    def _rpc_url(self, chain: str) -> Optional[str]:
        """Best endpoint from the existing pool. Never raises."""
        try:
            from bot.services.rpc_manager import rpc_manager

            return rpc_manager.get_rpc_url(chain)
        except Exception as exc:  # no endpoint, all circuits open, import issue
            logger.debug("Chainalysis oracle: no RPC for %s: %s", chain, exc)
            self._last_error = f"no_rpc:{chain}"
            return None

    # --- lookup ----------------------------------------------------------

    async def is_sanctioned(self, address: Optional[str], chain: Optional[str]) -> Optional[bool]:
        """``True``/``False`` from the oracle, or ``None`` when unknown.

        ``None`` covers: non-EVM or empty address, chain without a verified
        deployment, no healthy RPC, timeout, RPC error, and any response
        that does not decode to a full 32-byte word.
        """
        addr = (address or "").strip()
        chain_name = (chain or "").strip().lower()
        if not addr.startswith("0x") or len(addr) != 42:
            return None
        if not self.supports(chain_name):
            return None

        key = (chain_name, addr.lower())
        now = time.time()
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                expires_at, value = cached
                if now < expires_at:
                    return value
                del self._cache[key]

        rpc_url = self._rpc_url(chain_name)
        if not rpc_url:
            return None

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [
                {"to": ORACLE_ADDRESS, "data": self._calldata(addr)},
                "latest",
            ],
        }

        async def _do_call():
            async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.post(rpc_url, json=payload)
                resp.raise_for_status()
                return resp.json()

        try:
            # httpx timeouts are per-operation; enforce a TOTAL deadline so a
            # slow-loris RPC cannot hang the swap path.
            data = await asyncio.wait_for(_do_call(), timeout=_REQUEST_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            logger.warning(
                "Chainalysis oracle lookup timed out for %s on %s", _short(addr), chain_name
            )
            self._last_error = "timeout"
            return None
        except Exception as exc:  # network/timeout/HTTP — fail open
            logger.warning(
                "Chainalysis oracle lookup failed for %s on %s: %s",
                _short(addr),
                chain_name,
                exc,
            )
            self._last_error = str(exc)
            return None

        if not isinstance(data, dict) or data.get("error"):
            logger.warning(
                "Chainalysis oracle RPC error for %s on %s: %s",
                _short(addr),
                chain_name,
                (data or {}).get("error") if isinstance(data, dict) else data,
            )
            self._last_error = "rpc_error"
            return None

        result = data.get("result")
        # A bare "0x" means the call hit no contract (wrong chain / not
        # deployed). Decoding that as False would be a false negative on a
        # money path, so it is explicitly "unknown".
        if not isinstance(result, str) or len(result) < 66:
            logger.warning(
                "Chainalysis oracle: short/empty result for %s on %s (%r)",
                _short(addr),
                chain_name,
                result,
            )
            self._last_error = "empty_result"
            return None

        # isSanctioned returns exactly one 32-byte word. Anything that is not
        # a whole number of words is malformed -> unknown, never clean.
        word = result[2:] if result.startswith("0x") else ""
        if not word or len(word) % 64:
            self._last_error = "bad_result"
            return None
        try:
            if len(word) == 64:
                # Any non-zero bool word (incl. non-canonical 0x..02) is sanctioned.
                sanctioned = int(word, 16) != 0
            elif int(word, 16) != 0:
                # Multi-word return is not a valid oracle answer, but a
                # non-zero word anywhere must never be read as clean.
                sanctioned = True
            else:
                self._last_error = "bad_result"
                return None
        except ValueError:
            self._last_error = "bad_result"
            return None

        with self._lock:
            self._cache[key] = (time.time() + _CACHE_TTL_SECONDS, sanctioned)
            self._calls += 1
            if sanctioned:
                self._hits += 1
        self._last_error = None
        return sanctioned

    # --- introspection ---------------------------------------------------

    def stats(self) -> dict:
        with self._lock:
            return {
                "oracle_address": ORACLE_ADDRESS,
                "chains": sorted(ORACLE_CHAINS),
                "cache_size": len(self._cache),
                "lookups": self._calls,
                "sanctioned_hits": self._hits,
                "last_error": self._last_error,
            }


# Global instance — mirrors the other compliance singletons.
chainalysis_oracle = ChainalysisSanctionsOracle()
