"""Gas top-up audit log — MONEY-PATH.

Every automatic ETH top-up sent from the hot wallet to a user's own wallet
(so a Gekko user never has to hold ETH to move USDC on Base — see
bot/services/gas_topup_service.py) is recorded here. This is the durable,
auditable record of real hot-wallet spend that is NOT a user-initiated
transfer, and it also backs the per-user/global daily cap enforcement in
gas_topup_service.py (caps are computed by querying this table, not a
separate counter, so the audit log and the enforcement data can never drift
apart).
"""

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String

from database.db import Base


class GasTopUp(Base):
    """One automatic gas top-up sent from the hot wallet to a user's wallet."""

    __tablename__ = "gas_topups"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    wallet_address = Column(String(128), nullable=False, index=True)
    chain = Column(String(32), nullable=False, default="base")
    amount_wei = Column(BigInteger, nullable=False)
    tx_hash = Column(String(80), nullable=True)
    # What triggered the top-up, e.g. "mobile_send", "mobile_earn_deposit",
    # "mobile_earn_withdraw" — lets ops attribute spend to a feature.
    reason = Column(String(64), nullable=False)
    # "sent" (broadcast + receipt confirmed status==1) | "ambiguous" (the
    # broadcast call itself raised but may have landed — see
    # hot_wallet.py's PostBroadcastAmbiguous). A row only ever exists once a
    # tx_hash is known, i.e. something was actually broadcast/spent.
    status = Column(String(16), nullable=False, default="sent")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
