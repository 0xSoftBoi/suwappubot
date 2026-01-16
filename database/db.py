from sqlalchemy import create_engine, event, text, inspect
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Session
from contextlib import contextmanager
from typing import Generator


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


# These will be initialized when init_db is called
engine = None
SessionLocal = None


def init_db(database_url: str) -> None:
    """Initialize database connection and create tables."""
    global engine, SessionLocal
    
    connect_args = {}
    is_sqlite = database_url.startswith("sqlite")
    
    if is_sqlite:
        connect_args["check_same_thread"] = False
    
    # Optimized engine settings
    engine = create_engine(
        database_url,
        connect_args=connect_args,
        echo=False,
        pool_pre_ping=True,  # Check connections before use
        pool_size=20 if not is_sqlite else 5,  # Connection pool
        max_overflow=30 if not is_sqlite else 5,  # Extra connections
        pool_recycle=3600,  # Recycle connections hourly
    )
    
    # SQLite optimizations
    if is_sqlite:
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")  # Write-ahead logging
            cursor.execute("PRAGMA synchronous=NORMAL")  # Faster writes
            cursor.execute("PRAGMA cache_size=-64000")  # 64MB cache
            cursor.execute("PRAGMA temp_store=MEMORY")  # Temp tables in memory
            cursor.execute("PRAGMA mmap_size=268435456")  # 256MB memory map
            cursor.close()
    
    SessionLocal = sessionmaker(
        autocommit=False, 
        autoflush=False, 
        bind=engine,
        expire_on_commit=False,  # Don't expire objects after commit (faster)
    )
    
    # Import models to ensure they're registered with Base
    from bot.models.user import User, Wallet
    from bot.models.swap import SwapTransaction
    # Common operational tables used by services/background tasks
    from bot.models.fees import FeeConfig, FeeTransaction, FeeSummary
    from bot.models.advanced import LimitOrder, DCAOrder, DCAExecution, SwapTemplate
    # Referral system models
    from bot.models.referral import Referral, ReferralCode, ReferralReward, ReferralPayout
    # Points/XP and Copy Trading models
    from bot.models.points import UserPoints, PointTransaction, PointRedemption, Milestone, UserMilestone, Reward
    from bot.models.copy_trading import TraderProfile, CopyFollow, CopyTrade, CopyNotification, TraderTrade
    
    # Create all tables
    Base.metadata.create_all(bind=engine)

    # Lightweight schema migrations (no Alembic)
    _ensure_schema(engine)


def _ensure_schema(db_engine) -> None:
    """
    Ensure newer columns/indexes exist for existing deployments.
    This project intentionally avoids Alembic; keep migrations additive + idempotent.
    """
    if not db_engine:
        return

    inspector = inspect(db_engine)
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    is_sqlite = db_engine.dialect.name == "sqlite"

    # --- swap_transactions idempotency ---
    if "swap_transactions" in tables:
        cols = {c["name"] for c in inspector.get_columns("swap_transactions")}

        if "idempotency_key" not in cols:
            # Add column
            if is_sqlite:
                ddl = "ALTER TABLE swap_transactions ADD COLUMN idempotency_key VARCHAR(128)"
            else:
                ddl = "ALTER TABLE swap_transactions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128)"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

        # Unique index to enforce idempotency (NULLs allowed)
        with db_engine.begin() as conn:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_swap_transactions_idempotency_key "
                "ON swap_transactions(idempotency_key)"
            ))

    # --- wallets: envelope encryption columns ---
    if "wallets" in tables:
        _add_encryption_columns(db_engine, inspector, "wallets", is_sqlite)
        _add_turnkey_columns(db_engine, inspector, "wallets", is_sqlite, include_sub_org=True)

    # --- hot_wallets: envelope encryption columns ---
    if "hot_wallets" in tables:
        _add_encryption_columns(db_engine, inspector, "hot_wallets", is_sqlite)
        _add_turnkey_columns(db_engine, inspector, "hot_wallets", is_sqlite, include_sub_org=False)

    # --- users: TOS columns and telegram_id nullability ---
    if "users" in tables:
        _add_tos_columns(db_engine, inspector, is_sqlite)
        _fix_user_nullability(db_engine, inspector, is_sqlite)
        _add_referral_columns(db_engine, inspector, is_sqlite)


def _fix_user_nullability(db_engine, inspector, is_sqlite: bool) -> None:
    """
    Ensure telegram_id is nullable for WhatsApp-only users.
    
    For Postgres: Uses ALTER COLUMN to drop NOT NULL constraint.
    For SQLite: Column nullability cannot be altered without table recreation.
                New databases are created correctly; existing ones may need manual migration.
    """
    if not is_sqlite:
        try:
            with db_engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL"))
        except Exception:
            # Column may already be nullable
            pass


def _add_tos_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add Terms of Service columns to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}
    
    new_columns = [
        ("tos_accepted", "BOOLEAN", "0"),
        ("tos_accepted_at", "DATETIME", "NULL"),
    ]
    
    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE users ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _add_referral_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add referral tracking columns to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}
    
    # Columns for quick referral stats access (denormalized for performance)
    new_columns = [
        ("referred_by_user_id", "INTEGER", "NULL"),
        ("total_referral_rewards", "FLOAT", "0.0"),
        ("referral_count", "INTEGER", "0"),
    ]
    
    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE users ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _add_encryption_columns(db_engine, inspector, table_name: str, is_sqlite: bool) -> None:
    """Add envelope encryption columns to a wallet table idempotently."""
    cols = {c["name"] for c in inspector.get_columns(table_name)}

    # Columns to add for KMS envelope encryption
    new_columns = [
        ("encryption_scheme", "VARCHAR(50)", "'legacy_fernet_v1'"),
        ("kms_wrapped_dek", "TEXT", "NULL"),
        ("aesgcm_nonce", "VARCHAR(32)", "NULL"),
        ("kms_key_id", "VARCHAR(255)", "NULL"),
        ("key_version", "INTEGER", "1"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _add_turnkey_columns(db_engine, inspector, table_name: str, is_sqlite: bool, include_sub_org: bool = False) -> None:
    """Add Turnkey wallet infrastructure columns to a wallet table idempotently."""
    cols = {c["name"] for c in inspector.get_columns(table_name)}

    # Columns for Turnkey integration
    new_columns = [
        ("wallet_provider", "VARCHAR(20)", "'local'"),
        ("turnkey_wallet_id", "VARCHAR(100)", "NULL"),
        ("turnkey_account_id", "VARCHAR(100)", "NULL"),
    ]
    
    # User wallets also need sub-organization tracking
    if include_sub_org:
        new_columns.append(("turnkey_sub_org_id", "VARCHAR(100)", "NULL"))

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Get a database session with automatic cleanup."""
    if SessionLocal is None:
        raise RuntimeError("Database not initialized. Call init_db first.")
    
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

