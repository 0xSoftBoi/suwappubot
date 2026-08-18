"""Bounded Solana market-data storage.

Hot tier keeps full decoded RPC payloads briefly. Warm tier keeps compact facts
for long-lived analysis. Cold tier stores gzip-compressed raw payloads for a
bounded recovery window, avoiding indefinite Postgres growth.
"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Index, Integer, LargeBinary, String, Text, UniqueConstraint

from database.db import Base


class SolanaProgramTransaction(Base):
    __tablename__ = "solana_program_transactions"
    __table_args__ = (
        UniqueConstraint("signature", name="uq_solana_program_transactions_signature"),
        Index("ix_solana_program_transactions_program_slot", "source_program", "slot"),
        Index("ix_solana_program_transactions_fee_payer_slot", "fee_payer", "slot"),
        Index("ix_solana_program_transactions_compaction", "raw_archived_at", "ingested_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    signature = Column(String(128), nullable=False, index=True)
    source_program = Column(String(64), nullable=False, index=True)
    program_id = Column(String(64), nullable=False, index=True)
    slot = Column(BigInteger, nullable=False, index=True)
    block_time = Column(BigInteger, nullable=True, index=True)
    fee_payer = Column(String(64), nullable=True, index=True)
    success = Column(Boolean, nullable=False, default=True, index=True)
    fee_lamports = Column(BigInteger, nullable=True)
    compute_units_consumed = Column(BigInteger, nullable=True)

    # Warm tier: compact facts retained for analysis.
    compact_json = Column(Text, nullable=True)

    # Hot tier: verbose decoded data, removed after PUMP_INGEST_HOT_HOURS.
    account_keys_json = Column(Text, nullable=True)
    instructions_json = Column(Text, nullable=True)
    inner_instructions_json = Column(Text, nullable=True)
    pre_balances_json = Column(Text, nullable=True)
    post_balances_json = Column(Text, nullable=True)
    pre_token_balances_json = Column(Text, nullable=True)
    post_token_balances_json = Column(Text, nullable=True)
    log_messages_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    raw_transaction_json = Column(Text, nullable=True)

    # Cold tier: compressed raw transaction retained for a bounded window.
    raw_gzip = Column(LargeBinary, nullable=True)
    raw_archived_at = Column(DateTime, nullable=True, index=True)

    ingested_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
