"""Persistence for compliance-screening decisions (enterprise dashboard).

``AddressComplianceService.screen()`` (see ``compliance_service.py``) is the
decision engine; it is deliberately DB-free so the hot money-movement path
never depends on a database round-trip to know whether a transaction is
compliant. This module is the separate, best-effort write path that makes
those decisions visible to the enterprise dashboard
(docs/plans/enterprise-dashboard.md, compliance-api node) via the
``screening_events`` table (bot/models/compliance.py).

Call sites (both wrap this in a way that can never propagate a failure):

  * ``SwapEngine.execute_swap`` — after ``compliance_service.screen(...)``,
    with ``user_id`` in scope. Does NOT thread ``org_id`` through today.
  * ``hot_wallet._assert_recipient_compliant`` (shared by
    ``send_native_token``/``send_token``) — after
    ``compliance_service.screen(...)``, with ``user_id`` passed through from
    whichever caller has one in scope (terminal API withdrawal route,
    Telegram withdrawal handler, gas sponsorship). Pooled/admin call sites
    with no user in scope (internal-wallet sweeps, P2P escrow release/refund)
    still pass ``user_id=None``. Does NOT thread ``org_id`` through either.
  * ``OrgPolicyService._record_screening``/``_record_degraded``
    (``bot.services.org_policy.service``) — the org-policy gate that runs
    right after sanctions screening at both of the call sites above DOES
    thread ``org_id`` through, resolved from the user's own org
    membership(s). So ``org_id`` is populated on org-policy decision rows,
    but still NOT on the sanctions-screening rows above — a row with
    ``user_id=None`` from those two call sites remains effectively
    write-only for an org-scoped dashboard query on ``org_id`` alone; there
    is no fallback lookup that recovers it.

CRITICAL: ``record_screening_event`` must never raise. A persistence outage
must not become a swap/withdrawal outage — it only means that transaction's
decision is invisible to the dashboard until the DB recovers.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from bot.services.compliance.compliance_service import ComplianceMode, ComplianceResult

logger = logging.getLogger(__name__)

# AddressVerdict.source -> dashboard-facing reason code.
_REASON_BY_SOURCE = {
    "ofac": "ofac_match",
    "blocklist": "custom_blocklist",
    "not_allowlisted": "not_allowlisted",
    "unscreenable": "unscreenable",
    "degraded_list": "degraded_list",
}


def _decision_for(result: ComplianceResult) -> str:
    if not result.blocked:
        return "allowed"
    if result.mode is ComplianceMode.ENFORCE and not result.allowed:
        return "blocked"
    # MONITOR (or any other shadow path): violations found but not enforced.
    return "flagged"


def _reason_for(result: ComplianceResult) -> Optional[str]:
    if not result.blocked:
        return None
    # First blocked verdict is the primary reason; screen() already treats
    # blocklist/OFAC as taking priority over allowlist misses.
    return _REASON_BY_SOURCE.get(result.blocked[0].source, result.blocked[0].source or None)


def _address_for(result: ComplianceResult, explicit: Optional[str]) -> Optional[str]:
    if explicit:
        return explicit
    for v in result.verdicts:
        if v.role == "recipient" and v.address:
            return v.address
    if result.blocked and result.blocked[0].address:
        return result.blocked[0].address
    return None


def record_screening_event(
    result: ComplianceResult,
    *,
    user_id: Optional[int] = None,
    org_id: Optional[str] = None,
    chain: Optional[str] = None,
    direction: str = "outbound",
    address: Optional[str] = None,
    tx_context: Optional[dict[str, Any]] = None,
) -> None:
    """Best-effort write of a screening decision to ``screening_events``.

    Never raises — every failure mode (import error, DB outage, bad session)
    is caught and logged so the caller's money-movement decision is
    unaffected.
    """
    try:
        from bot.models.compliance import ScreeningEvent
        from database.db import get_session

        decision = _decision_for(result)
        reason = _reason_for(result)
        resolved_address = _address_for(result, address)

        with get_session() as session:
            session.add(
                ScreeningEvent(
                    user_id=user_id,
                    org_id=org_id,
                    chain=chain,
                    direction=direction,
                    address=resolved_address,
                    decision=decision,
                    reason=reason,
                    mode=result.mode.value,
                    tx_context=tx_context,
                )
            )
        # Session above has committed (get_session commits on normal
        # __exit__) — dispatch is scheduled AFTER the write lands, never
        # nested inside the write session, so a slow/failed webhook lookup
        # can never hold that session's connection open (see the T1 comment
        # in bot.services.org_policy.service for the same pool-pressure
        # rationale). Individual users have no org_webhooks rows, so
        # org_id=None (both sanctions-screening call sites today) already
        # short-circuits before any DB lookup is attempted.
        if org_id and decision in ("blocked", "flagged"):
            _dispatch_screening_webhook(
                org_id=org_id,
                event_type=f"screening.{decision}",
                chain=chain,
                direction=direction,
                address=resolved_address,
                decision=decision,
                reason=reason,
                mode=result.mode.value,
                user_id=user_id,
                tx_context=tx_context,
            )
    except Exception as e:  # noqa: BLE001 — persistence must never break screening
        logger.warning("Failed to persist screening event (decision unaffected): %s", e)


def _dispatch_screening_webhook(
    *,
    org_id: str,
    event_type: str,
    chain: Optional[str],
    direction: str,
    address: Optional[str],
    decision: str,
    reason: Optional[str],
    mode: str,
    user_id: Optional[int],
    tx_context: Optional[dict[str, Any]],
) -> None:
    """Best-effort, non-blocking fan-out to org-configured webhooks for a
    blocked/flagged screening decision. Isolated in its own try/except (on
    top of the caller's own blanket one) so a dispatch-scheduling failure
    logs distinctly from a persistence failure and never masks the fact that
    the screening_events row above was already durably written.

    NOTE on ``bot.services.org_policy.service`` specifically: that caller's
    own ``_record_screening`` reaches this function from INSIDE
    ``_evaluate_sync``, which runs off the event loop via ``run_in_db``'s
    executor thread — a plain executor thread has no running event loop, so
    ``dispatch_org_event_from_sync``'s ``asyncio.get_running_loop()`` guard
    raises ``RuntimeError`` there and this call no-ops BY DESIGN. That is not
    a bug: ``OrgPolicyService.evaluate()`` dispatches the org-webhook event
    itself, once, from the async side (right after its
    ``await run_in_db(self._evaluate_sync, ...)`` call returns, where a
    running loop genuinely is available) — see the NO-DOUBLE-DISPATCH
    comment in ``org_policy/service.py::evaluate``. Any FUTURE caller of
    ``record_screening_event`` that itself already runs on a live event-loop
    thread (unlike today's two sanctions-screening call sites, which are
    genuinely sync) would have this wiring dispatch correctly with no
    changes needed — that's why it stays here rather than being deleted.
    """
    try:
        from bot.services.org_webhooks import dispatch_org_event_from_sync

        dispatch_org_event_from_sync(
            org_id,
            event_type,
            {
                "chain": chain,
                "direction": direction,
                "address": address,
                "decision": decision,
                "reason": reason,
                "mode": mode,
                "userId": user_id,
                "txContext": tx_context,
            },
        )
    except Exception as e:  # noqa: BLE001 — dispatch scheduling must never break screening
        logger.warning("Failed to dispatch org webhook for screening event: %s", e)
