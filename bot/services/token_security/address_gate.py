"""Blacklist + compliance screening gate for pasted/entered token addresses.

Shared by every surface that shows a Buy CTA or arms a buy directly from a
raw address (paste-to-trade / ``/check``, ``/snipe`` contract entry) plus the
purely informational ``/intel`` report. Two independent, complementary
checks, each with its own failure policy:

  * ``blacklist_service.check`` — local in-memory scam-address list, fast.
    Fail policy: **fail-open**. This store is local and has no external
    dependency, so an error here is a bug, not a real risk signal; log it and
    continue rather than blocking unrelated address entry on an internal
    fault.

  * ``compliance_service.assert_compliant`` — OFAC/operator sanctions
    screening, the exact gate ``SwapEngine.execute_swap`` runs before signing
    (see ``bot/services/swap_engine.py`` around the ``compliance_service``
    call). Fail policy: **mirrors the swap flow exactly** — the swap flow
    has no local try/except around the compliance call, so only the
    deliberate block signal (``ComplianceError``) is handled here; any other
    exception is not swallowed and propagates to the caller, same as it
    would propagate out of ``execute_swap`` to its own outer handler.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from bot.services.compliance import ComplianceError, compliance_service
from bot.services.token_security.blacklist_service import BlacklistType, blacklist_service

logger = logging.getLogger(__name__)


@dataclass
class AddressGateResult:
    """Outcome of :func:`check_address_gate` for a single address."""

    blocked: bool
    reason: str = ""


async def check_address_gate(address: str, chain: Optional[str] = None) -> AddressGateResult:
    """Screen ``address`` against the local blacklist and compliance lists.

    Works for any chain family: the blacklist store is chain-agnostic, and
    ``compliance_service`` already no-ops non-EVM addresses internally (see
    ``_is_evm_address`` in ``compliance_service.py``), so calling this
    unconditionally for Solana/TRON/Starknet addresses is safe and simply
    yields ``blocked=False`` from the compliance half.
    """
    # 1. Local blacklist — fail open on error.
    try:
        bl_result = await blacklist_service.check(address, BlacklistType.TOKEN)
        if bl_result.is_blacklisted:
            reason = "; ".join(bl_result.reasons) or "address is on the scam blacklist"
            return AddressGateResult(blocked=True, reason=f"Blacklisted — {reason}")
    except Exception as e:
        logger.warning(
            "blacklist_service.check failed for %s: %s -- continuing (fail-open)", address, e
        )

    # 2. Compliance (OFAC / operator sanctions) — mirror swap-flow handling:
    # only the deliberate ComplianceError block is caught; any other
    # exception is left to propagate, exactly as it would out of
    # SwapEngine.execute_swap's own (unwrapped) compliance_service call.
    try:
        compliance_service.assert_compliant(tokens=[address], chain=chain)
    except ComplianceError as e:
        return AddressGateResult(blocked=True, reason=f"Sanctioned — {e.result.reason}")

    return AddressGateResult(blocked=False)
