from sqlalchemy import create_engine, event, text, inspect
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Session
from contextlib import contextmanager
from typing import Generator
import logging
import time

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


# These will be initialized when init_db is called
engine = None
SessionLocal = None
DATABASE_AVAILABLE = False  # Flag for degraded mode


def init_db(database_url: str, max_retries: int = 3, retry_delay: float = 2.0) -> bool:
    """
    Initialize database connection and create tables.
    
    Returns True if successful, False if database is unavailable.
    Does not raise exceptions - allows app to run in degraded mode.
    """
    global engine, SessionLocal, DATABASE_AVAILABLE
    
    if not database_url:
        logger.error("No DATABASE_URL provided")
        return False
    
    # Log the database type (mask credentials)
    if "postgresql" in database_url or "postgres" in database_url:
        logger.info("Connecting to PostgreSQL database...")
    elif "sqlite" in database_url:
        logger.info("Connecting to SQLite database...")
    else:
        logger.info("Connecting to database...")

    connect_args = {}
    is_sqlite = database_url.startswith("sqlite")
    
    if is_sqlite:
        connect_args["check_same_thread"] = False
    else:
        # PostgreSQL settings
        if "postgresql" in database_url or "postgres" in database_url:
            # Only set sslmode if not already specified in the URL
            if "sslmode=" not in database_url:
                connect_args["sslmode"] = "require"
            connect_args["connect_timeout"] = 10
    
    # Retry logic for transient connection failures
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            # Create engine
            engine = create_engine(
                database_url,
                connect_args=connect_args,
                echo=False,
                pool_pre_ping=True,  # Check connections before use
                pool_size=5 if not is_sqlite else 5,  # Reduced for multi-instance (3×15=45 < 66 max)
                max_overflow=10 if not is_sqlite else 5,  # Extra connections
                pool_recycle=3600,  # Recycle connections hourly
            )
            
            # Test the connection
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            
            logger.info(f"✓ Database connection established (attempt {attempt}/{max_retries})")
            break
            
        except Exception as e:
            last_error = e
            logger.warning(f"Database connection attempt {attempt}/{max_retries} failed: {e}")
            
            if attempt < max_retries:
                logger.info(f"Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
            else:
                logger.error(f"Failed to connect to database after {max_retries} attempts: {last_error}")
                engine = None
                return False
    
    # SQLite optimizations
    if is_sqlite and engine:
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
    try:
        from bot.models.user import User, Wallet
        from bot.models.swap import SwapTransaction
        # Common operational tables used by services/background tasks
        from bot.models.fees import FeeConfig, FeeTransaction, FeeSummary
        from bot.models.advanced import LimitOrder, DCAOrder, DCAExecution, SwapTemplate, RugMonitor
        # Referral system models
        from bot.models.referral import Referral, ReferralCode, ReferralReward, ReferralPayout
        # Points/XP and Copy Trading models
        from bot.models.points import UserPoints, PointTransaction, PointRedemption, Milestone, UserMilestone, Reward, DailyQuest, UserQuest, JackpotPool
        from bot.models.copy_trading import TraderProfile, CopyFollow, CopyTrade, CopyNotification, TraderTrade
        # Token Sniping models
        from bot.models.snipe import SnipeOrder, SnipeConfig, SnipeHistory, WatchedToken, AutoSnipeRule
        # OAuth models
        from bot.models.oauth import OAuthIdentity, OAuthToken, OAuthState
        # Agent registration models
        from bot.models.agent import RegisteredAgent
        # PnL tracking
        from bot.models.pnl import TokenPosition
        # Webhook events
        from bot.models.webhook_event import WebhookEvent
        # Security models (audit logs, withdrawal whitelist, backup codes)
        from bot.models.security import AuditLog, WithdrawalWhitelist, BackupCode
        # Perpetual trading models
        from bot.models.perps import PerpPosition, PerpOrder, HyperLiquidAccount
        # Points rewards models
        from bot.models.token import PointsTier, FeeDiscount

        # Create all tables
        Base.metadata.create_all(bind=engine)
        logger.info("✓ Database tables created/verified")

        # Lightweight schema migrations (no Alembic)
        _ensure_schema(engine)
        logger.info("✓ Database schema migrations complete")
        
    except Exception as e:
        logger.error(f"Failed to create database tables: {e}")
        return False
    
    DATABASE_AVAILABLE = True
    return True


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

    # --- registered_agents: unique index on api_key ---
    if "registered_agents" in tables:
        with db_engine.begin() as conn:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_registered_agents_api_key "
                "ON registered_agents(api_key)"
            ))

    # --- swap_transactions: agent linkage columns ---
    if "swap_transactions" in tables:
        _add_swap_agent_columns(db_engine, inspector, is_sqlite)
        _add_swap_price_columns(db_engine, inspector, is_sqlite)

    # --- user_settings: MEV protection column + quick trade presets ---
    if "user_settings" in tables:
        _add_user_settings_mev_column(db_engine, inspector, is_sqlite)
        _add_quicktrade_columns(db_engine, inspector, is_sqlite)

    # --- referral_rewards: multi-tier column ---
    _add_referral_tier_column(db_engine, inspector, is_sqlite)

    # --- limit_orders: advanced order columns ---
    if "limit_orders" in tables:
        _add_advanced_order_columns(db_engine, inspector, is_sqlite)

    # --- users: TOS columns and telegram_id nullability ---
    if "users" in tables:
        _add_tos_columns(db_engine, inspector, is_sqlite)
        _fix_user_nullability(db_engine, inspector, is_sqlite)
        _add_referral_columns(db_engine, inspector, is_sqlite)
        _add_push_token_column(db_engine, inspector, is_sqlite)
        _add_user_settings_columns(db_engine, inspector, is_sqlite)

    # --- smart notification columns ---
    _add_smart_notification_columns(db_engine, inspector, is_sqlite)

    # --- x402_payments: Telegram Stars payment columns ---
    if "x402_payments" in tables:
        _add_stars_payment_columns(db_engine, inspector, is_sqlite)

    # --- gamification tables: daily_quests, user_quests, jackpot_pools ---
    _create_gamification_tables(db_engine, inspector, is_sqlite)

    # --- copy_follows: enhanced copy trading columns ---
    if "copy_follows" in tables:
        _add_copy_trading_columns(db_engine, inspector, is_sqlite)

    # --- rug_monitors table ---
    if not inspector.has_table("rug_monitors"):
        from bot.models.advanced import RugMonitor
        RugMonitor.__table__.create(bind=db_engine)
        logger.info("Created rug_monitors table")

    # --- security tables (audit_logs, withdrawal_whitelist, backup_codes) ---
    _add_security_tables(db_engine, inspector, is_sqlite)

    # --- Phase 4 tables: perps, token ---
    _add_phase4_tables(db_engine, inspector, is_sqlite)

    # --- users: discord_id column ---
    if "users" in tables:
        _add_discord_columns(db_engine, inspector, is_sqlite)


def _add_security_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create security tables (audit_logs, withdrawal_whitelist, backup_codes) idempotently."""
    try:
        from bot.models.security import AuditLog, WithdrawalWhitelist, BackupCode

        for model in (AuditLog, WithdrawalWhitelist, BackupCode):
            if not inspector.has_table(model.__tablename__):
                model.__table__.create(bind=db_engine)
                logger.info(f"Created {model.__tablename__} table")
    except Exception as e:
        logger.warning(f"Failed to create security tables: {e}")


def _add_phase4_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create Phase 4 tables (perps, points rewards) idempotently."""
    try:
        from bot.models.perps import PerpPosition, PerpOrder, HyperLiquidAccount
        from bot.models.token import PointsTier, FeeDiscount

        for model in (PerpPosition, PerpOrder, HyperLiquidAccount,
                      PointsTier, FeeDiscount):
            if not inspector.has_table(model.__tablename__):
                model.__table__.create(bind=db_engine)
                logger.info(f"Created {model.__tablename__} table")
    except Exception as e:
        logger.warning(f"Failed to create Phase 4 tables: {e}")


def _add_discord_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add Discord user linking columns to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}

    new_columns = [
        ("discord_id", "VARCHAR(100)", "NULL"),
        ("discord_username", "VARCHAR(255)", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE users ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


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
        ("tos_accepted", "BOOLEAN", "FALSE"),
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


def _add_push_token_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add push notification token column to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}

    if "push_token" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE users ADD COLUMN push_token VARCHAR(255) DEFAULT NULL"
        else:
            ddl = "ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token VARCHAR(255) DEFAULT NULL"
        with db_engine.begin() as conn:
            conn.execute(text(ddl))


def _add_user_settings_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add panic sell and 2FA columns to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}

    new_columns = [
        ("panic_sell_enabled", "BOOLEAN", "FALSE"),
        ("two_fa_enabled", "BOOLEAN", "FALSE"),
        ("totp_secret", "VARCHAR(64)", "NULL"),
        ("two_fa_threshold", "INTEGER", "1000"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE users ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _add_referral_tier_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add referral_tier column to referral_rewards table idempotently."""
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    if "referral_rewards" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("referral_rewards")}

    if "referral_tier" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE referral_rewards ADD COLUMN referral_tier INTEGER DEFAULT 1"
        else:
            ddl = "ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS referral_tier INTEGER DEFAULT 1"
        with db_engine.begin() as conn:
            conn.execute(text(ddl))


def _add_swap_price_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add per-token price columns to swap_transactions for PnL tracking."""
    cols = {c["name"] for c in inspector.get_columns("swap_transactions")}

    new_columns = [
        ("from_token_price_usd", "FLOAT", "NULL"),
        ("to_token_price_usd", "FLOAT", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE swap_transactions ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE swap_transactions ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _add_user_settings_mev_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add MEV protection toggle to user_settings table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("user_settings")}

    if "mev_protection_enabled" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE user_settings ADD COLUMN mev_protection_enabled BOOLEAN DEFAULT TRUE"
        else:
            ddl = "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS mev_protection_enabled BOOLEAN DEFAULT TRUE"
        with db_engine.begin() as conn:
            conn.execute(text(ddl))


def _add_quicktrade_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add quick-trade preset columns to user_settings table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("user_settings")}

    new_columns = [
        ("quickbuy_amounts", "VARCHAR(200)", "'0.1,0.5,1,5'"),
        ("first_trade_completed", "BOOLEAN", "FALSE"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE user_settings ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _add_advanced_order_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add advanced order columns to limit_orders table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("limit_orders")}

    new_columns = [
        ("trailing_percent", "FLOAT", "NULL"),
        ("highest_price_seen", "FLOAT", "NULL"),
        ("parent_order_id", "INTEGER", "NULL"),
        ("portion_percent", "FLOAT", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE limit_orders ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE limit_orders ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
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


def _add_swap_agent_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add agent linkage columns to swap_transactions idempotently."""
    cols = {c["name"] for c in inspector.get_columns("swap_transactions")}

    new_columns = [
        ("agent_id", "INTEGER", "NULL"),
        ("agent_uuid", "VARCHAR(36)", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE swap_transactions ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE swap_transactions ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

    # Index for efficient agent swap lookups
    with db_engine.begin() as conn:
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_swap_transactions_agent_id "
            "ON swap_transactions(agent_id)"
        ))


def _add_smart_notification_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add smart notification columns to advanced_price_alerts and user_settings idempotently."""
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    # --- advanced_price_alerts: PnL alert fields ---
    if "advanced_price_alerts" in tables:
        cols = {c["name"] for c in inspector.get_columns("advanced_price_alerts")}

        new_columns = [
            ("pnl_threshold_percent", "FLOAT", "NULL"),
            ("token_address", "VARCHAR(100)", "NULL"),
        ]

        for col_name, col_type, default in new_columns:
            if col_name not in cols:
                if is_sqlite:
                    ddl = f"ALTER TABLE advanced_price_alerts ADD COLUMN {col_name} {col_type} DEFAULT {default}"
                else:
                    ddl = f"ALTER TABLE advanced_price_alerts ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
                with db_engine.begin() as conn:
                    conn.execute(text(ddl))

    # --- user_settings: notification preference fields ---
    if "user_settings" in tables:
        cols = {c["name"] for c in inspector.get_columns("user_settings")}

        new_columns = [
            ("quiet_hours_start", "INTEGER", "NULL"),
            ("quiet_hours_end", "INTEGER", "NULL"),
            ("quiet_hours_timezone", "VARCHAR(50)", "'UTC'"),
            ("notification_batching", "BOOLEAN", "TRUE"),
        ]

        for col_name, col_type, default in new_columns:
            if col_name not in cols:
                if is_sqlite:
                    ddl = f"ALTER TABLE user_settings ADD COLUMN {col_name} {col_type} DEFAULT {default}"
                else:
                    ddl = f"ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
                with db_engine.begin() as conn:
                    conn.execute(text(ddl))


def _add_stars_payment_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add Telegram Stars payment columns to x402_payments table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("x402_payments")}

    new_columns = [
        ("payment_method", "VARCHAR(32)", "'crypto'"),
        ("stars_amount", "INTEGER", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE x402_payments ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _create_gamification_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create gamification tables (daily_quests, user_quests, jackpot_pools) idempotently."""
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        # --- daily_quests ---
        if "daily_quests" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS daily_quests (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date VARCHAR(10) NOT NULL,
                        quest_type VARCHAR(50) NOT NULL,
                        description VARCHAR(255) NOT NULL,
                        target_value INTEGER NOT NULL,
                        points_reward INTEGER NOT NULL,
                        xp_reward INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS daily_quests (
                        id SERIAL PRIMARY KEY,
                        date VARCHAR(10) NOT NULL,
                        quest_type VARCHAR(50) NOT NULL,
                        description VARCHAR(255) NOT NULL,
                        target_value INTEGER NOT NULL,
                        points_reward INTEGER NOT NULL,
                        xp_reward INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))

        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_daily_quests_date ON daily_quests(date)"
        ))

        # --- user_quests ---
        if "user_quests" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS user_quests (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        quest_id INTEGER NOT NULL REFERENCES daily_quests(id),
                        progress INTEGER DEFAULT 0,
                        is_completed BOOLEAN DEFAULT FALSE,
                        completed_at DATETIME,
                        claimed BOOLEAN DEFAULT FALSE,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS user_quests (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        quest_id INTEGER NOT NULL REFERENCES daily_quests(id),
                        progress INTEGER DEFAULT 0,
                        is_completed BOOLEAN DEFAULT FALSE,
                        completed_at TIMESTAMP,
                        claimed BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))

        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_user_quests_user_id ON user_quests(user_id)"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_user_quests_user_quest ON user_quests(user_id, quest_id)"
        ))

        # --- jackpot_pools ---
        if "jackpot_pools" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS jackpot_pools (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date VARCHAR(10) NOT NULL UNIQUE,
                        total_pool_usd FLOAT DEFAULT 0.0,
                        winner_user_id INTEGER REFERENCES users(id),
                        winner_payout_usd FLOAT,
                        is_drawn BOOLEAN DEFAULT FALSE,
                        drawn_at DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS jackpot_pools (
                        id SERIAL PRIMARY KEY,
                        date VARCHAR(10) NOT NULL UNIQUE,
                        total_pool_usd FLOAT DEFAULT 0.0,
                        winner_user_id INTEGER REFERENCES users(id),
                        winner_payout_usd FLOAT,
                        is_drawn BOOLEAN DEFAULT FALSE,
                        drawn_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))

        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_jackpot_pools_date ON jackpot_pools(date)"
        ))


def _add_copy_trading_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add enhanced copy trading columns to copy_follows table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("copy_follows")}

    new_columns = [
        ("auto_sell_enabled", "BOOLEAN", "TRUE"),
        ("chains_filter", "VARCHAR(200)", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE copy_follows ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE copy_follows ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
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

