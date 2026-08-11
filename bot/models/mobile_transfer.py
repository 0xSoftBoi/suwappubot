"""Mobile app peer-to-peer sends (Gekko neobank `POST /v1/mobile/send`).

Audit log of outgoing on-chain transfers initiated from the mobile app,
mirroring `bot/models/savings.py`'s `SavingsEvent` shape so
`GET /v1/mobile/statement` can aggregate deposits/withdrawals/sends/swaps
through one consistent pattern. Never the source of truth for balances —
purely a best-effort event log for statement rendering.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, Numeric, ForeignKey

from database.db import Base


class MobileTransfer(Base):
    """One outgoing send from a user's own (non-custodial) wallet, initiated
    via the mobile app's `POST /v1/mobile/send`."""

    __tablename__ = "mobile_transfers"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True, index=True)
    chain = Column(String(32), nullable=False, default="base")
    token = Column(String(16), nullable=False, default="USDC")
    to_address = Column(String(128), nullable=False)
    amount = Column(Numeric(28, 6), nullable=False)
    # USDC is treated as ~$1 for statement purposes (matches the earn/save
    # endpoints' existing float(amount) == balanceUsd convention).
    amount_usd = Column(Numeric(18, 2), nullable=True)
    tx_hash = Column(String(80), nullable=True)
    # "sent" (broadcast confirmed) | "pending" (broadcast ambiguous — see
    # api/routes/mobile.py's `_send_usdc_base`).
    status = Column(String(16), nullable=False, default="sent")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
