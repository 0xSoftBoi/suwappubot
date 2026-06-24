"""Rewards-marketplace fulfillment models.

The rewards store is expanding from our own product (subscriptions / fee discounts)
to an open *marketplace* of asynchronously-fulfilled rewards — gift cards, travel,
merch, donations, experiences. Those redemptions can't complete synchronously (they
call an external provider such as Tremendous / Bitrefill / Duffel), so each one
creates a ``RedemptionOrder`` that records the debited points and tracks the
fulfillment lifecycle.

Ships SANDBOXED/DISABLED by default (``settings.rewards_marketplace_enabled``): with
no provider configured, a redemption is recorded, attempted, and immediately
REFUNDED (status ``refunded``) so a user's points are never lost to an
unfulfillable reward — mirroring the existing TGE-claim 425 stub.

MONEY PATH: the points debit, the order row, the provider call, and the
refund-on-failure all run inside ONE transaction in
``points_service.redeem_marketplace_reward`` — all-or-nothing.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    JSON,
    Index,
)

from database.db import Base


class RedemptionOrder(Base):
    """An asynchronously-fulfilled marketplace redemption.

    Lifecycle (``status``):
      - ``pending``    — debited + order created, provider not yet resolved
      - ``fulfilled``  — provider accepted; ``provider_ref`` is the external id
      - ``failed``     — provider declined (points get refunded → ``refunded``)
      - ``refunded``   — points were re-credited; net spend is 0
    """

    __tablename__ = "redemption_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    reward_id = Column(Integer, ForeignKey("rewards.id"), nullable=True)

    # own_product|gift_card|travel|merch|donation|crypto|experience
    category = Column(String(30), nullable=False)
    points_spent = Column(Integer, nullable=False)

    # pending|fulfilled|failed|refunded
    status = Column(String(20), nullable=False, default="pending")

    provider = Column(String(40), nullable=True)  # 'sandbox'|'tremendous'|'bitrefill'|...
    provider_ref = Column(String(120), nullable=True)  # external order id
    payload = Column(JSON, nullable=True)  # item + recipient details
    idempotency_key = Column(String(120), nullable=True)  # unique when present
    error = Column(String(255), nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    fulfilled_at = Column(DateTime, nullable=True)

    # NOTE: user_id already gets an index via Column(index=True) above
    # (auto-named ix_redemption_orders_user_id) — do NOT redeclare it here or
    # create_all aborts with "index already exists", leaving later tables uncreated.
    __table_args__ = (Index("ux_redemption_orders_idem", "idempotency_key", unique=True),)
