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
                pool_size=15 if not is_sqlite else 5,  # 15 base connections per instance
                max_overflow=(25 if not is_sqlite else 5),  # 40 max per instance
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
                logger.error(
                    f"Failed to connect to database after {max_retries} attempts: {last_error}"
                )
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
        from bot.models.points import (
            UserPoints,
            PointTransaction,
            PointRedemption,
            Milestone,
            UserMilestone,
            Reward,
        )

        # Rewards-marketplace async fulfillment orders
        from bot.models.rewards_marketplace import RedemptionOrder
        from bot.models.copy_trading import (
            TraderProfile,
            CopyFollow,
            CopyTrade,
            CopyNotification,
            TraderTrade,
            TraderPosition,
        )

        # Season / convertible-points models
        from bot.models.seasons import Season, SeasonPoints, SeasonSnapshot

        # User spot-position cost basis (unified Positions / PnL view)
        from bot.models.positions import UserPosition

        # Token Sniping models
        from bot.models.snipe import (
            SnipeOrder,
            SnipeConfig,
            SnipeHistory,
            WatchedToken,
            AutoSnipeRule,
        )

        # OAuth models
        from bot.models.oauth import OAuthIdentity, OAuthToken, OAuthState

        # Agent registration models
        from bot.models.agent import RegisteredAgent

        # PnL tracking
        from bot.models.pnl import TokenPosition

        # Webhook events
        from bot.models.webhook_event import WebhookEvent

        # Security models (audit logs, withdrawal whitelist, backup codes, spend events)
        from bot.models.security import AuditLog, WithdrawalWhitelist, BackupCode, SpendEvent

        # Social-recovery models (recovery_requests)
        from bot.models.recovery import RecoveryRequest

        # Perpetual trading models
        from bot.models.perps import PerpPosition, PerpOrder, HyperLiquidAccount

        # Points rewards models
        from bot.models.token import PointsTier, FeeDiscount

        # Terminal tracking models
        from bot.models.tracking import TrackedWallet

        # Prediction market models
        from bot.models.predict import PredictionOrder, PredictionPosition

        # P2P marketplace models
        from bot.models.p2p import P2POffer, P2PTrade

        # Token staking models
        from bot.models.token_staking import (
            TokenClaim,
            StakingPosition,
            DistributionEpoch,
            EpochReward,
            TreasuryPosition,
        )

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
                        "resolve manually.",
                        table,
                        sorted(missing),
                        count,
                    )
                    continue
                conn.execute(text(f"DROP TABLE {table} CASCADE"))
            logger.info(
                "Reconciled cross-ORM table %s: dropped empty wrong-shaped table; "
                "create_all will rebuild the SQLAlchemy schema",
                table,
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
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ux_swap_transactions_idempotency_key "
                    "ON swap_transactions(idempotency_key)"
                )
            )

    # --- wallets: envelope encryption columns ---
    if "wallets" in tables:
        _add_encryption_columns(db_engine, inspector, "wallets", is_sqlite)
        _add_turnkey_columns(db_engine, inspector, "wallets", is_sqlite, include_sub_org=True)

    # --- hot_wallets: envelope encryption columns ---
    if "hot_wallets" in tables:
        _add_encryption_columns(db_engine, inspector, "hot_wallets", is_sqlite)
        _add_turnkey_columns(db_engine, inspector, "hot_wallets", is_sqlite, include_sub_org=False)

    # --- agents: unique index on api_key + Drizzle schema alignment ---
    agents_table = (
        "agents"
        if "agents" in tables
        else "registered_agents" if "registered_agents" in tables else None
    )
    if agents_table:
        with db_engine.begin() as conn:
            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS ux_agents_api_key "
                    f"ON {agents_table}(api_key)"
                )
            )
        _add_agent_drizzle_columns(db_engine, inspector, agents_table, is_sqlite)

    # --- swap_transactions: agent linkage columns ---
    if "swap_transactions" in tables:
        _add_swap_agent_columns(db_engine, inspector, is_sqlite)
        _add_swap_price_columns(db_engine, inspector, is_sqlite)
        _add_swap_error_category_column(db_engine, inspector, is_sqlite)

    # --- user_settings: MEV protection column + quick trade presets ---
    if "user_settings" in tables:
        _add_user_settings_mev_column(db_engine, inspector, is_sqlite)
        _add_quicktrade_columns(db_engine, inspector, is_sqlite)
        _add_user_settings_trading_prefs(db_engine, inspector, is_sqlite)
        _add_user_settings_proactive_column(db_engine, inspector, is_sqlite)
        _add_user_settings_granular_notify_columns(db_engine, inspector, is_sqlite)

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
        # Self-heal any remaining missing User columns (shared DB has had python-owned
        # columns dropped by api-ts drizzle pushes). Belt-and-suspenders so the ORM's
        # SELECT never 500s on a column the model has but the table lost.
        _reconcile_user_columns(db_engine, is_sqlite)

    # --- smart notification columns ---
    _add_smart_notification_columns(db_engine, inspector, is_sqlite)

    # --- x402_payments: Telegram Stars payment columns ---
    if "x402_payments" in tables:
        _add_stars_payment_columns(db_engine, inspector, is_sqlite)

    # --- gamification tables: daily_quests, user_quests, jackpot_pools ---
    _create_gamification_tables(db_engine, inspector, is_sqlite)

    # --- agent billing: agent_credits, agent_credit_topups, agent_subscriptions ---
    _create_agent_billing_tables(db_engine, inspector, is_sqlite)

    # --- recurring crypto subscriptions (Base Spend Permissions) ---
    _create_recurring_subscriptions_table(db_engine, inspector, is_sqlite)

    # --- copy_follows: enhanced copy trading columns ---
    if "copy_follows" in tables:
        _add_copy_trading_columns(db_engine, inspector, is_sqlite)

    # --- copy_trades: paper mode entry price ---
    if "copy_trades" in tables:
        _add_copy_trade_paper_column(db_engine, inspector, is_sqlite)

    # --- rug_monitors table ---
    if not inspector.has_table("rug_monitors"):
        from bot.models.advanced import RugMonitor

        RugMonitor.__table__.create(bind=db_engine)
        logger.info("Created rug_monitors table")

    # --- security tables (audit_logs, withdrawal_whitelist, backup_codes) ---
    _add_security_tables(db_engine, inspector, is_sqlite)

    # --- social recovery: recovery_requests ---
    _add_recovery_tables(db_engine, inspector, is_sqlite)

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
    _add_hyperliquid_ecosystem_tables(db_engine, inspector, is_sqlite)
    _add_cctp_tables(db_engine, inspector, is_sqlite)
    _add_user_region_column(db_engine, inspector, is_sqlite)
    _add_user_language_preference_column(db_engine, inspector, is_sqlite)
    _add_savings_tables(db_engine, inspector, is_sqlite)
    _add_auth_tables(db_engine, inspector, is_sqlite)
    _add_btc_swap_tables(db_engine, inspector, is_sqlite)
    _add_btc_swap_v2_columns(db_engine, inspector, is_sqlite)
    _add_btc_swap_dst_chain_column(db_engine, inspector, is_sqlite)
    _add_morpho_tables(db_engine, inspector, is_sqlite)

    # --- performance indexes ---
    _add_performance_indexes(db_engine, inspector, is_sqlite)
    _add_performance_indexes_v2(db_engine, inspector, is_sqlite)

    # --- users: weekly digest columns ---
    if "users" in tables:
        _add_digest_columns(db_engine, inspector, is_sqlite)

    # --- tempo_sponsorships table (Tempo fee-sponsorship persistence) ---
    if not inspector.has_table("tempo_sponsorships"):
        from bot.models.tempo import TempoSponsorship

        TempoSponsorship.__table__.create(bind=db_engine)
        logger.info("Created tempo_sponsorships table")

    # --- p2p_offers / p2p_trades tables (P2P marketplace escrow persistence) ---
    if not inspector.has_table("p2p_offers"):
        from bot.models.p2p import P2POffer

        P2POffer.__table__.create(bind=db_engine)
        logger.info("Created p2p_offers table")

    if not inspector.has_table("p2p_trades"):
        from bot.models.p2p import P2PTrade

        P2PTrade.__table__.create(bind=db_engine)
        logger.info("Created p2p_trades table")

    # --- prediction_positions: on-chain redemption columns ---
    if "prediction_positions" in tables:
        _add_prediction_redeem_columns(db_engine, inspector, is_sqlite)

    # --- point_transactions: season_id stamp (convertible-points audit) ---
    if "point_transactions" in tables:
        _add_point_transactions_season_column(db_engine, inspector, is_sqlite)

    # --- seasons / season_points: emission-schedule + fee-revenue columns ---
    if "seasons" in tables or "season_points" in tables:
        _add_season_econ_columns(db_engine, inspector, is_sqlite, tables)

    # --- rewards: marketplace category column (async fulfillment routing) ---
    if "rewards" in tables:
        _add_reward_category_column(db_engine, inspector, is_sqlite)

    # --- users: enterprise org membership columns ---
    if "users" in tables:
        _add_user_org_columns(db_engine, inspector, is_sqlite)


def _add_user_org_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add users.organization_id and users.organization_role for enterprise tenancy, idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}
    for col, col_type in [
        ("organization_id", "VARCHAR(36)"),
        ("organization_role", "VARCHAR(20)"),
    ]:
        if col not in cols:
            try:
                if is_sqlite:
                    ddl = f"ALTER TABLE users ADD COLUMN {col} {col_type}"
                else:
                    ddl = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {col_type}"
                with db_engine.begin() as conn:
                    conn.execute(text(ddl))
                logger.info(f"Added users.{col}")
            except Exception as e:
                logger.warning(f"Failed to add users.{col}: {e}")


def _add_reward_category_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add rewards.reward_category idempotently (default 'own_product').

    Categorizes each catalog item for the rewards marketplace. Existing rewards stay
    'own_product' (synchronous, our-product redemptions); async categories
    (gift_card/travel/merch/donation/experience) route through reward_providers. The
    redemption_orders table itself is created by create_all from the new model.
    """
    cols = {c["name"] for c in inspector.get_columns("rewards")}
    if "reward_category" in cols:
        return
    if is_sqlite:
        ddl = (
            "ALTER TABLE rewards ADD COLUMN reward_category "
            "VARCHAR(30) NOT NULL DEFAULT 'own_product'"
        )
    else:
        ddl = (
            "ALTER TABLE rewards ADD COLUMN IF NOT EXISTS reward_category "
            "VARCHAR(30) NOT NULL DEFAULT 'own_product'"
        )
    with db_engine.begin() as conn:
        conn.execute(text(ddl))
    logger.info("Added rewards.reward_category")


def _add_season_econ_columns(db_engine, inspector, is_sqlite: bool, tables: set) -> None:
    """Add disinflationary-emission + fee-revenue columns to season tables.

    Idempotent: each column is guarded on its table existing and the column not
    already being present. (sqlite has no ADD COLUMN IF NOT EXISTS, so we guard
    explicitly; postgres uses IF NOT EXISTS as a belt-and-suspenders.)
    """
    # seasons.season_index, seasons.realized_fee_revenue_usd
    if "seasons" in tables:
        cols = {c["name"] for c in inspector.get_columns("seasons")}
        season_new = [
            ("season_index", "INTEGER", "1"),
            ("realized_fee_revenue_usd", "DOUBLE PRECISION", "NULL"),
            ("quarter", "VARCHAR(16)", "NULL"),
        ]
        for col_name, col_type, default in season_new:
            if col_name in cols:
                continue
            ddl_default = "" if default == "NULL" else f" DEFAULT {default}"
            if is_sqlite:
                ddl = f"ALTER TABLE seasons ADD COLUMN {col_name} {col_type}{ddl_default}"
            else:
                ddl = (
                    f"ALTER TABLE seasons ADD COLUMN IF NOT EXISTS "
                    f"{col_name} {col_type}{ddl_default}"
                )
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info(f"Added seasons.{col_name}")

    # season_points.fee_paid_usd
    if "season_points" in tables:
        cols = {c["name"] for c in inspector.get_columns("season_points")}
        if "fee_paid_usd" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE season_points ADD COLUMN fee_paid_usd DOUBLE PRECISION DEFAULT 0"
            else:
                ddl = (
                    "ALTER TABLE season_points ADD COLUMN IF NOT EXISTS "
                    "fee_paid_usd DOUBLE PRECISION DEFAULT 0"
                )
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info("Added season_points.fee_paid_usd")


def _add_point_transactions_season_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add point_transactions.season_id idempotently (nullable, for season audit)."""
    cols = {c["name"] for c in inspector.get_columns("point_transactions")}
    if "season_id" in cols:
        return
    if is_sqlite:
        ddl = "ALTER TABLE point_transactions ADD COLUMN season_id INTEGER"
    else:
        ddl = "ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS season_id INTEGER"
    with db_engine.begin() as conn:
        conn.execute(text(ddl))
    logger.info("Added point_transactions.season_id")


def _add_digest_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add weekly_digest and last_digest_at columns to users table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("users")}
    new_cols = [
        ("weekly_digest", "BOOLEAN", "FALSE"),
        ("last_digest_at", "TIMESTAMP", "NULL"),
    ]
    for col_name, col_type, default in new_cols:
        if col_name not in cols:
            if default == "NULL":
                ddl_default = ""
            else:
                ddl_default = f" DEFAULT {default}"
            if is_sqlite:
                ddl = f"ALTER TABLE users ADD COLUMN {col_name} {col_type}{ddl_default}"
            else:
                ddl = (
                    f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type}{ddl_default}"
                )
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info(f"Added users.{col_name}")


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
        # Crypto-native subscription overlay (api-ts resolves effective tier from these).
        ("subscription_tier", "VARCHAR(20)", "NULL"),
        ("subscription_expires_at", "TIMESTAMP", "NULL"),
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
        conn.execute(
            text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS ux_{table_name}_uuid " f"ON {table_name}(uuid)"
            )
        )


def _add_auth_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the auth_refresh_tokens table (H13 refresh tokens) idempotently."""
    try:
        from bot.models.auth import RefreshToken

        if not inspector.has_table(RefreshToken.__tablename__):
            RefreshToken.__table__.create(bind=db_engine)
            logger.info(f"Created {RefreshToken.__tablename__} table")
    except Exception as e:
        logger.warning(f"Failed to create auth_refresh_tokens table: {e}")


def _add_staking_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create SUWP staking tables (token_claims, staking_positions, distribution_epochs, epoch_rewards) idempotently."""
    try:
        from bot.models.token_staking import (
            TokenClaim,
            StakingPosition,
            DistributionEpoch,
            EpochReward,
        )

        for model in (TokenClaim, StakingPosition, DistributionEpoch, EpochReward):
            if not inspector.has_table(model.__tablename__):
                model.__table__.create(bind=db_engine)
                logger.info(f"Created {model.__tablename__} table")
    except Exception as e:
        logger.warning(f"Failed to create staking tables: {e}")


def _add_hyperliquid_ecosystem_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create HyperLiquid ecosystem tables (staking, vaults, TWAP) idempotently."""
    try:
        from bot.models.hl_ecosystem import HLStakeRecord, HLVaultPosition, HLTwapOrder

        for model in (HLStakeRecord, HLVaultPosition, HLTwapOrder):
            if not inspector.has_table(model.__tablename__):
                model.__table__.create(bind=db_engine)
                logger.info(f"Created {model.__tablename__} table")
    except Exception as e:
        logger.warning(f"Failed to create HyperLiquid ecosystem tables: {e}")


def _add_cctp_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the CCTP deposit-relay table idempotently."""
    try:
        from bot.models.cctp import CctpDeposit

        if not inspector.has_table(CctpDeposit.__tablename__):
            CctpDeposit.__table__.create(bind=db_engine)
            logger.info(f"Created {CctpDeposit.__tablename__} table")
    except Exception as e:
        logger.warning(f"Failed to create CCTP tables: {e}")


def _add_user_region_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add users.region (ISO-3166 alpha-2) for region-gated features, idempotently."""
    try:
        cols = {c["name"] for c in inspector.get_columns("users")}
        if "region" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE users ADD COLUMN region VARCHAR(8)"
            else:
                ddl = "ALTER TABLE users ADD COLUMN IF NOT EXISTS region VARCHAR(8)"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info("Added users.region")
    except Exception as e:
        logger.warning(f"Failed to add users.region: {e}")


def _add_user_language_preference_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add users.language_preference for persisting locale choice, idempotently."""
    try:
        cols = {c["name"] for c in inspector.get_columns("users")}
        if "language_preference" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE users ADD COLUMN language_preference VARCHAR(10) DEFAULT 'en'"
            else:
                ddl = "ALTER TABLE users ADD COLUMN IF NOT EXISTS language_preference VARCHAR(10) DEFAULT 'en'"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info("Added users.language_preference")
    except Exception as e:
        logger.warning(f"Failed to add users.language_preference: {e}")


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


def _add_savings_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the savings_events audit table (Aave V3 deposit/withdraw log)."""
    try:
        from bot.models.savings import SavingsEvent

        if not inspector.has_table("savings_events"):
            SavingsEvent.__table__.create(bind=db_engine)
            logger.info("Created savings_events table")
    except Exception as e:
        logger.warning(f"Failed to create savings_events table: {e}")


def _add_btc_swap_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the btc_swaps table (Atomiq BTC bridge swaps) idempotently."""
    try:
        from bot.models.btc_swap import BtcSwap

        if not inspector.has_table("btc_swaps"):
            BtcSwap.__table__.create(bind=db_engine)
            logger.info("Created btc_swaps table")
    except Exception as e:
        from sqlalchemy.exc import OperationalError

        if isinstance(e, OperationalError) or "already exists" in str(e).lower():
            logger.warning(f"Failed to create btc_swaps table: {e}")
        else:
            logger.exception("Failed to create btc_swaps table")


def _add_btc_swap_v2_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add escrow_address + last_error columns to btc_swaps idempotently."""
    if not inspector.has_table("btc_swaps"):
        return
    cols = {c["name"] for c in inspector.get_columns("btc_swaps")}
    for col_name in ("escrow_address", "last_error"):
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE btc_swaps ADD COLUMN {col_name} TEXT"
            else:
                ddl = f"ALTER TABLE btc_swaps ADD COLUMN IF NOT EXISTS {col_name} TEXT"
            try:
                with db_engine.begin() as conn:
                    conn.execute(text(ddl))
                logger.info(f"Added btc_swaps.{col_name}")
            except Exception as e:
                logger.warning(f"Could not add btc_swaps.{col_name}: {e}")


def _add_btc_swap_dst_chain_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add dst_chain column to btc_swaps (Citrea deposit destinations) idempotently."""
    if not inspector.has_table("btc_swaps"):
        return
    cols = {c["name"] for c in inspector.get_columns("btc_swaps")}
    if "dst_chain" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE btc_swaps ADD COLUMN dst_chain VARCHAR(32)"
        else:
            ddl = "ALTER TABLE btc_swaps ADD COLUMN IF NOT EXISTS dst_chain VARCHAR(32)"
        try:
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info("Added btc_swaps.dst_chain")
        except Exception as e:
            logger.warning(f"Could not add btc_swaps.dst_chain: {e}")


def _add_morpho_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the morpho_positions table (borrow-position health watchlist)."""
    try:
        from bot.models.morpho import MorphoPosition

        if not inspector.has_table("morpho_positions"):
            MorphoPosition.__table__.create(bind=db_engine)
            logger.info("Created morpho_positions table")
    except Exception as e:
        logger.warning(f"Failed to create morpho_positions table: {e}")


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
                    conn.execute(
                        text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({columns})")
                    )
        except Exception:
            pass  # Index may already exist or table missing


def _add_performance_indexes_v2(db_engine, inspector, is_sqlite: bool) -> None:
    """Add second batch of indexes for high-traffic query patterns."""
    indexes = [
        ("ix_wallets_user_id_is_active", "wallets", "user_id, is_active"),
        ("ix_users_referred_by_user_id", "users", "referred_by_user_id"),
        ("ix_trader_profiles_public_rank", "trader_profiles", "is_public, rank_score"),
        ("ix_user_points_xp", "user_points", "xp"),
        ("ix_fee_transactions_collected", "fee_transactions", "collected"),
        ("ix_copy_follows_trader_id_is_active", "copy_follows", "trader_id, is_active"),
    ]
    for idx_name, table, columns in indexes:
        try:
            tables = set(inspector.get_table_names())
            if table in tables:
                with db_engine.begin() as conn:
                    conn.execute(
                        text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({columns})")
                    )
        except Exception:
            pass  # Index may already exist or table missing


def _add_security_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create security tables (audit_logs, withdrawal_whitelist, backup_codes, spend_events) idempotently."""
    try:
        from bot.models.security import AuditLog, WithdrawalWhitelist, BackupCode, SpendEvent

        for model in (AuditLog, WithdrawalWhitelist, BackupCode, SpendEvent):
            if not inspector.has_table(model.__tablename__):
                model.__table__.create(bind=db_engine)
                logger.info(f"Created {model.__tablename__} table")
    except Exception as e:
        logger.warning(f"Failed to create security tables: {e}")


def _add_recovery_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create social-recovery tables (recovery_requests) idempotently."""
    try:
        from bot.models.recovery import RecoveryRequest

        if not inspector.has_table(RecoveryRequest.__tablename__):
            RecoveryRequest.__table__.create(bind=db_engine)
            logger.info("Created recovery_requests table")
    except Exception as e:
        logger.warning(f"Failed to create recovery tables: {e}")


def _add_phase4_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create Phase 4 tables (perps, points rewards) idempotently."""
    try:
        from bot.models.perps import PerpPosition, PerpOrder, HyperLiquidAccount
        from bot.models.token import PointsTier, FeeDiscount

        for model in (PerpPosition, PerpOrder, HyperLiquidAccount, PointsTier, FeeDiscount):
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
            rows = conn.execute(
                text("SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL")
            ).fetchall()
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
                        "legacy base32; skipping to avoid corrupting it.",
                        row[0],
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
                    "TOTP backfill: encrypted %s legacy plaintext, skipped %s " "corrupted/invalid",
                    migrated,
                    skipped,
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
            current_type = conn.execute(
                text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'users' AND column_name = 'telegram_id'"
                )
            ).scalar()
            if current_type == "integer":
                conn.execute(text("ALTER TABLE users ALTER COLUMN telegram_id TYPE BIGINT"))
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
        # recovery_email had no migration; an api-ts drizzle push --force dropped it from
        # the shared DB, so passkey register/complete (and any User SELECT) 500'd with
        # "column users.recovery_email does not exist". Restore it idempotently.
        ("recovery_email", "VARCHAR(255)", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE users ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _reconcile_user_columns(db_engine, is_sqlite: bool) -> None:
    """Add any User-model column missing from the live ``users`` table.

    The shared Postgres has had python-owned columns (recovery_email,
    recovery_setup_at, …) dropped by api-ts ``drizzle-kit push --force``. Rather than
    chase each one with a bespoke migration, add any column the SQLAlchemy model
    declares but the table lacks — as NULLABLE, best-effort, per-column guarded — so a
    plain ``SELECT * FROM users`` (every User query) can never 500 on a missing column.
    """
    from bot.models.user import User

    try:
        insp = inspect(db_engine)  # fresh inspector: reflect columns added earlier this run
        existing = {c["name"] for c in insp.get_columns("users")}
    except Exception as e:
        logger.warning(f"_reconcile_user_columns: could not read users columns: {e}")
        return

    for col in User.__table__.columns:
        if col.name in existing:
            continue
        try:
            coltype = col.type.compile(dialect=db_engine.dialect)
            if is_sqlite:
                ddl = f'ALTER TABLE users ADD COLUMN "{col.name}" {coltype}'
            else:
                ddl = f'ALTER TABLE users ADD COLUMN IF NOT EXISTS "{col.name}" {coltype}'
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.warning(f"Reconciled missing users column: {col.name} {coltype}")
        except Exception as e:
            logger.warning(f"_reconcile_user_columns: could not add {col.name}: {e}")


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
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_users_passkey_credential_id "
                "ON users(passkey_credential_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_users_passkey_user_handle "
                "ON users(passkey_user_handle)"
            )
        )


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


def _add_swap_error_category_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add the classified failure-cause column to swap_transactions.

    Populated from error_guidance.classify_swap_failure for analytics on why
    swaps fail (gas, balance, slippage, simulation revert, timeout, etc.).
    """
    cols = {c["name"] for c in inspector.get_columns("swap_transactions")}

    if "error_category" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE swap_transactions ADD COLUMN error_category VARCHAR(40)"
        else:
            ddl = (
                "ALTER TABLE swap_transactions ADD COLUMN IF NOT EXISTS error_category VARCHAR(40)"
            )
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


def _add_user_settings_proactive_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add proactive-alerts opt-in flag to user_settings (DEFAULT OFF)."""
    cols = {c["name"] for c in inspector.get_columns("user_settings")}

    if "proactive_alerts_enabled" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE user_settings ADD COLUMN proactive_alerts_enabled BOOLEAN DEFAULT FALSE"
        else:
            ddl = "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS proactive_alerts_enabled BOOLEAN DEFAULT FALSE"
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
                ddl = (
                    f"ALTER TABLE user_settings ADD COLUMN {col_name} {col_type} DEFAULT {default}"
                )
            else:
                ddl = f"ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))


def _add_user_settings_trading_prefs(db_engine, inspector, is_sqlite: bool) -> None:
    """Add trading preference columns to user_settings table idempotently.

    Adds:
    - tx_speed_preset: transaction priority-fee preset (slow/normal/fast), default 'normal'
    - default_output_token: user's preferred sell-to token (e.g. USDC), nullable
    """
    cols = {c["name"] for c in inspector.get_columns("user_settings")}

    new_columns = [
        ("tx_speed_preset", "VARCHAR(10)", "'normal'"),
        ("default_output_token", "VARCHAR(20)", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = (
                    f"ALTER TABLE user_settings ADD COLUMN {col_name} {col_type} DEFAULT {default}"
                )
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


def _add_prediction_redeem_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add on-chain redemption columns to prediction_positions idempotently.

    Resolved winning Polymarket positions are surfaced as "Claimable" until the
    user redeems them on-chain (CTF/NegRiskAdapter ``redeemPositions``). These
    columns track that redemption so a claimed position drops off the list and
    its redeem tx is traceable. Additive + idempotent — safe to run repeatedly.
    """
    cols = {c["name"] for c in inspector.get_columns("prediction_positions")}

    new_columns = [
        ("claimed", "BOOLEAN", "FALSE"),
        ("redeem_tx_hash", "VARCHAR(255)", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                # SQLite has no boolean literal; 0/NULL map cleanly.
                sqlite_default = "0" if col_type == "BOOLEAN" else default
                ddl = (
                    f"ALTER TABLE prediction_positions ADD COLUMN "
                    f"{col_name} {col_type} DEFAULT {sqlite_default}"
                )
            else:
                ddl = (
                    f"ALTER TABLE prediction_positions ADD COLUMN IF NOT EXISTS "
                    f"{col_name} {col_type} DEFAULT {default}"
                )
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


def _add_turnkey_columns(
    db_engine, inspector, table_name: str, is_sqlite: bool, include_sub_org: bool = False
) -> None:
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
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_swap_transactions_agent_id "
                "ON swap_transactions(agent_id)"
            )
        )


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
                ddl = (
                    f"ALTER TABLE x402_payments ADD COLUMN {col_name} {col_type} DEFAULT {default}"
                )
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

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_quests_date ON daily_quests(date)"))

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

        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_user_quests_user_id ON user_quests(user_id)")
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_user_quests_user_quest ON user_quests(user_id, quest_id)"
            )
        )

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

        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_jackpot_pools_date ON jackpot_pools(date)")
        )


def _create_agent_billing_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create agent pay-per-call billing tables idempotently.

    Backs the x402 prepaid-credit metering + crypto-native subscription surface
    (api-ts middleware/x402Payment.ts and routes/agent.ts). These are defined in
    api-ts's Drizzle schema, but drizzle-kit is tablesFilter-scoped away from
    shared/python-owned tables, so python-api (the authority for the shared DB)
    must create them here. Additive + idempotent.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        # --- agent_credits (prepaid balance; 1 credit ~= $0.001 USD) ---
        if "agent_credits" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS agent_credits (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        agent_id INTEGER NOT NULL UNIQUE,
                        balance REAL NOT NULL DEFAULT 0,
                        lifetime_purchased REAL NOT NULL DEFAULT 0,
                        lifetime_used REAL NOT NULL DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS agent_credits (
                        id SERIAL PRIMARY KEY,
                        agent_id INTEGER NOT NULL UNIQUE,
                        balance REAL NOT NULL DEFAULT 0,
                        lifetime_purchased REAL NOT NULL DEFAULT 0,
                        lifetime_used REAL NOT NULL DEFAULT 0,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                """))

        # --- agent_credit_topups (on-chain USDC topup ledger; idempotent on tx_hash) ---
        if "agent_credit_topups" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS agent_credit_topups (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        agent_id INTEGER NOT NULL,
                        tx_hash VARCHAR(128) NOT NULL UNIQUE,
                        chain VARCHAR(32) NOT NULL DEFAULT 'base',
                        amount_usd REAL NOT NULL,
                        credits_added REAL NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS agent_credit_topups (
                        id SERIAL PRIMARY KEY,
                        agent_id INTEGER NOT NULL,
                        tx_hash VARCHAR(128) NOT NULL UNIQUE,
                        chain VARCHAR(32) NOT NULL DEFAULT 'base',
                        amount_usd REAL NOT NULL,
                        credits_added REAL NOT NULL,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                """))

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_agent_credit_topups_agent_id "
                "ON agent_credit_topups(agent_id)"
            )
        )

        # --- agent_subscriptions (USDC -> time-bound tier; idempotent on tx_hash) ---
        if "agent_subscriptions" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS agent_subscriptions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        agent_id INTEGER NOT NULL UNIQUE,
                        tier VARCHAR(20) NOT NULL,
                        tx_hash VARCHAR(128) NOT NULL UNIQUE,
                        chain VARCHAR(32) NOT NULL DEFAULT 'base',
                        amount_usd REAL NOT NULL,
                        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        expires_at DATETIME NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS agent_subscriptions (
                        id SERIAL PRIMARY KEY,
                        agent_id INTEGER NOT NULL UNIQUE,
                        tier VARCHAR(20) NOT NULL,
                        tx_hash VARCHAR(128) NOT NULL UNIQUE,
                        chain VARCHAR(32) NOT NULL DEFAULT 'base',
                        amount_usd REAL NOT NULL,
                        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        expires_at TIMESTAMP NOT NULL,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                """))

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_agent_subscriptions_agent_id "
                "ON agent_subscriptions(agent_id)"
            )
        )


def _create_recurring_subscriptions_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the recurring_subscriptions table idempotently.

    Backs true crypto auto-renew via Base Spend Permissions (api-ts
    lib/spendPermission.ts + RecurringBillingService). Stores the user-signed
    SpendPermission + signature so the operator can periodically call spend().
    Amounts/timestamps that exceed JS/SQL int range (uint160/uint256) are stored
    as decimal strings. Additive + idempotent (authoritative shared-DB path).
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "recurring_subscriptions" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS recurring_subscriptions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER,
                        agent_id INTEGER,
                        account VARCHAR(64) NOT NULL,
                        spender VARCHAR(64) NOT NULL,
                        token VARCHAR(64) NOT NULL,
                        allowance VARCHAR(80) NOT NULL,
                        period_seconds INTEGER NOT NULL,
                        start_ts INTEGER NOT NULL,
                        end_ts INTEGER NOT NULL,
                        salt VARCHAR(80) NOT NULL,
                        signature TEXT NOT NULL,
                        tier VARCHAR(20),
                        status VARCHAR(20) NOT NULL DEFAULT 'active',
                        approved_tx VARCHAR(128),
                        next_charge_at DATETIME,
                        last_charge_at DATETIME,
                        last_charge_tx VARCHAR(128),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS recurring_subscriptions (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER,
                        agent_id INTEGER,
                        account VARCHAR(64) NOT NULL,
                        spender VARCHAR(64) NOT NULL,
                        token VARCHAR(64) NOT NULL,
                        allowance VARCHAR(80) NOT NULL,
                        period_seconds BIGINT NOT NULL,
                        start_ts BIGINT NOT NULL,
                        end_ts BIGINT NOT NULL,
                        salt VARCHAR(80) NOT NULL,
                        signature TEXT NOT NULL,
                        tier VARCHAR(20),
                        status VARCHAR(20) NOT NULL DEFAULT 'active',
                        approved_tx VARCHAR(128),
                        next_charge_at TIMESTAMP,
                        last_charge_at TIMESTAMP,
                        last_charge_tx VARCHAR(128),
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                """))

        # Idempotency: one row per (account, spender, token, salt) permission.
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_recurring_subscriptions_permission "
                "ON recurring_subscriptions(account, spender, token, salt)"
            )
        )
        # Scheduler query: due active charges.
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_recurring_subscriptions_due "
                "ON recurring_subscriptions(status, next_charge_at)"
            )
        )


def _add_copy_trade_paper_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add paper_entry_price_usd to copy_trades table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("copy_trades")}
    if "paper_entry_price_usd" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE copy_trades ADD COLUMN paper_entry_price_usd FLOAT"
        else:
            ddl = "ALTER TABLE copy_trades ADD COLUMN IF NOT EXISTS paper_entry_price_usd FLOAT"
        with db_engine.begin() as conn:
            conn.execute(text(ddl))


def _add_copy_trading_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add enhanced copy trading columns to copy_follows table idempotently."""
    cols = {c["name"] for c in inspector.get_columns("copy_follows")}

    new_columns = [
        ("auto_sell_enabled", "BOOLEAN", "TRUE"),
        ("chains_filter", "VARCHAR(200)", "NULL"),
        ("min_trade_usd", "FLOAT", "NULL"),
        ("min_wallet_pnl_pct", "FLOAT", "NULL"),
        ("min_token_age_hours", "FLOAT", "NULL"),
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
_db_executor = ThreadPoolExecutor(max_workers=24, thread_name_prefix="db")


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


def _add_user_settings_granular_notify_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add granular per-event notification preference columns to user_settings (idempotent)."""
    cols = {c["name"] for c in inspector.get_columns("user_settings")}

    new_columns = [
        ("notify_copy_executed", "BOOLEAN", "TRUE"),
        ("notify_order_triggered", "BOOLEAN", "TRUE"),
        ("notify_portfolio_milestone", "BOOLEAN", "FALSE"),
        ("notify_risk_event", "BOOLEAN", "TRUE"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = (
                    f"ALTER TABLE user_settings ADD COLUMN {col_name} {col_type} DEFAULT {default}"
                )
            else:
                ddl = f"ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
