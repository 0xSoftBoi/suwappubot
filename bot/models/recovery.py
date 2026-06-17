"""Social-recovery models.

A RecoveryRequest is a time-locked, email-approved request to transfer control
of a user's account (and its wallets) to a new Telegram account. Approval is a
DKIM-verified email from the user's registered recovery address; a mandatory
delay window lets the legitimate owner cancel a fraudulent request before it
executes.
"""

from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String

from database.db import Base


class RecoveryStatus:
    PENDING = "pending"  # created, awaiting a DKIM-verified email approval
    APPROVED = "approved"  # email approved; awaiting the time-lock to elapse
    EXECUTED = "executed"  # control transferred
    CANCELLED = "cancelled"  # cancelled by the original owner
    EXPIRED = "expired"  # not completed within the expiry window


class RecoveryRequest(Base):
    __tablename__ = "recovery_requests"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # The account control is being transferred TO.
    new_telegram_id = Column(BigInteger, nullable=False)
    # Snapshot of the guardian/recovery email required to approve.
    guardian_email = Column(String(255), nullable=False)
    # Random token the approval email's subject must contain.
    challenge = Column(String(64), nullable=False, index=True)

    status = Column(String(20), default=RecoveryStatus.PENDING, index=True)

    delay_seconds = Column(Integer, default=86400)  # time-lock before execution
    requested_at = Column(DateTime, default=datetime.utcnow)
    execute_after = Column(DateTime, nullable=False)  # requested_at + delay
    expires_at = Column(DateTime, nullable=False)

    approved_at = Column(DateTime, nullable=True)
    approved_domain = Column(String(255), nullable=True)  # DKIM d= that approved
    finalized_at = Column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return (
            f"<RecoveryRequest(user_id={self.user_id}, status={self.status}, "
            f"new_telegram_id={self.new_telegram_id})>"
        )
