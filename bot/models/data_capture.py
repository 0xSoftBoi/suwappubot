"""Append-only data-capture tables for a future fine-tuning / model-training dataset.

Both tables are written-once, never updated or deleted — no update/delete
paths exist and none should be added. `user_intents` is the (input -> output)
training pair; `interaction_events` is broad telemetry for anything that
isn't intent-shaped.

Table creation is idempotent and lives in `database/db.py` `_ensure_schema()`
(`_create_data_capture_tables`), which is authoritative for tables both
stacks write. This SQLAlchemy model mirrors it for ORM access.
"""

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Text,
)
from sqlalchemy.sql import func
from datetime import datetime
from database.db import Base


class UserIntent(Base):
    """One (input -> output) training pair captured from a user turn.

    APPEND-ONLY: never updated or deleted after insert.
    """

    __tablename__ = "user_intents"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    # 'telegram' | 'webapp' | 'terminal' | 'api' | 'mcp' | 'whatsapp'
    surface = Column(String(20), nullable=False)

    # Verbatim user input. Nullable — withheld when redacted.
    raw_text = Column(Text, nullable=True)
    redacted = Column(Boolean, default=False, nullable=False)
    # 'secret_detected' | 'denylisted_state' | ...
    redaction_reason = Column(String(40), nullable=True)

    # Resolved verb: swap/bridge/limit/perp_open/...
    intent_type = Column(String(40), nullable=True, index=True)
    # The structured action we actually derived. The physical column is JSONB
    # on Postgres and TEXT on SQLite (see `_create_data_capture_tables`), so
    # this MUST be the generic JSON type, not Text: Text binds a Python str,
    # which Postgres refuses to cast into a jsonb column. SQLite would still
    # pass, hiding the failure until prod.
    resolved_action = Column(JSON, nullable=True)
    # 'resolved' | 'clarified' | 'abandoned' | 'failed'
    resolution_status = Column(String(20), nullable=False, default="resolved")

    # Position within a multi-turn conversation.
    turn_index = Column(Integer, nullable=False, default=0)
    # Groups turns of one conversation.
    session_key = Column(String(128), nullable=False, index=True)

    # Links the intent to the trade it produced, if any.
    swap_id = Column(Integer, ForeignKey("swap_transactions.id"), nullable=True, index=True)

    model_version = Column(String(40), nullable=True)
    parser_version = Column(String(40), nullable=True)

    # server_default is REQUIRED: `default=` alone is applied by SQLAlchemy in
    # Python and produces NO database DEFAULT, so any other writer (Drizzle)
    # inserting without this column would hit a NOT NULL violation.
    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        return (
            f"<UserIntent(user_id={self.user_id}, surface={self.surface}, "
            f"intent_type={self.intent_type}, status={self.resolution_status})>"
        )


class InteractionEvent(Base):
    """Broad append-only telemetry for anything not intent-shaped.

    APPEND-ONLY: never updated or deleted after insert.
    """

    __tablename__ = "interaction_events"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    surface = Column(String(20), nullable=False)
    event_type = Column(String(60), nullable=False, index=True)
    # JSONB on Postgres / TEXT on SQLite — generic JSON type for the same
    # reason as `UserIntent.resolved_action` above.
    payload = Column(JSON, nullable=True)
    session_key = Column(String(128), nullable=True, index=True)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        return (
            f"<InteractionEvent(user_id={self.user_id}, surface={self.surface}, "
            f"event_type={self.event_type})>"
        )
