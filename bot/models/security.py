from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text, Float
from datetime import datetime
from database.db import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    event_type = Column(String(50), nullable=False, index=True)  # login, swap, withdrawal, settings_change, 2fa_toggle, whitelist_change
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
