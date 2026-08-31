from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB

from database.db import Base


class ScreeningEvent(Base):
    """Durable record of a compliance-screening decision (KYT/OFAC gate).

    Written by ``bot.services.compliance.screening_events.record_screening_event``
    at the two money-movement gates — ``SwapEngine.execute_swap`` and the
    withdrawal path (``hot_wallet._assert_recipient_compliant``, shared by
    ``send_native_token``/``send_token``) — right after
    ``AddressComplianceService.screen()`` returns its verdict. This table is
    the ONLY thing that makes those decisions visible outside the process log
    line; see docs/plans/enterprise-dashboard.md (compliance-api node) and
    the read surface at api-ts's ``enterpriseCompliance.ts``.

    Persistence here is deliberately best-effort: a write failure MUST NOT
    block or alter the actual screening decision (swap/withdrawal), so every
    call site wraps the write in try/except and only logs on failure — see
    ``record_screening_event``.

    ``user_id`` is nullable because not every ``send_native_token``/
    ``send_token`` caller has a user in scope (internal-wallet sweeps, P2P
    escrow release/refund pass ``user_id=None``); callers that do have one
    (terminal withdrawal route, Telegram withdrawal handler, gas
    sponsorship) pass it through — see ``record_screening_event``.
    ``org_id`` is nullable because nothing writes it today: no caller of
    ``record_screening_event`` threads an ``org_id`` through. Rows with
    ``user_id=None`` are therefore write-only for any org-scoped dashboard
    query — there is no join or fallback that recovers them.
    """

    __tablename__ = "screening_events"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    user_id = Column(Integer, nullable=True, index=True)
    org_id = Column(String(36), nullable=True, index=True)
    chain = Column(String(50), nullable=True, index=True)
    direction = Column(String(16), nullable=False, default="outbound")  # outbound | inbound
    address = Column(String(255), nullable=True)
    decision = Column(String(16), nullable=False, index=True)  # allowed | blocked | flagged
    # ofac_match | not_allowlisted | custom_blocklist | unscreenable | degraded_list | ...
    reason = Column(String(64), nullable=True, index=True)
    mode = Column(String(16), nullable=False, index=True)  # enforce | monitor
    # Free-form context: swap id, amounts, role of the screened address, etc.
    # JSON on sqlite (dev/tests), native JSONB on postgres (prod) — matches
    # the Drizzle-side jsonb declaration for this table; this table hasn't
    # shipped anywhere yet so this is a pre-launch type fix, not a migration.
    tx_context = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
