from sqlalchemy import create_engine, event, text, inspect
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Session
from contextlib import contextmanager
from typing import Generator, TypeVar, Callable
from concurrent.futures import ThreadPoolExecutor
import asyncio
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
            # Cap runaway queries at 30 seconds to prevent pool starvation
            connect_args["options"] = (
                connect_args.get("options", "") + " -c statement_timeout=30000"
            ).strip()
    
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
                pool_size=10 if not is_sqlite else 5,  # 10 base connections per instance
                max_overflow=15 if not is_sqlite else 5,  # 25 max per instance (3×25=75 < 100 default)
                pool_recycle=3600,  # Recycle connections hourly
                pool_timeout=10,  # Fail fast instead of hanging when pool exhausted
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
        from bot.models.subscription import Subscription, X402Payment, APICredit, MPPSessionRecord
        # Common operational tables used by services/background tasks
        from bot.models.fees import FeeConfig, FeeTransaction, FeeSummary
        from bot.models.advanced import LimitOrder, DCAOrder, DCAExecution, SwapTemplate, RugMonitor
        # Referral system models
        from bot.models.referral import Referral, ReferralCode, ReferralReward, ReferralPayout
        # Points/XP and Copy Trading models
        from bot.models.points import UserPoints, PointTransaction, PointRedemption, Milestone, UserMilestone, Reward
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
        # Terminal tracking models
        from bot.models.tracking import TrackedWallet
        # Prediction market models
        from bot.models.predict import PredictionOrder, PredictionPosition
        # Token staking models
        from bot.models.token_staking import TokenClaim, StakingPosition, DistributionEpoch, EpochReward, TreasuryPosition

        # Reconcile a cross-ORM table collision before create_all (which only creates
        # MISSING tables, never fixes an existing one): api-ts (Drizzle) historically created
        # `limit_orders` with an incompatible schema (no wallet_id). api-ts now owns
        # `limit_orders_ts`, so drop an empty, wrong-shaped `limit_orders` and let create_all
        # rebuild the SQLAlchemy schema.
        _reconcile_cross_orm_tables(engine)

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


def _reconcile_cross_orm_tables(db_engine) -> None:
    """One-time corrective for cross-ORM table collisions on the shared database.

    api-ts (Drizzle) creates several feature tables (limit_orders, dca_orders, ...) with
    schemas incompatible with the python SQLAlchemy models. `create_all` only creates
    MISSING tables — it never fixes an existing one — so when api-ts created a table first,
    python's expected columns are absent and the bot's background services error
    (e.g. `column limit_orders.wallet_id does not exist`).

    For each affected python-owned table: if it exists, is EMPTY, and is missing columns the
    SQLAlchemy model defines, drop it so create_all rebuilds the correct schema. Drops ONLY
    when empty, to never lose data.
    """
    try:
        from bot.models.advanced import LimitOrder, DCAOrder, DCAExecution
    except Exception:
        return
    try:
        inspector = inspect(db_engine)
        existing = set(inspector.get_table_names())
        for model in (LimitOrder, DCAOrder, DCAExecution):
            table = model.__tablename__
            if table not in existing:
                continue
            db_cols = {c["name"] for c in inspector.get_columns(table)}
            model_cols = {c.name for c in model.__table__.columns}
            missing = model_cols - db_cols
            if not missing:
                continue  # already matches the SQLAlchemy schema
            with db_engine.begin() as conn:
                count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
                if count > 0:
                    logger.warning(
                        "%s is missing python columns %s but has %s row(s); NOT dropping — "
                        "resolve manually.", table, sorted(missing), count
                    )
                    continue
                conn.execute(text(f"DROP TABLE {table} CASCADE"))
            logger.info(
                "Reconciled cross-ORM table %s: dropped empty wrong-shaped table; "
                "create_all will rebuild the SQLAlchemy schema", table
            )
    except Exception as e:
        logger.warning("cross-ORM table reconcile skipped: %s", e)


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

    # --- agents: unique index on api_key + Drizzle schema alignment ---
    agents_table = "agents" if "agents" in tables else "registered_agents" if "registered_agents" in tables else None
    if agents_table:
        with db_engine.begin() as conn:
            conn.execute(text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS ux_agents_api_key "
                f"ON {agents_table}(api_key)"
            ))
        _add_agent_drizzle_columns(db_engine, inspector, agents_table, is_sqlite)

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

    # --- users: core columns, TOS, and telegram_id nullability ---
    if "users" in tables:
        _add_user_core_columns(db_engine, inspector, is_sqlite)
        _add_tos_columns(db_engine, inspector, is_sqlite)
        _fix_user_nullability(db_engine, inspector, is_sqlite)
        _widen_user_telegram_id(db_engine, inspector, is_sqlite)
        _add_referral_columns(db_engine, inspector, is_sqlite)
        _add_push_token_column(db_engine, inspector, is_sqlite)
        _add_user_settings_columns(db_engine, inspector, is_sqlite)
        _add_passkey_columns(db_engine, inspector, is_sqlite)
        _widen_totp_secret(db_engine, inspector, is_sqlite)
        _encrypt_plaintext_totp_secrets(db_engine, is_sqlite)

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

    # --- subscriptions: started_at column ---
    if "subscriptions" in tables:
        _add_subscription_started_at(db_engine, inspector, is_sqlite)

    # --- rename registered_agents -> agents ---
    if "registered_agents" in tables and "agents" not in tables:
        with db_engine.begin() as conn:
            conn.execute(text("ALTER TABLE registered_agents RENAME TO agents"))
            logger.info("Renamed registered_agents -> agents")

    # --- staking tables: token_claims, staking_positions, distribution_epochs, epoch_rewards ---
    _add_staking_tables(db_engine, inspector, is_sqlite)
    _add_treasury_tables_and_columns(db_engine, inspector, is_sqlite)

    # --- performance indexes ---
    _add_performance_indexes(db_engine, inspector, is_sqlite)


def _add_agent_drizzle_columns(db_engine, inspector, table_name: str, is_sqlite: bool) -> None:
    """Add columns to agents table to match Drizzle schema."""
    cols = {c["name"] for c in inspector.get_columns(table_name)}

    new_columns = [
        ("uuid", "VARCHAR(36)", "NULL"),
        ("api_key_hash", "VARCHAR(128)", "NULL"),
        ("metadata", "TEXT", "NULL"),
        ("rate_limit_tier", "VARCHAR(20)", "'free'"),
        ("total_requests", "INTEGER", "0"),
        ("total_swaps", "INTEGER", "0"),
        ("updated_at", "TIMESTAMP", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

    # Unique index on uuid
    with db_engine.begin() as conn:
        conn.execute(text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS ux_{table_name}_uuid "
            f"ON {table_name}(uuid)"
        ))


def _add_staking_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create SUWP staking tables (token_claims, staking_positions, distribution_epochs, epoch_rewards) idempotently."""
    try:
        from bot.models.token_staking import TokenClaim, StakingPosition, DistributionEpoch, EpochReward

        for model in (TokenClaim, StakingPosition, DistributionEpoch, EpochReward):
            if not inspector.has_table(model.__tablename__):
                model.__table__.create(bind=db_engine)
                logger.info(f"Created {model.__tablename__} table")
    except Exception as e:
        logger.warning(f"Failed to create staking tables: {e}")


def _add_treasury_tables_and_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Create treasury_positions table and add vault columns to distribution_epochs."""
    try:
        from bot.models.token_staking import TreasuryPosition
        if not inspector.has_table("treasury_positions"):
            TreasuryPosition.__table__.create(bind=db_engine)
            logger.info("Created treasury_positions table")
    except Exception as e:
        logger.warning(f"Failed to create treasury_positions table: {e}")

    if "distribution_epochs" in set(inspector.get_table_names()):
        cols = {c["name"] for c in inspector.get_columns("distribution_epochs")}
        new_columns = [
            ("direct_fees_usdc", "NUMERIC(18,6)"),
            ("treasury_yield_usdc", "NUMERIC(18,6)"),
            ("total_staker_usdc", "NUMERIC(18,6)"),
            ("treasury_aum_usdc", "NUMERIC(18,6)"),
        ]
        for col_name, col_type in new_columns:
            if col_name not in cols:
                if is_sqlite:
                    ddl = f"ALTER TABLE distribution_epochs ADD COLUMN {col_name} {col_type}"
                else:
                    ddl = f"ALTER TABLE distribution_epochs ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
                try:
                    with db_engine.begin() as conn:
                        conn.execute(text(ddl))
                    logger.info(f"Added distribution_epochs.{col_name}")
                except Exception as e:
                    logger.warning(f"Could not add {col_name}: {e}")


def _add_performance_indexes(db_engine, inspector, is_sqlite: bool) -> None:
    """Add indexes for high-traffic query patterns."""
    indexes = [
        ("ix_swap_transactions_user_id", "swap_transactions", "user_id"),
        ("ix_swap_transactions_user_created", "swap_transactions", "user_id, created_at DESC"),
        ("ix_swap_transactions_status", "swap_transactions", "status"),
        ("ix_agents_is_active", "agents", "is_active"),
        # Added by audit — pollers and services do full-table scans without these
        ("ix_swap_transactions_tx_hash", "swap_transactions", "tx_hash"),
        ("ix_wallets_user_id_id", "wallets", "user_id, id"),
        ("ix_referral_rewards_referral_id", "referral_rewards", "referral_id"),
        ("ix_limit_orders_user_id_status", "limit_orders", "user_id, status"),
        ("ix_dca_orders_status_next", "dca_orders", "status, next_execution_at"),
        ("ix_advanced_price_alerts_active", "advanced_price_alerts", "is_active, is_triggered"),
    ]
    for idx_name, table, columns in indexes:
        try:
            tables = set(inspector.get_table_names())
            if table in tables:
                with db_engine.begin() as conn:
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({columns})"))
        except Exception:
            pass  # Index may already exist or table missing


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


def _add_subscription_started_at(db_engine, inspector, is_sqlite: bool) -> None:
    """Add started_at column to subscriptions table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("subscriptions")}
    if "started_at" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE subscriptions ADD COLUMN started_at TIMESTAMP"
        else:
            ddl = "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS started_at TIMESTAMP"
        with db_engine.begin() as conn:
            conn.execute(text(ddl))


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


def _widen_totp_secret(db_engine, inspector, is_sqlite: bool) -> None:
    """Widen users.totp_secret to hold an encrypted secret (~208 chars).

    Older deployments created the column as VARCHAR(64) for a plaintext TOTP
    seed. Encryption-at-rest stores a much longer ciphertext, so Postgres must
    widen the column. SQLite ignores VARCHAR lengths, so this is a no-op there.
    """
    if is_sqlite:
        return
    cols = {c["name"] for c in inspector.get_columns("users")}
    if "totp_secret" not in cols:
        return
    try:
        with db_engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ALTER COLUMN totp_secret TYPE TEXT"))
        logger.info("Widened users.totp_secret to TEXT")
    except Exception as e:
        logger.warning(f"Could not widen users.totp_secret: {e}")


def _encrypt_plaintext_totp_secrets(db_engine, is_sqlite: bool) -> None:
    """Backfill: encrypt any legacy plaintext TOTP secrets in place.

    Idempotent — already-encrypted rows decrypt cleanly and are skipped. This
    remediates the historical plaintext exposure for users who never re-trigger
    a 2FA read. Best-effort: failures are logged, never fatal to startup.
    """
    try:
        from bot.config.settings import settings
        from bot.utils.encryption import encrypt_private_key, decrypt_private_key
    except Exception as e:
        logger.warning(f"Skipping TOTP backfill (imports unavailable): {e}")
        return

    import base64
    import re

    def _is_legacy_plaintext_secret(value) -> bool:
        # Only heal values that actually look like a legacy base32 TOTP secret;
        # never re-encrypt corrupted ciphertext (that would destroy it).
        if not isinstance(value, str) or not re.fullmatch(r"[A-Z2-7]+=*", value):
            return False
        try:
            # Pad to an 8-char boundary first: a genuine secret may be stored
            # unpadded, and b32decode rejects unpadded input.
            padded = value + "=" * (-len(value) % 8)
            base64.b32decode(padded, casefold=False)
        except Exception:
            return False
        return True

    key = settings.encryption_key
    try:
        with db_engine.begin() as conn:
            rows = conn.execute(text(
                "SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL"
            )).fetchall()
            migrated = 0
            skipped = 0
            for row in rows:
                stored = row[1]
                try:
                    decrypt_private_key(stored, key)
                    continue  # already encrypted
                except Exception:
                    pass  # decrypt failed — only heal if it's real plaintext
                if not _is_legacy_plaintext_secret(stored):
                    logger.warning(
                        "User %s TOTP secret failed to decrypt and is not valid "
                        "legacy base32; skipping to avoid corrupting it.", row[0]
                    )
                    skipped += 1
                    continue
                encrypted = encrypt_private_key(stored, key)
                conn.execute(
                    text("UPDATE users SET totp_secret = :s WHERE id = :id"),
                    {"s": encrypted, "id": row[0]},
                )
                migrated += 1
            if migrated or skipped:
                logger.info(
                    "TOTP backfill: encrypted %s legacy plaintext, skipped %s "
                    "corrupted/invalid", migrated, skipped
                )
    except Exception as e:
        logger.warning(f"TOTP secret backfill skipped: {e}")


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


def _widen_user_telegram_id(db_engine, inspector, is_sqlite: bool) -> None:
    """Widen users.telegram_id from INTEGER to BIGINT.

    Telegram user IDs now exceed 2^31 (INT4 max), causing
    psycopg2.errors.NumericValueOutOfRange on INSERT. Idempotent: queries
    information_schema and no-ops if the column is already bigint.

    SQLite treats INTEGER as 64-bit storage so no migration is required.
    """
    if is_sqlite:
        return
    try:
        with db_engine.begin() as conn:
            current_type = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'users' AND column_name = 'telegram_id'"
            )).scalar()
            if current_type == "integer":
                conn.execute(text(
                    "ALTER TABLE users ALTER COLUMN telegram_id TYPE BIGINT"
                ))
                logger.info("Widened users.telegram_id from INTEGER to BIGINT")
    except Exception as exc:
        logger.warning(f"Could not widen users.telegram_id to BIGINT: {exc}")


def _add_user_core_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add core User model columns that may be missing on older deployments."""
    cols = {c["name"] for c in inspector.get_columns("users")}

    new_columns = [
        ("whatsapp_id", "VARCHAR(255)", "NULL"),
        ("default_slippage", "INTEGER", "50"),
        ("notifications_enabled", "BOOLEAN", "TRUE"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE users ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _add_tos_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add Terms of Service columns to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}
    
    new_columns = [
        ("tos_accepted", "BOOLEAN", "FALSE"),
        ("tos_accepted_at", "TIMESTAMP", "NULL"),
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


def _add_passkey_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add terminal passkey lookup columns to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}

    new_columns = [
        ("passkey_credential_id", "VARCHAR(512)", "NULL"),
        ("passkey_user_handle", "VARCHAR(255)", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE users ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

    with db_engine.begin() as conn:
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_users_passkey_credential_id "
            "ON users(passkey_credential_id)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_users_passkey_user_handle "
            "ON users(passkey_user_handle)"
        ))


def _add_user_settings_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add panic sell and 2FA columns to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}

    new_columns = [
        ("panic_sell_enabled", "BOOLEAN", "FALSE"),
        ("two_fa_enabled", "BOOLEAN", "FALSE"),
        ("totp_secret", "VARCHAR(64)", "NULL"),
        ("two_fa_threshold", "INTEGER", "1000"),
        ("gas_mode", "VARCHAR(10)", "'auto'"),  # read/written by api-ts (webapp gas settings)
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
        ("backup_key_exported_at", "TIMESTAMP", "NULL"),
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


# --- Async DB helpers (avoid blocking the event loop) ---

T = TypeVar("T")

# Dedicated thread pool for DB operations — avoids starving the default executor
_db_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="db")


async def run_in_db(fn: Callable[..., T], *args, **kwargs) -> T:
    """Run a synchronous DB operation in a thread pool to avoid blocking the event loop.

    Usage:
        result = await run_in_db(lambda: _do_db_work(user_id, data))

    Or with a named function:
        def _update_status(swap_id, status):
            with get_session() as session:
                tx = session.query(SwapTransaction).filter_by(id=swap_id).first()
                if tx:
                    tx.status = status

        await run_in_db(_update_status, swap_id, new_status)
    """
    loop = asyncio.get_running_loop()
    if kwargs:
        return await loop.run_in_executor(_db_executor, lambda: fn(*args, **kwargs))
    return await loop.run_in_executor(_db_executor, fn, *args)
