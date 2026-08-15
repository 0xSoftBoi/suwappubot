from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text, Float
from datetime import datetime
from database.db import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Org-scoped audit trail (nullable so legacy/system events still write).
    org_id = Column(String(36), nullable=True, index=True)
    # Agent-scoped events stamp the agent id here instead of overloading user_id.
    agent_id = Column(String(64), nullable=True, index=True)
    event_type = Column(
        String(50), nullable=False, index=True
    )  # login, swap, withdrawal, settings_change, 2fa_toggle, whitelist_change
    details = Column(Text, nullable=True)  # JSON details
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class WithdrawalWhitelist(Base):
    __tablename__ = "withdrawal_whitelist"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    chain = Column(String(50), nullable=False)
    address = Column(String(255), nullable=False)
    label = Column(String(100), nullable=True)
    cooldown_until = Column(DateTime, nullable=True)  # 24h after creation
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class BackupCode(Base):
    __tablename__ = "backup_codes"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    code_hash = Column(String(128), nullable=False)
    is_used = Column(Boolean, default=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SpendEvent(Base):
    """Durable record of USD outflow for spending-limit windows.

    SwapTransaction.from_amount_usd historically held token amounts, so limit
    windows are computed from this table instead — rows are only ever written
    with a real USD value, by the swap engine at submission time.
    """

    __tablename__ = "spend_events"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount_usd = Column(Float, nullable=False)
    kind = Column(String(20), default="swap")  # swap, withdrawal, ...
    swap_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
