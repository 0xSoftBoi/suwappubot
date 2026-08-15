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
        from bot.models.referral import (
            Referral,
            ReferralCode,
            ReferralReward,
            ReferralPayout,
            ReferralEarning,
            ReferralMilestone,
        )

        # Community payment-tool models (Bucket 2: tips, lucky boxes, split bills, airdrops)
        from bot.models.community import (
            Tip,
            LuckyBox,
            LuckyBoxClaim,
            SplitBill,
            SplitBillShare,
            AirdropCampaign,
            AirdropClaim,
        )

        # Gamified trading models (Bucket 3: directional battles)
        from bot.models.battle import Battle

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

        # On-chain fee-cashback rewards (weekly Merkle epochs)
        from bot.models.onchain_rewards import RewardEpoch, RewardEntry
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

        # Public JellyJelly creator-account claims. Only proof metadata and a
        # canonical source ID are stored; source media remains at JellyJelly.
        from bot.models.social import JellyAccountClaim

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

        # Handle-reservation waitlist + referral leaderboard
        from bot.models.waitlist import WaitlistSignup

        # Token staking models
        from bot.models.token_staking import (
            TokenClaim,
            StakingPosition,
            DistributionEpoch,
            EpochReward,
            TreasuryPosition,
        )

        # Support/bug ticket model — new table, create_all picks it up once imported.
        from bot.models.support import SupportTicket

        # Custodial balances/hot wallets, favorites/settings, and Tempo access keys —
        # queried at runtime (bot/services/hot_wallet.py, favorites.py, tempo_keychain.py)
        # but never previously imported here, so create_all never created their tables.
        from bot.models.custodial import (
            CustodialBalance,
            CustodialTransaction,
            HotWallet,
            GasSponsorshipConfig,
            UserGasUsage,
        )
        from bot.models.favorites import FavoriteSwapPair, PriceAlert, UserSettings
        from bot.models.tempo_access_key import TempoAccessKey

        # Token Intel / Dev Tracking — watched deployers + detected new deploys
        from bot.models.intel import DeployerWatch, DeployerWatchHit

        # AEGIS per-user trust adaptation (Phase 2.3 of docs/plans/aegis-fork-extend.md)
        from bot.models.aegis_trust import AegisUserTrust

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

    # --- custodial_transactions idempotency (withdraw replay protection) ---
    if "custodial_transactions" in tables:
        cols = {c["name"] for c in inspector.get_columns("custodial_transactions")}

        if "idempotency_key" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE custodial_transactions ADD COLUMN idempotency_key VARCHAR(128)"
            else:
                ddl = (
                    "ALTER TABLE custodial_transactions "
                    "ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128)"
                )
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

        # Unique index to enforce withdraw idempotency (NULLs allowed)
        with db_engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ux_custodial_transactions_idempotency_key "
                    "ON custodial_transactions(idempotency_key)"
                )
            )

    # --- custodial_transactions idempotency: scope to (user_id, key) ---
    # A GLOBAL unique index on idempotency_key (above) lets one user's client-
    # chosen key collide with another user's, leaking their tx hash/status on
    # a 409 and letting one user DoS another's withdraw key. Supersede it with
    # a composite UNIQUE(user_id, idempotency_key) index instead. Additive +
    # idempotent: dropping the old index only removes the (now redundant,
    # more-restrictive) global constraint; the new composite index still
    # enforces per-user dedupe and NULLs remain allowed for non-withdrawal
    # transaction types.
    if "custodial_transactions" in tables:
        cols = {c["name"] for c in inspector.get_columns("custodial_transactions")}
        if "idempotency_key" in cols and "user_id" in cols:
            with db_engine.begin() as conn:
                conn.execute(text("DROP INDEX IF EXISTS ux_custodial_transactions_idempotency_key"))
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS "
                        "ux_custodial_transactions_user_idempotency_key "
                        "ON custodial_transactions(user_id, idempotency_key)"
                    )
                )
                # Speeds up the PENDING-withdrawal reconciler's periodic scan.
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_custodial_transactions_status_type "
                        "ON custodial_transactions(status, tx_type)"
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

    # --- oauth_states: login CSRF nonce column (additive + idempotent) ---
    if "oauth_states" in tables:
        oauth_state_cols = {c["name"] for c in inspector.get_columns("oauth_states")}
        if "login_nonce" not in oauth_state_cols:
            if is_sqlite:
                ddl = "ALTER TABLE oauth_states ADD COLUMN login_nonce VARCHAR(128)"
            else:
                ddl = "ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS login_nonce VARCHAR(128)"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

    # --- users: signature-proved membership binding address (additive) ---
    if "users" in tables:
        user_cols = {c["name"] for c in inspector.get_columns("users")}
        if "membership_address" not in user_cols:
            if is_sqlite:
                ddl = "ALTER TABLE users ADD COLUMN membership_address VARCHAR(64)"
            else:
                ddl = "ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_address VARCHAR(64)"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

    # --- users.membership_address: one wallet backs at most one account ---
    # Without this a single paid membership NFT could be signed for unlimited
    # accounts (the signature proves key possession, not identity), handing every
    # one of them ENTERPRISE fee rates off one purchase.
    if "users" in tables:
        idx_names = {i["name"] for i in inspector.get_indexes("users")}
        # Indexed on lower(...), not the raw column. A plain unique index is
        # CASE-SENSITIVE, so 0xab..ab and 0xAB..AB both insert and two accounts
        # share one wallet — the exact thing this index exists to stop. It held
        # only because bindwallet.py lowercases before writing, i.e. one caller
        # remembering. Any other writer (admin tool, API route, import) that
        # forgets reopens the vector silently. Enforce it in the database.
        if "ux_users_membership_address_lower" not in idx_names:
            with db_engine.begin() as conn:
                # Normalise first: a pre-existing mixed-case row would fail the
                # index creation below and block startup.
                conn.execute(
                    text(
                        "UPDATE users SET membership_address = lower(membership_address) "
                        "WHERE membership_address IS NOT NULL "
                        "AND membership_address <> lower(membership_address)"
                    )
                )
                # Clear any duplicates created before the constraint existed —
                # keep the lowest user id, unbind the rest (they can re-bind).
                conn.execute(
                    text(
                        "UPDATE users SET membership_address = NULL "
                        "WHERE membership_address IS NOT NULL AND id NOT IN ("
                        "  SELECT MIN(id) FROM users WHERE membership_address IS NOT NULL"
                        "  GROUP BY lower(membership_address))"
                    )
                )
                conn.execute(text("DROP INDEX IF EXISTS ux_users_membership_address"))
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS "
                        "ux_users_membership_address_lower "
                        "ON users (lower(membership_address))"
                    )
                )

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
        _add_swap_realized_output_columns(db_engine, inspector, is_sqlite)

    # --- user_settings: MEV protection column + quick trade presets ---
    if "user_settings" in tables:
        _add_user_settings_mev_column(db_engine, inspector, is_sqlite)
        _add_quicktrade_columns(db_engine, inspector, is_sqlite)
        _add_user_settings_trading_prefs(db_engine, inspector, is_sqlite)
        _add_user_settings_proactive_column(db_engine, inspector, is_sqlite)
        _add_user_settings_granular_notify_columns(db_engine, inspector, is_sqlite)

    # --- referral_rewards: multi-tier column ---
    _add_referral_tier_column(db_engine, inspector, is_sqlite)

    # --- referral v2 columns ---
    _add_referral_v2_columns(db_engine, inspector, is_sqlite)

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
    # MUST run after the CREATEs above, and needs a fresh inspector so it sees
    # tables this boot just created. Was previously nested in the unrelated
    # `if "users" in tables:` block and ran BEFORE them — a no-op on a fresh DB
    # purely by luck, since the CREATE DDL already emits DOUBLE PRECISION.
    _widen_money_columns_to_double(db_engine, inspect(db_engine), is_sqlite)

    # --- recurring crypto subscriptions (Base Spend Permissions) ---
    _create_recurring_subscriptions_table(db_engine, inspector, is_sqlite)

    # --- execution intelligence: swap_route_candidates + swap_execution_marks ---
    _create_swap_route_candidates_table(db_engine, inspector, is_sqlite)
    _create_swap_execution_marks_table(db_engine, inspector, is_sqlite)
    _backfill_execution_timestamp_defaults(db_engine, inspector, is_sqlite)

    # --- copy_follows: enhanced copy trading columns ---
    if "copy_follows" in tables:
        _add_copy_trading_columns(db_engine, inspector, is_sqlite)

    # --- copy_trades: paper mode entry price ---
    if "copy_trades" in tables:
        _add_copy_trade_paper_column(db_engine, inspector, is_sqlite)

    # --- advanced_price_alerts: suggested swap action columns ---
    if "advanced_price_alerts" in tables:
        _add_alert_action_columns(db_engine, inspector, is_sqlite)

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
        _add_subscription_stripe_customer_id(db_engine, inspector, is_sqlite)

    # --- audit_logs: org_id / agent_id columns (org-scoped audit trail) ---
    if "audit_logs" in tables:
        _add_audit_org_agent_columns(db_engine, inspector, is_sqlite)

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
    _add_cctp_generic_deposit_columns(db_engine, inspector, is_sqlite)
    _add_bridge_transfer_tables(db_engine, inspector, is_sqlite)
    _add_user_region_column(db_engine, inspector, is_sqlite)
    _add_user_language_preference_column(db_engine, inspector, is_sqlite)
    _add_user_llm_model_column(db_engine, inspector, is_sqlite)
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
    else:
        # Additive: resolved payout addresses captured at trade creation so native
        # escrow settlement never relies on free-text operator input. Idempotent.
        cols = {c["name"] for c in inspector.get_columns("p2p_trades")}
        for col_name in ("buyer_address", "seller_address"):
            if col_name in cols:
                continue
            if is_sqlite:
                ddl = f"ALTER TABLE p2p_trades ADD COLUMN {col_name} VARCHAR(255)"
            else:
                ddl = f"ALTER TABLE p2p_trades ADD COLUMN IF NOT EXISTS {col_name} VARCHAR(255)"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info(f"Added p2p_trades.{col_name}")
        # Additive: dispute/arbitration columns. Idempotent, typed per column.
        for col_name, col_type in (
            ("dispute_reason", "TEXT"),
            ("disputed_at", "TIMESTAMP"),
            ("disputed_by", "BIGINT"),
            ("dispute_resolution", "VARCHAR(16)"),
            ("resolved_by", "BIGINT"),
            ("resolved_at", "TIMESTAMP"),
            ("resolution_note", "TEXT"),
        ):
            if col_name in cols:
                continue
            if is_sqlite:
                ddl = f"ALTER TABLE p2p_trades ADD COLUMN {col_name} {col_type}"
            else:
                ddl = f"ALTER TABLE p2p_trades ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info(f"Added p2p_trades.{col_name}")

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

    # --- multi-stream referral: referral_earnings ledger + referral_milestones ---
    _create_referral_earnings_table(db_engine, inspector, is_sqlite)
    _create_referral_milestones_table(db_engine, inspector, is_sqlite)

    # --- referrals: verified_at + perps_volume_14d_usd columns ---
    if "referrals" in tables:
        _add_referral_stream_columns(db_engine, inspector, is_sqlite)

    # --- Bucket 2: community payment tools ---
    _create_tips_table(db_engine, inspector, is_sqlite)
    _create_lucky_boxes_tables(db_engine, inspector, is_sqlite)
    _create_split_bills_tables(db_engine, inspector, is_sqlite)
    _create_airdrop_tables(db_engine, inspector, is_sqlite)

    # --- Bucket 3: gamified trading battles ---
    _create_battles_table(db_engine, inspector, is_sqlite)

    # --- On-chain fee-cashback rewards (weekly Merkle epochs) ---
    _create_onchain_rewards_tables(db_engine, inspector, is_sqlite)

    # --- Token Intel / Dev Tracking: deployer_watches, deployer_watch_hits ---
    _create_token_intel_tables(db_engine, inspector, is_sqlite)

    # --- AEGIS per-user trust adaptation (Phase 2.3): aegis_user_trust ---
    _create_aegis_trust_table(db_engine, inspector, is_sqlite)

    # --- Agent control-plane approval notification bookkeeping ---
    _add_approval_requests_notify_columns(db_engine, inspector, is_sqlite)
    _create_agent_webhook_deliveries_table(db_engine, inspector, is_sqlite)

    # --- Agent ownership linking (/claim, /unlink): agents.owner_user_id + agent_link_codes ---
    _add_agents_owner_user_id_column(db_engine, inspector, is_sqlite)
    _create_agent_link_codes_table(db_engine, inspector, is_sqlite)

    # --- Handle-reservation waitlist + referral leaderboard: waitlist_signups ---
    _create_waitlist_signups_table(db_engine, inspector, is_sqlite)

    # --- swap_transactions: widen from_token/to_token for rug panic-sell mints ---
    if "swap_transactions" in tables:
        _widen_swap_token_columns(db_engine, inspector, is_sqlite)

    # --- point_redemptions: idempotency_key for durable redeem-replay guard ---
    if "point_redemptions" in tables:
        _add_point_redemption_idempotency_key(db_engine, inspector, is_sqlite)

    # --- Market data parity Phase 1: normalized OHLCV candles ---
    _create_market_candles_table(db_engine, inspector, is_sqlite)

    # --- API usage metering: per-caller/route/day request counts ---
    _create_api_usage_daily_table(db_engine, inspector, is_sqlite)

    # --- Market data parity Round 5: perps / predictions / lend time series ---
    _create_perp_metrics_table(db_engine, inspector, is_sqlite)
    _create_prediction_snapshots_table(db_engine, inspector, is_sqlite)
    _create_lend_metrics_table(db_engine, inspector, is_sqlite)

    # --- markets.xyz parity GAP 3: verified trade feed (/feed) ---
    if "trader_profiles" in tables:
        _add_trader_profiles_feed_opt_out_column(db_engine, inspector, is_sqlite)
    if "trader_trades" in tables:
        _add_trader_trades_created_at_index(db_engine, inspector, is_sqlite)

    # --- markets.xyz parity GAP 1/2: HIP-3 builder-dex perp positions/orders ---
    if "perp_positions" in tables:
        _add_perp_positions_dex_column(db_engine, inspector, is_sqlite)
    if "perp_orders" in tables:
        _add_perp_orders_dex_column(db_engine, inspector, is_sqlite)


def _widen_swap_token_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Widen swap_transactions.from_token/to_token from VARCHAR(20) to VARCHAR(64).

    MONEY-PATH (rug panic sell): rug_service's auto-sell writes a raw base58
    Solana mint address (43-44 chars) into from_token/to_token when selling an
    unregistered/rugged token — the old VARCHAR(20) column raised
    psycopg2.errors.StringDataRightTruncation on Postgres (INSERT), which killed
    the panic-sell SwapTransaction write and, by extension, the whole sell.
    SQLite ignores VARCHAR length so this was invisible in tests.

    Additive + idempotent: ALTER COLUMN ... TYPE VARCHAR(64) is safe to widen
    repeatedly, and never truncates/loses existing data since we're only
    growing the column. SQLite is skipped — same "ignores VARCHAR length"
    reasoning as `_widen_totp_secret`.

    RUNS AT EVERY BOOT, so it must issue ZERO DDL once migrated (mirrors
    `_widen_money_columns_to_double`): inspect widths first, build a pending
    list, and early-return when nothing needs widening. The two ALTERs run in
    a single transaction bounded by `SET LOCAL lock_timeout` so a contended
    boot fails fast and retries next boot instead of hanging behind a live
    writer and getting the container killed mid-DDL.
    """
    if is_sqlite:
        return

    try:
        cols = {c["name"]: c for c in inspector.get_columns("swap_transactions")}
    except Exception as e:
        logger.error("Could not inspect swap_transactions columns: %s", e)
        return

    pending: list[str] = []
    for column in ("from_token", "to_token"):
        info = cols.get(column)
        if info is None:
            continue
        col_type = info.get("type")
        length = getattr(col_type, "length", None)
        # Only widen VARCHAR columns whose length is known and still < 64.
        # A None length (e.g. already TEXT) or length >= 64 is already fine.
        if length is not None and length < 64:
            pending.append(column)

    if not pending:
        return

    try:
        with db_engine.begin() as conn:
            # Fail fast instead of queueing behind a live swap write and
            # taking the panic-sell path down with us. Unapplied columns are
            # simply retried next boot.
            conn.execute(text("SET LOCAL lock_timeout = '3s'"))
            for column in pending:
                conn.execute(
                    text(f"ALTER TABLE swap_transactions ALTER COLUMN {column} TYPE VARCHAR(64)")
                )
        logger.info("Widened swap_transactions column(s) to VARCHAR(64): %s", ", ".join(pending))
    except Exception as e:
        msg = str(e).lower()
        if "lock timeout" in msg or "55p03" in msg or "canceling statement due to lock" in msg:
            # Contended boot — not a real failure. Retry on next boot.
            logger.warning(
                "Widening swap_transactions.%s to VARCHAR(64) timed out waiting for a "
                "lock; will retry on next boot: %s",
                ", ".join(pending),
                e,
            )
        else:
            logger.error(
                "Could not widen swap_transactions.%s to VARCHAR(64): %s",
                ", ".join(pending),
                e,
            )


def _add_point_redemption_idempotency_key(db_engine, inspector, is_sqlite: bool) -> None:
    """Add point_redemptions.idempotency_key + a partial UNIQUE(user_id, key) index.

    MONEY-PATH: durable replay guard for `/v1/mobile/points/rewards/{id}/redeem`.
    The route already has an in-process idempotency cache (mobile.py), which is
    NOT durable across worker restarts / multi-replica deploys — a retry landing
    on a different process re-invokes points_service and double-charges points
    for a redemption whose first response merely dropped in transit. This DB-level
    unique index makes a replayed INSERT conflict (IntegrityError) instead of
    silently creating a second PointRedemption row, so the caller can catch the
    conflict and return the original result.

    Additive + idempotent: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT
    EXISTS. Partial index (WHERE idempotency_key IS NOT NULL) so historical rows
    and non-idempotent redemption paths (NULL key) are unaffected.
    """
    try:
        cols = {c["name"] for c in inspector.get_columns("point_redemptions")}
        if "idempotency_key" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE point_redemptions ADD COLUMN idempotency_key VARCHAR(160)"
            else:
                ddl = (
                    "ALTER TABLE point_redemptions "
                    "ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160)"
                )
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

        with db_engine.begin() as conn:
            # Both SQLite (>=3.8) and Postgres support partial unique indexes.
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS "
                    "ux_point_redemptions_user_idempotency_key "
                    "ON point_redemptions(user_id, idempotency_key) "
                    "WHERE idempotency_key IS NOT NULL"
                )
            )
    except Exception as e:
        logger.error("Could not add point_redemptions idempotency guard: %s", e)


def _create_waitlist_signups_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the waitlist_signups table (idempotent).

    Backs the handle-reservation waitlist + live referral leaderboard
    (``/webapp/waitlist/*`` in api/webapp.py — see bot/services/waitlist_service.py
    for the ranking query). Distinct from the mobile-app waitlist which rides
    ``support_tickets`` (category="mobile_waitlist") and is left untouched.

    One row per email (unique). ``referred_by_id`` is a self-referential pointer
    to another row's id; ``referral_count`` is never denormalized here — it is
    always computed live via COUNT(*) WHERE referred_by_id = id so it cannot drift.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "waitlist_signups" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS waitlist_signups (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        handle VARCHAR(32) NOT NULL,
                        email VARCHAR(320) NOT NULL,
                        telegram VARCHAR(64),
                        referral_code VARCHAR(40) NOT NULL,
                        referred_by_id INTEGER,
                        seed INTEGER NOT NULL,
                        attribution_json TEXT,
                        ip_hash VARCHAR(64),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS waitlist_signups (
                        id SERIAL PRIMARY KEY,
                        handle VARCHAR(32) NOT NULL,
                        email VARCHAR(320) NOT NULL,
                        telegram VARCHAR(64),
                        referral_code VARCHAR(40) NOT NULL,
                        referred_by_id INTEGER,
                        seed INTEGER NOT NULL,
                        attribution_json TEXT,
                        ip_hash VARCHAR(64),
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created waitlist_signups table")

        # Unique indexes: one handle, one email, one referral code per row.
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_waitlist_signups_handle"
                " ON waitlist_signups(handle)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_waitlist_signups_email"
                " ON waitlist_signups(email)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_waitlist_signups_referral_code"
                " ON waitlist_signups(referral_code)"
            )
        )
        # Non-unique: referral edges lookup + rank-query tie-break support.
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_waitlist_signups_referred_by"
                " ON waitlist_signups(referred_by_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_waitlist_signups_created_id"
                " ON waitlist_signups(created_at, id)"
            )
        )


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
    """Create the CCTP deposit-relay tables idempotently.

    Money-path note: bot.models.cctp.CctpGenericDeposit was previously ONLY
    ever created as a side effect of api/main.py importing
    bot.services.cctp_generic_relayer before init_db ran. Any entrypoint that
    calls init_db without that import (bot-only process, worker, script,
    test bootstrap) silently skipped this table -- and record_burn() would
    then raise "relation does not exist" on a burn that already landed
    on-chain, i.e. an unrecoverable burn. Both models are now created here
    explicitly, and a creation failure is logged loudly (not swallowed to a
    generic warning) because that failure mode is unmintable USDC.
    """
    from bot.models.cctp import CctpDeposit, CctpGenericDeposit

    for model in (CctpDeposit, CctpGenericDeposit):
        try:
            if not inspector.has_table(model.__tablename__):
                model.__table__.create(bind=db_engine)
                logger.info(f"Created {model.__tablename__} table")
        except Exception as e:
            logger.error(
                f"CRITICAL: failed to create {model.__tablename__} table -- CCTP burns "
                f"recorded against this table will raise and cannot be relayed until this "
                f"is fixed: {e}"
            )


def _add_bridge_transfer_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the user-facing bridge_transfers table idempotently.

    Same reasoning as _add_cctp_tables: the row is created before the user
    signs anything, so if the table is missing the build call fails and no
    transaction is broadcast. That is the safe direction, but it is a hard
    outage for the bridge flow, so log a creation failure loudly rather than
    letting it pass as a warning.
    """
    from bot.models.bridge import BridgeTransfer

    try:
        if not inspector.has_table(BridgeTransfer.__tablename__):
            BridgeTransfer.__table__.create(bind=db_engine)
            logger.info(f"Created {BridgeTransfer.__tablename__} table")
    except Exception as e:
        logger.error(
            f"CRITICAL: failed to create {BridgeTransfer.__tablename__} table -- the bridge "
            f"flow cannot record transfers and will refuse to build them until this is "
            f"fixed: {e}"
        )


def _add_cctp_generic_deposit_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Additive columns for the generic-rail relayer's claim/lease + stall tracking.

    stall_count: transient/insufficient-gas errors (never terminal by count alone).
    claimed_at/claimed_by: lease so two relayer replicas never both broadcast the
        same receiveMessage (SELECT ... FOR UPDATE SKIP LOCKED claim, see
        CctpGenericRelayer._pending).
    """
    table = "cctp_generic_deposits"
    if not inspector.has_table(table):
        return
    try:
        cols = {c["name"] for c in inspector.get_columns(table)}
        additions = [
            ("stall_count", "INTEGER DEFAULT 0"),
            ("claimed_at", "TIMESTAMP"),
            ("claimed_by", "VARCHAR(120)"),
        ]
        with db_engine.begin() as conn:
            for name, coltype in additions:
                if name in cols:
                    continue
                if is_sqlite:
                    ddl = f"ALTER TABLE {table} ADD COLUMN {name} {coltype}"
                else:
                    ddl = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {coltype}"
                conn.execute(text(ddl))
                logger.info(f"Added {table}.{name}")
    except Exception as e:
        logger.error(
            f"CRITICAL: failed to add claim/stall columns to {table}: {e} -- the generic "
            "CCTP relayer's replica-safety and backoff logic will not work correctly until "
            "this is fixed."
        )


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


def _add_user_llm_model_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add users.llm_model for per-user LLM model preference, idempotently."""
    try:
        cols = {c["name"] for c in inspector.get_columns("users")}
        if "llm_model" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE users ADD COLUMN llm_model VARCHAR(64)"
            else:
                ddl = "ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_model VARCHAR(64)"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info("Added users.llm_model")
    except Exception as e:
        logger.warning(f"Failed to add users.llm_model: {e}")


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


def _add_subscription_stripe_customer_id(db_engine, inspector, is_sqlite: bool) -> None:
    """Add stripe_customer_id to subscriptions idempotently.

    api-ts stamps this from the Stripe checkout webhook so the web dashboard can
    open a Stripe billing portal session (invoices, payment methods, cancel).
    `subscriptions` is python-owned, so the column is added here rather than by
    drizzle-kit.
    """
    cols = {c["name"] for c in inspector.get_columns("subscriptions")}
    if "stripe_customer_id" in cols:
        return

    if is_sqlite:
        ddl = "ALTER TABLE subscriptions ADD COLUMN stripe_customer_id VARCHAR(64)"
    else:
        ddl = "ALTER TABLE subscriptions " "ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(64)"
    with db_engine.begin() as conn:
        conn.execute(text(ddl))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_subscriptions_stripe_customer_id "
                "ON subscriptions (stripe_customer_id)"
            )
        )


def _add_audit_org_agent_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add org_id / agent_id columns + indexes to audit_logs idempotently.

    api-ts (PolicyService / auditLog) writes these for the org-scoped audit
    trail. audit_logs is python-owned, so the columns are added here rather
    than via drizzle (which is scoped away from python tables).
    """
    cols = {c["name"] for c in inspector.get_columns("audit_logs")}

    new_columns = [
        ("org_id", "UUID" if not is_sqlite else "VARCHAR(36)"),
        ("agent_id", "VARCHAR(64)"),
    ]

    for col_name, col_type in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE audit_logs ADD COLUMN {col_name} {col_type}"
            else:
                ddl = f"ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

    # Indexes for enterprise org-wide / per-agent audit queries.
    if not is_sqlite:
        with db_engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx "
                    "ON audit_logs (org_id, created_at)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS audit_logs_agent_created_idx "
                    "ON audit_logs (agent_id, created_at)"
                )
            )


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


def _widen_money_columns_to_double(db_engine, inspector, is_sqlite: bool) -> None:
    """Widen the agent-billing money columns from REAL (float4) to DOUBLE PRECISION.

    MONEY-PATH. These were created as REAL, which is a 4-byte float with only
    ~7 significant decimal digits — a 24-bit mantissa. That is not enough for a
    running balance debited in sub-cent amounts. At a ~$100 balance the ULP is
    ~7.6e-6, so each ~$0.000728 LLM debit rounds by up to ~3.8e-6. Over 20k
    debits that bounds the error near $0.076; the expected drift is far smaller
    (a random walk, ~$0.0005) and its DIRECTION is not guaranteed. The number to
    care about is not the typical case but the failure mode: once
    balance/debit exceeds 2**24 — a balance over ~$12,200 — a debit can round to
    a complete no-op and the balance stops decreasing at all. Not reachable
    today, not absurd for a funded enterprise agent.

    Widening is safe and lossless: every float4 is exactly representable as a
    float8, so no value changes and no rewrite of meaning occurs. It does NOT
    make the columns exact — float8 is still binary floating point — but it
    removes the precision loss that is actually reachable at our amounts. The
    exact-integer (micro-dollar) representation is the follow-up; this is the
    part that is safe to ship without touching every read site.

    SQLite has a single REAL type that is already 8-byte, so this is a no-op
    there.

    RUNS AT EVERY BOOT, so it must issue ZERO DDL once migrated. float4 -> float8
    is not binary-coercible, so Postgres rewrites the heap and rebuilds indexes
    under ACCESS EXCLUSIVE. Re-issuing a same-type ALTER is *accepted* by
    Postgres but is not free — it still takes that lock. A queued ACCESS
    EXCLUSIVE blocks every reader behind it, so on a busy agent_credits an
    unconditional ALTER could stall startup past the healthcheck, get the
    container killed, and requeue the same lock on restart — a billing outage in
    a restart loop. Hence: skip when the column is already double precision, and
    bound the wait with lock_timeout so a contended boot fails fast and
    retries later instead of hanging.
    """
    if is_sqlite:
        return

    # (table, columns) — every REAL money column created by the agent-billing
    # DDL above. api_credits is created by SQLAlchemy's Float (already float8),
    # so it is deliberately absent — and it must STAY absent: it is not in
    # api-ts's drizzle tablesFilter, so nothing narrows it.
    targets = {
        "agent_credits": ("balance", "lifetime_purchased", "lifetime_used"),
        "agent_credit_topups": ("amount_usd", "credits_added"),
        # Not an accumulating balance, so precision is not reachable here the
        # same way — included so the column matches its api-ts declaration.
        # A declaration that disagrees with the column is the same class of
        # latent bug this function exists to remove.
        "agent_subscriptions": ("amount_usd",),
    }

    existing = set(inspector.get_table_names())
    pending: list[tuple[str, str]] = []
    for table, columns in targets.items():
        if table not in existing:
            continue
        types = {c["name"]: str(c["type"]).upper() for c in inspector.get_columns(table)}
        for column in columns:
            current = types.get(column)
            if current is None:
                continue
            # Already float8 — the steady state. Emit no DDL at all.
            if "DOUBLE" in current or "FLOAT8" in current:
                continue
            pending.append((table, column))

    if not pending:
        return

    # ALL-OR-NOTHING. Per-column failure would leave a half-migrated table
    # (balance float4, lifetime_used float8) that boots green and is visible
    # only in a startup warning nobody greps — and drizzle would then see a
    # partial mismatch. One transaction, so a timeout rolls back cleanly and the
    # next boot retries the whole set.
    try:
        with db_engine.begin() as conn:
            # Fail fast instead of queueing behind a live debit and taking the
            # service down with us. Unapplied columns are simply retried next boot.
            conn.execute(text("SET LOCAL lock_timeout = '3s'"))
            for table, column in pending:
                conn.execute(
                    text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE DOUBLE PRECISION")
                )
        logger.info(
            "Widened %d money column(s) to DOUBLE PRECISION: %s",
            len(pending),
            ", ".join(f"{t}.{c}" for t, c in pending),
        )
    except Exception as e:
        # Never crash boot on DDL. Escalated to ERROR with a stable token so it
        # is alertable — a money column silently left at float4 is not a warning.
        logger.error(
            "MONEY_COLUMN_WIDEN_FAILED: could not widen %s to DOUBLE PRECISION: %s",
            ", ".join(f"{t}.{c}" for t, c in pending),
            e,
        )


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


def _add_referral_v2_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add Referral v2 columns to referrals, referral_codes, and referral_payouts (idempotent)."""
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    # referrals.referee_swap_rebate_remaining — first-5-swaps 10% fee rebate counter.
    # IMPORTANT: The column DEFAULT 5 applies to NEW rows only. All rows that existed
    # before this deploy are backfilled to 0 in the same transaction so pre-existing
    # referees do not receive a free rebate retroactively. Only referees whose Referral
    # row is created AFTER this migration (i.e. new sign-ups) get the default of 5.
    if "referrals" in tables:
        cols = {c["name"] for c in inspector.get_columns("referrals")}
        if "referee_swap_rebate_remaining" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE referrals ADD COLUMN referee_swap_rebate_remaining INTEGER DEFAULT 5"
            else:
                ddl = "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referee_swap_rebate_remaining INTEGER DEFAULT 5"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
                # Backfill all existing rows to 0 — they were created before the rebate
                # feature and must not receive the 5-swap discount retroactively.
                # This UPDATE runs only once: the outer `if col not in cols` guard is
                # skipped on subsequent deploys once the column exists.
                conn.execute(text("UPDATE referrals SET referee_swap_rebate_remaining = 0"))

    # referral_codes.referrer_tier — volume-milestone tier (standard/power/elite)
    if "referral_codes" in tables:
        cols = {c["name"] for c in inspector.get_columns("referral_codes")}
        if "referrer_tier" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE referral_codes ADD COLUMN referrer_tier VARCHAR(20) DEFAULT 'standard'"
            else:
                ddl = "ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS referrer_tier VARCHAR(20) DEFAULT 'standard'"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

    # referral_payouts.needs_review — large-claim flag (>$500 held for manual review)
    if "referral_payouts" in tables:
        cols = {c["name"] for c in inspector.get_columns("referral_payouts")}
        if "needs_review" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE referral_payouts ADD COLUMN needs_review BOOLEAN DEFAULT FALSE"
            else:
                ddl = "ALTER TABLE referral_payouts ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))

    # referral_rewards.payout_id — FK to referral_payouts; set atomically with is_paid=True
    # so reject_referral_claim can find reward rows without timestamp correlation.
    if "referral_rewards" in tables:
        cols = {c["name"] for c in inspector.get_columns("referral_rewards")}
        if "payout_id" not in cols:
            if is_sqlite:
                ddl = "ALTER TABLE referral_rewards ADD COLUMN payout_id INTEGER REFERENCES referral_payouts(id)"
            else:
                ddl = "ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS payout_id INTEGER REFERENCES referral_payouts(id)"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
                # Index for reject-path lookup by payout_id
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_referral_rewards_payout_id "
                        "ON referral_rewards(payout_id)"
                    )
                )


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


def _add_swap_realized_output_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add realized (post-fill) output columns to swap_transactions.

    Everything else on the row is the quote's projection, written before the
    transaction was broadcast. These record what actually settled, which is the
    prerequisite for measuring fill-vs-quote accuracy at all.

    Additive and idempotent, per the runtime-migration contract in
    docs/development/migrations.md — existing rows keep NULL, which reads as
    "not observed" rather than "received nothing".
    """
    cols = {c["name"] for c in inspector.get_columns("swap_transactions")}

    new_columns = [
        ("realized_to_amount", "VARCHAR(78)"),
        ("realized_to_amount_usd", "FLOAT"),
    ]

    for col_name, col_type in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE swap_transactions ADD COLUMN {col_name} {col_type}"
            else:
                ddl = (
                    f"ALTER TABLE swap_transactions ADD COLUMN IF NOT EXISTS "
                    f"{col_name} {col_type}"
                )
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
                        balance DOUBLE PRECISION NOT NULL DEFAULT 0,
                        lifetime_purchased DOUBLE PRECISION NOT NULL DEFAULT 0,
                        lifetime_used DOUBLE PRECISION NOT NULL DEFAULT 0,
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
                        amount_usd DOUBLE PRECISION NOT NULL,
                        credits_added DOUBLE PRECISION NOT NULL,
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
                        amount_usd DOUBLE PRECISION NOT NULL,
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


def _add_alert_action_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add optional suggested-swap-action columns to advanced_price_alerts idempotently."""
    cols = {c["name"] for c in inspector.get_columns("advanced_price_alerts")}

    new_columns = [
        ("action_side", "VARCHAR(4)", "NULL"),
        ("action_chain", "VARCHAR(50)", "NULL"),
        ("action_amount", "VARCHAR(64)", "NULL"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = (
                    f"ALTER TABLE advanced_price_alerts ADD COLUMN {col_name} "
                    f"{col_type} DEFAULT {default}"
                )
            else:
                ddl = (
                    f"ALTER TABLE advanced_price_alerts ADD COLUMN IF NOT EXISTS "
                    f"{col_name} {col_type} DEFAULT {default}"
                )
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


def _create_referral_earnings_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create referral_earnings ledger table for multi-stream commissions (idempotent).

    Records every individual commission credit across three streams:
      - swap:      percentage of fee from a referred user's swap
      - perps:     volume-tiered percentage (20%%–80%%) of fee from a referred user's perp trade
      - milestone: fixed bonus when the referrer reaches a verified-referral count threshold

    The table is append-only; negative adjustments (e.g. clawbacks) use a negative
    amount_usd row with the same stream_type.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "referral_earnings" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS referral_earnings (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        referrer_id INTEGER NOT NULL REFERENCES users(id),
                        referred_id INTEGER,
                        stream_type VARCHAR(20) NOT NULL,
                        amount_usd FLOAT NOT NULL,
                        token VARCHAR(20),
                        swap_id INTEGER,
                        perp_order_id INTEGER,
                        milestone_count INTEGER,
                        commission_rate FLOAT,
                        metadata TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS referral_earnings (
                        id SERIAL PRIMARY KEY,
                        referrer_id INTEGER NOT NULL REFERENCES users(id),
                        referred_id INTEGER,
                        stream_type VARCHAR(20) NOT NULL,
                        amount_usd FLOAT NOT NULL,
                        token VARCHAR(20),
                        swap_id INTEGER,
                        perp_order_id INTEGER,
                        milestone_count INTEGER,
                        commission_rate FLOAT,
                        metadata TEXT,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created referral_earnings table")

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_referral_earnings_referrer_id"
                " ON referral_earnings(referrer_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_referral_earnings_referred_id"
                " ON referral_earnings(referred_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_referral_earnings_stream_type"
                " ON referral_earnings(stream_type)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_referral_earnings_created_at"
                " ON referral_earnings(created_at)"
            )
        )
        # MONEY-PATH: partial UNIQUE indexes are the DB backstop against
        # double-crediting a single swap/perp order. The service layer also
        # SELECT-before-INSERTs, but these guarantee atomic dedupe under races.
        # Partial indexes are supported by both SQLite (>=3.8.0) and PostgreSQL.
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_earnings_swap"
                " ON referral_earnings(swap_id) WHERE stream_type = 'swap'"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_earnings_perp_order"
                " ON referral_earnings(perp_order_id) WHERE stream_type = 'perps'"
            )
        )


def _create_referral_milestones_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create referral_milestones table to track fixed-payout milestone bonuses (idempotent).

    Each row represents one milestone a referrer has unlocked:
      milestone_count: 5 | 10 | 20 | 50 | 100 (open-ended; service layer defines values)
      earned_at:       when the threshold was crossed
      earning_id:      FK -> referral_earnings.id (the credit row for this bonus)

    The UNIQUE constraint on (referrer_id, milestone_count) prevents double-crediting.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "referral_milestones" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS referral_milestones (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        referrer_id INTEGER NOT NULL REFERENCES users(id),
                        milestone_count INTEGER NOT NULL,
                        bonus_usd FLOAT NOT NULL,
                        earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        earning_id INTEGER REFERENCES referral_earnings(id)
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS referral_milestones (
                        id SERIAL PRIMARY KEY,
                        referrer_id INTEGER NOT NULL REFERENCES users(id),
                        milestone_count INTEGER NOT NULL,
                        bonus_usd FLOAT NOT NULL,
                        earned_at TIMESTAMP DEFAULT NOW(),
                        earning_id INTEGER REFERENCES referral_earnings(id)
                    )
                """))
            logger.info("Created referral_milestones table")

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_referral_milestones_referrer_id"
                " ON referral_milestones(referrer_id)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_milestones_referrer_count"
                " ON referral_milestones(referrer_id, milestone_count)"
            )
        )


def _add_referral_stream_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add stream-support columns to the referrals table (idempotent).

    verified_at:          NULL until the referee passes fraud/activity checks.
                          Service layer sets this; NULL means unverified (uncounted
                          for milestone purposes).
    perps_volume_14d_usd: Rolling 14-day perp trading volume for the referee,
                          updated by the perps commission service. Determines the
                          volume-tiered commission rate (20%%–80%%).
    """
    cols = {c["name"] for c in inspector.get_columns("referrals")}

    new_columns = [
        ("verified_at", "TIMESTAMP", None),
        ("perps_volume_14d_usd", "FLOAT", "0.0"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name in cols:
            continue
        try:
            if default is None:
                if is_sqlite:
                    ddl = f"ALTER TABLE referrals ADD COLUMN {col_name} {col_type}"
                else:
                    ddl = f"ALTER TABLE referrals ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
            else:
                if is_sqlite:
                    ddl = (
                        f"ALTER TABLE referrals ADD COLUMN {col_name} {col_type} DEFAULT {default}"
                    )
                else:
                    ddl = (
                        f"ALTER TABLE referrals ADD COLUMN IF NOT EXISTS"
                        f" {col_name} {col_type} DEFAULT {default}"
                    )
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info(f"Added referrals.{col_name}")
        except Exception as e:
            logger.warning(f"Failed to add referrals.{col_name}: {e}")


# ---------------------------------------------------------------------------
# Bucket 2 — community payment tools
# ---------------------------------------------------------------------------


def _create_tips_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the tips table (in-chat tipping ledger) idempotently.

    Holds every tip event: pending (waiting for on-chain send), claimed
    (recipient confirmed), or refunded (sender reclaimed unclaimed tip).
    amount uses NUMERIC(18,6) to preserve fractional token amounts exactly.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "tips" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS tips (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        sender_id INTEGER NOT NULL REFERENCES users(id),
                        recipient_id INTEGER REFERENCES users(id),
                        recipient_username VARCHAR(128),
                        chat_id VARCHAR(64) NOT NULL,
                        token VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        amount NUMERIC(18,6) NOT NULL,
                        tx_hash VARCHAR(128),
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        claimed_at DATETIME
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS tips (
                        id SERIAL PRIMARY KEY,
                        sender_id INTEGER NOT NULL REFERENCES users(id),
                        recipient_id INTEGER REFERENCES users(id),
                        recipient_username VARCHAR(128),
                        chat_id VARCHAR(64) NOT NULL,
                        token VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        amount NUMERIC(18,6) NOT NULL,
                        tx_hash VARCHAR(128),
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        created_at TIMESTAMP DEFAULT NOW(),
                        claimed_at TIMESTAMP
                    )
                """))
            logger.info("Created tips table")

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tips_sender_id ON tips(sender_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tips_recipient_id ON tips(recipient_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tips_chat_id ON tips(chat_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tips_status ON tips(status)"))
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_tips_sender_status ON tips(sender_id, status)")
        )


def _create_lucky_boxes_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create lucky_boxes and lucky_box_claims tables idempotently.

    lucky_boxes:       red-packet pool created by a user in a chat.
    lucky_box_claims:  one row per (box, claimer) — UNIQUE constraint prevents
                       double-claiming.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "lucky_boxes" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS lucky_boxes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        creator_id INTEGER NOT NULL REFERENCES users(id),
                        chat_id VARCHAR(64) NOT NULL,
                        token VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        total_amount NUMERIC(18,6) NOT NULL,
                        remaining_amount NUMERIC(18,6) NOT NULL,
                        total_count INTEGER NOT NULL,
                        claimed_count INTEGER NOT NULL DEFAULT 0,
                        split_mode VARCHAR(20) NOT NULL DEFAULT 'random',
                        status VARCHAR(20) NOT NULL DEFAULT 'active',
                        expires_at DATETIME NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS lucky_boxes (
                        id SERIAL PRIMARY KEY,
                        creator_id INTEGER NOT NULL REFERENCES users(id),
                        chat_id VARCHAR(64) NOT NULL,
                        token VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        total_amount NUMERIC(18,6) NOT NULL,
                        remaining_amount NUMERIC(18,6) NOT NULL,
                        total_count INTEGER NOT NULL,
                        claimed_count INTEGER NOT NULL DEFAULT 0,
                        split_mode VARCHAR(20) NOT NULL DEFAULT 'random',
                        status VARCHAR(20) NOT NULL DEFAULT 'active',
                        expires_at TIMESTAMP NOT NULL,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created lucky_boxes table")

        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_lucky_boxes_creator_id ON lucky_boxes(creator_id)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_lucky_boxes_chat_id ON lucky_boxes(chat_id)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_lucky_boxes_status ON lucky_boxes(status)")
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_lucky_boxes_creator_status"
                " ON lucky_boxes(creator_id, status)"
            )
        )

    with db_engine.begin() as conn:
        if "lucky_box_claims" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS lucky_box_claims (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        lucky_box_id INTEGER NOT NULL REFERENCES lucky_boxes(id),
                        claimer_id INTEGER NOT NULL REFERENCES users(id),
                        amount NUMERIC(18,6) NOT NULL,
                        tx_hash VARCHAR(128),
                        claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS lucky_box_claims (
                        id SERIAL PRIMARY KEY,
                        lucky_box_id INTEGER NOT NULL REFERENCES lucky_boxes(id),
                        claimer_id INTEGER NOT NULL REFERENCES users(id),
                        amount NUMERIC(18,6) NOT NULL,
                        tx_hash VARCHAR(128),
                        claimed_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created lucky_box_claims table")

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_lucky_box_claims_lucky_box_id"
                " ON lucky_box_claims(lucky_box_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_lucky_box_claims_claimer_id"
                " ON lucky_box_claims(claimer_id)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_lucky_box_claims_box_claimer"
                " ON lucky_box_claims(lucky_box_id, claimer_id)"
            )
        )


def _create_split_bills_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create split_bills and split_bill_shares tables idempotently.

    split_bills:       header record for a group bill-splitting session.
    split_bill_shares: one row per debtor — UNIQUE on (split_bill_id, debtor_id)
                       prevents duplicate share entries.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "split_bills" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS split_bills (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        creator_id INTEGER NOT NULL REFERENCES users(id),
                        chat_id VARCHAR(64) NOT NULL,
                        token VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        total_amount NUMERIC(18,6) NOT NULL,
                        description TEXT,
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS split_bills (
                        id SERIAL PRIMARY KEY,
                        creator_id INTEGER NOT NULL REFERENCES users(id),
                        chat_id VARCHAR(64) NOT NULL,
                        token VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        total_amount NUMERIC(18,6) NOT NULL,
                        description TEXT,
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created split_bills table")

        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_split_bills_creator_id ON split_bills(creator_id)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_split_bills_chat_id ON split_bills(chat_id)")
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_split_bills_creator_status"
                " ON split_bills(creator_id, status)"
            )
        )

    with db_engine.begin() as conn:
        if "split_bill_shares" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS split_bill_shares (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        split_bill_id INTEGER NOT NULL REFERENCES split_bills(id),
                        debtor_id INTEGER NOT NULL REFERENCES users(id),
                        amount NUMERIC(18,6) NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        paid_at DATETIME
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS split_bill_shares (
                        id SERIAL PRIMARY KEY,
                        split_bill_id INTEGER NOT NULL REFERENCES split_bills(id),
                        debtor_id INTEGER NOT NULL REFERENCES users(id),
                        amount NUMERIC(18,6) NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        paid_at TIMESTAMP
                    )
                """))
            logger.info("Created split_bill_shares table")

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_split_bill_shares_split_bill_id"
                " ON split_bill_shares(split_bill_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_split_bill_shares_debtor_id"
                " ON split_bill_shares(debtor_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_split_bill_shares_debtor_status"
                " ON split_bill_shares(debtor_id, status)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_split_bill_shares_bill_debtor"
                " ON split_bill_shares(split_bill_id, debtor_id)"
            )
        )


def _create_airdrop_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create airdrop_campaigns and airdrop_claims tables idempotently.

    airdrop_campaigns: campaign definition (total budget, per-user amount, eligibility).
    airdrop_claims:    one row per (campaign, claimer) — UNIQUE constraint prevents
                       double-claiming even if the handler is called twice.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "airdrop_campaigns" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS airdrop_campaigns (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        creator_id INTEGER NOT NULL REFERENCES users(id),
                        chat_id VARCHAR(64) NOT NULL,
                        token VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        total_amount NUMERIC(18,6) NOT NULL,
                        per_user_amount NUMERIC(18,6),
                        criteria TEXT,
                        status VARCHAR(20) NOT NULL DEFAULT 'active',
                        expires_at DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS airdrop_campaigns (
                        id SERIAL PRIMARY KEY,
                        creator_id INTEGER NOT NULL REFERENCES users(id),
                        chat_id VARCHAR(64) NOT NULL,
                        token VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        total_amount NUMERIC(18,6) NOT NULL,
                        per_user_amount NUMERIC(18,6),
                        criteria TEXT,
                        status VARCHAR(20) NOT NULL DEFAULT 'active',
                        expires_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created airdrop_campaigns table")

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_airdrop_campaigns_creator_id"
                " ON airdrop_campaigns(creator_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_airdrop_campaigns_chat_id"
                " ON airdrop_campaigns(chat_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_airdrop_campaigns_status"
                " ON airdrop_campaigns(status)"
            )
        )

    with db_engine.begin() as conn:
        if "airdrop_claims" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS airdrop_claims (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        campaign_id INTEGER NOT NULL REFERENCES airdrop_campaigns(id),
                        claimer_id INTEGER NOT NULL REFERENCES users(id),
                        amount NUMERIC(18,6) NOT NULL,
                        tx_hash VARCHAR(128),
                        claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS airdrop_claims (
                        id SERIAL PRIMARY KEY,
                        campaign_id INTEGER NOT NULL REFERENCES airdrop_campaigns(id),
                        claimer_id INTEGER NOT NULL REFERENCES users(id),
                        amount NUMERIC(18,6) NOT NULL,
                        tx_hash VARCHAR(128),
                        claimed_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created airdrop_claims table")

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_airdrop_claims_campaign_id"
                " ON airdrop_claims(campaign_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_airdrop_claims_claimer_id"
                " ON airdrop_claims(claimer_id)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_airdrop_claims_campaign_claimer"
                " ON airdrop_claims(campaign_id, claimer_id)"
            )
        )


# ---------------------------------------------------------------------------
# Bucket 3 — gamified trading battles
# ---------------------------------------------------------------------------


def _create_battles_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the battles table (directional up/down bet) idempotently.

    One row per battle.  The row is open (status='open') until expiry_at,
    at which point the settlement service writes settle_price, outcome, pnl_usd,
    and transitions status -> 'settled' (or 'voided' if data is unavailable).

    All USD and price columns use NUMERIC for exact decimal arithmetic.
    perp_order_id links to perp_orders when backing='perps'.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "battles" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS battles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        market VARCHAR(50) NOT NULL,
                        direction VARCHAR(10) NOT NULL,
                        stake_usd NUMERIC(18,6) NOT NULL,
                        backing VARCHAR(20) NOT NULL DEFAULT 'perps',
                        leverage NUMERIC(10,2),
                        entry_price NUMERIC(20,8) NOT NULL,
                        expiry_at DATETIME NOT NULL,
                        settle_price NUMERIC(20,8),
                        outcome VARCHAR(10),
                        pnl_usd NUMERIC(18,6),
                        perp_order_id INTEGER,
                        status VARCHAR(20) NOT NULL DEFAULT 'open',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        settled_at DATETIME
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS battles (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        market VARCHAR(50) NOT NULL,
                        direction VARCHAR(10) NOT NULL,
                        stake_usd NUMERIC(18,6) NOT NULL,
                        backing VARCHAR(20) NOT NULL DEFAULT 'perps',
                        leverage NUMERIC(10,2),
                        entry_price NUMERIC(20,8) NOT NULL,
                        expiry_at TIMESTAMP NOT NULL,
                        settle_price NUMERIC(20,8),
                        outcome VARCHAR(10),
                        pnl_usd NUMERIC(18,6),
                        perp_order_id INTEGER,
                        status VARCHAR(20) NOT NULL DEFAULT 'open',
                        created_at TIMESTAMP DEFAULT NOW(),
                        settled_at TIMESTAMP
                    )
                """))
            logger.info("Created battles table")

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_battles_user_id ON battles(user_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_battles_status ON battles(status)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_battles_expiry_at ON battles(expiry_at)"))
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_battles_user_status" " ON battles(user_id, status)")
        )


# ---------------------------------------------------------------------------
# On-chain fee-cashback rewards (weekly Merkle epochs)
# ---------------------------------------------------------------------------


def _create_onchain_rewards_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create reward_epochs + reward_entries idempotently.

    MONEY-PATH: the UNIQUE(epoch_id, user_id) constraint on reward_entries is the
    DB backstop against a user being paid twice for the same epoch; the entry
    ``status`` state machine (see bot/models/onchain_rewards.py) is the guard
    against settling one entry both on-chain and custodially.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "reward_epochs" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS reward_epochs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        epoch_index INTEGER NOT NULL UNIQUE,
                        starts_at DATETIME NOT NULL,
                        ends_at DATETIME NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'accruing',
                        total_amount_usd FLOAT NOT NULL DEFAULT 0,
                        entry_count INTEGER NOT NULL DEFAULT 0,
                        merkle_root VARCHAR(66),
                        published_tx_hash VARCHAR(80),
                        claim_deadline DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        finalized_at DATETIME,
                        published_at DATETIME
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS reward_epochs (
                        id SERIAL PRIMARY KEY,
                        epoch_index INTEGER NOT NULL UNIQUE,
                        starts_at TIMESTAMP NOT NULL,
                        ends_at TIMESTAMP NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'accruing',
                        total_amount_usd FLOAT NOT NULL DEFAULT 0,
                        entry_count INTEGER NOT NULL DEFAULT 0,
                        merkle_root VARCHAR(66),
                        published_tx_hash VARCHAR(80),
                        claim_deadline TIMESTAMP,
                        created_at TIMESTAMP DEFAULT NOW(),
                        finalized_at TIMESTAMP,
                        published_at TIMESTAMP
                    )
                """))
            logger.info("Created reward_epochs table")

        if "reward_entries" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS reward_entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        epoch_id INTEGER NOT NULL REFERENCES reward_epochs(id),
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        cashback_usd FLOAT NOT NULL DEFAULT 0,
                        carryover_usd FLOAT NOT NULL DEFAULT 0,
                        amount_usd FLOAT NOT NULL DEFAULT 0,
                        fee_basis_usd FLOAT NOT NULL DEFAULT 0,
                        claim_address VARCHAR(64),
                        leaf_index INTEGER,
                        amount_base_units VARCHAR(40),
                        merkle_proof TEXT,
                        status VARCHAR(20) NOT NULL DEFAULT 'claimable',
                        claimed_tx_hash VARCHAR(80),
                        settled_at DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE (epoch_id, user_id)
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS reward_entries (
                        id SERIAL PRIMARY KEY,
                        epoch_id INTEGER NOT NULL REFERENCES reward_epochs(id),
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        cashback_usd FLOAT NOT NULL DEFAULT 0,
                        carryover_usd FLOAT NOT NULL DEFAULT 0,
                        amount_usd FLOAT NOT NULL DEFAULT 0,
                        fee_basis_usd FLOAT NOT NULL DEFAULT 0,
                        claim_address VARCHAR(64),
                        leaf_index INTEGER,
                        amount_base_units VARCHAR(40),
                        merkle_proof TEXT,
                        status VARCHAR(20) NOT NULL DEFAULT 'claimable',
                        claimed_tx_hash VARCHAR(80),
                        settled_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT NOW(),
                        CONSTRAINT uq_reward_entries_epoch_user UNIQUE (epoch_id, user_id)
                    )
                """))
            logger.info("Created reward_entries table")

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_reward_entries_user_id" " ON reward_entries(user_id)"
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_reward_entries_status" " ON reward_entries(status)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_reward_epochs_status" " ON reward_epochs(status)")
        )


def _create_swap_route_candidates_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the swap_route_candidates table idempotently.

    EXECUTION INTELLIGENCE: stores every route the aggregator offered for a
    quote, not just the one executed. The rejected alternatives are the only
    basis on which a routing decision can be evaluated after the fact, and
    they were previously discarded at quote time (api-ts persisted just
    ``JSON.stringify(quote._rawQuote)`` for the chosen route).

    Written by BOTH stacks — api-ts (SwapService quote path) and the python
    bot (socket_api route list) — so the table is created here, which is the
    authoritative shared-DB path. Additive and idempotent.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    if "swap_route_candidates" in tables:
        return

    pk = "id INTEGER PRIMARY KEY AUTOINCREMENT" if is_sqlite else "id SERIAL PRIMARY KEY"
    bool_default = "0" if is_sqlite else "FALSE"

    with db_engine.begin() as conn:
        conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS swap_route_candidates (
                    {pk},
                    quote_id VARCHAR(128) NOT NULL,
                    swap_id INTEGER,
                    user_id INTEGER,
                    agent_id INTEGER,
                    from_chain VARCHAR(50) NOT NULL,
                    to_chain VARCHAR(50) NOT NULL,
                    from_token VARCHAR(40) NOT NULL,
                    to_token VARCHAR(40) NOT NULL,
                    from_amount_usd DOUBLE PRECISION,
                    provider VARCHAR(50),
                    tool VARCHAR(80),
                    quoted_to_amount VARCHAR(78),
                    quoted_to_amount_usd DOUBLE PRECISION,
                    quoted_gas_usd DOUBLE PRECISION,
                    quoted_fee_usd DOUBLE PRECISION,
                    quoted_duration_s INTEGER,
                    rank INTEGER,
                    was_selected BOOLEAN NOT NULL DEFAULT {bool_default},
                    route_hash VARCHAR(64),
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    -- Mirror the model's ForeignKeys (see note above).
                    FOREIGN KEY (swap_id) REFERENCES swap_transactions (id),
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
                """.replace("DOUBLE PRECISION", "REAL" if is_sqlite else "DOUBLE PRECISION")))

        for idx, cols in (
            ("ix_swap_route_candidates_quote_id", "quote_id"),
            ("ix_swap_route_candidates_swap_id", "swap_id"),
            ("ix_swap_route_candidates_user_id", "user_id"),
            ("ix_swap_route_candidates_agent_id", "agent_id"),
            ("ix_swap_route_candidates_created_at", "created_at"),
            ("ix_swap_route_candidates_route_hash", "route_hash"),
            # Cohort lookups for the execution-percentile benchmark.
            (
                "ix_swap_route_candidates_shape",
                "from_chain, to_chain, from_token, to_token",
            ),
        ):
            conn.execute(
                text(f"CREATE INDEX IF NOT EXISTS {idx} " f"ON swap_route_candidates ({cols})")
            )

    logger.info("Created swap_route_candidates table")


def _create_swap_execution_marks_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the swap_execution_marks table idempotently.

    EXECUTION INTELLIGENCE (phase 2): post-trade price marks for completed
    swaps, written by the ``execution_scorer`` background service. Splits
    execution quality into realized-vs-quoted (our slippage accuracy, known at
    fill) and markout (price drift after the fill, only knowable later).

    UNIQUE(swap_id, horizon) is what makes the scorer idempotent — a restart or
    an overlapping pass re-inserts nothing rather than double-writing.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    if "swap_execution_marks" in tables:
        return

    pk = "id INTEGER PRIMARY KEY AUTOINCREMENT" if is_sqlite else "id SERIAL PRIMARY KEY"
    float_type = "REAL" if is_sqlite else "DOUBLE PRECISION"

    with db_engine.begin() as conn:
        conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS swap_execution_marks (
                    {pk},
                    swap_id INTEGER NOT NULL,
                    horizon VARCHAR(8) NOT NULL,
                    to_token_price_usd {float_type},
                    fill_price_usd {float_type},
                    realized_vs_quoted_bps {float_type},
                    markout_bps {float_type},
                    scored_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_swap_execution_marks_swap_horizon
                        UNIQUE (swap_id, horizon),
                    -- Mirrors SwapExecutionMark.swap_id's ForeignKey. Without
                    -- it the two creation paths diverge: create_all() runs
                    -- BEFORE _ensure_schema() and builds the FK version, so on
                    -- a real boot this DDL never runs — but on any path where
                    -- it does, the schema would silently lack the constraint.
                    FOREIGN KEY (swap_id) REFERENCES swap_transactions (id)
                )
                """))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_swap_execution_marks_swap_id "
                "ON swap_execution_marks (swap_id)"
            )
        )

    logger.info("Created swap_execution_marks table")


def _backfill_execution_timestamp_defaults(db_engine, inspector, is_sqlite: bool) -> None:
    """Add DB-level defaults to execution-intelligence timestamp columns.

    SQLAlchemy's ``default=`` is applied in PYTHON, not by the database, so a
    table built by ``create_all()`` gets ``NOT NULL`` with NO ``DEFAULT``
    clause. api-ts/Drizzle declares ``.defaultNow()``, assumes a DB default
    exists, and emits ``default`` in its INSERT — which resolves to NULL and
    violates NOT NULL.

    This bit production: every counterfactual-capture insert failed with the
    table already created, so no ALTER of the model alone can fix existing
    deployments. Idempotent; Postgres only (SQLite tables are created fresh
    from the DDL above, which already carries the default).
    """
    if is_sqlite:
        return

    targets = [
        ("swap_route_candidates", "created_at"),
        ("swap_execution_marks", "scored_at"),
    ]
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    for table, column in targets:
        if table not in tables:
            continue
        try:
            cols = {c["name"]: c for c in inspector.get_columns(table)}
            col = cols.get(column)
            if col is None or col.get("default") is not None:
                continue
            with db_engine.begin() as conn:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} "
                        f"ALTER COLUMN {column} SET DEFAULT CURRENT_TIMESTAMP"
                    )
                )
            logger.info(f"Set DB default on {table}.{column}")
        except Exception as e:
            logger.warning(f"Could not set default on {table}.{column}: {e}")


def _create_token_intel_tables(db_engine, inspector, is_sqlite: bool) -> None:
    """Create Token Intel / Dev Tracking tables idempotently.

    deployer_watches: a user's watchlist of deployer addresses.
    deployer_watch_hits: new-token-deploy events matched against a watch.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    pk = "id INTEGER PRIMARY KEY AUTOINCREMENT" if is_sqlite else "id SERIAL PRIMARY KEY"
    ts_type = "DATETIME" if is_sqlite else "TIMESTAMP"
    ts_default = "CURRENT_TIMESTAMP" if is_sqlite else "NOW()"

    with db_engine.begin() as conn:
        if "deployer_watches" not in tables:
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS deployer_watches (
                    {pk},
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    deployer_address VARCHAR(255) NOT NULL,
                    chain VARCHAR(50) NOT NULL DEFAULT 'ethereum',
                    label VARCHAR(100),
                    created_at {ts_type} DEFAULT {ts_default},
                    CONSTRAINT uq_deployer_watch_user_addr_chain
                        UNIQUE (user_id, deployer_address, chain)
                )
            """))

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_deployer_watches_user_id "
                "ON deployer_watches(user_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_deployer_watches_deployer_address "
                "ON deployer_watches(deployer_address)"
            )
        )

        if "deployer_watch_hits" not in tables:
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS deployer_watch_hits (
                    {pk},
                    watch_id INTEGER NOT NULL REFERENCES deployer_watches(id),
                    token_address VARCHAR(255) NOT NULL,
                    chain VARCHAR(50) NOT NULL DEFAULT 'ethereum',
                    detected_at {ts_type} DEFAULT {ts_default}
                )
            """))

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_deployer_watch_hits_watch_id "
                "ON deployer_watch_hits(watch_id)"
            )
        )


def _create_aegis_trust_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the aegis_user_trust table (Phase 2.3 per-user trust adaptation) idempotently.

    RECORD-ONLY: nothing reads this table to gate/throttle anything yet — see
    bot/models/aegis_trust.py and bot/services/aegis_trust.py module docstrings.
    """
    try:
        from bot.models.aegis_trust import AegisUserTrust

        if not inspector.has_table(AegisUserTrust.__tablename__):
            AegisUserTrust.__table__.create(bind=db_engine)
            logger.info("Created aegis_user_trust table")
    except Exception as e:
        logger.warning(f"Failed to create aegis_user_trust table: {e}")


def _add_approval_requests_notify_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add Python-owned Telegram-notification bookkeeping columns to
    ``approval_requests`` (owned/created by api-ts — schema at
    ``api-ts/src/db/schema/approvals.ts``), idempotently.

    ``notified_at`` / ``notify_chat_id`` / ``notify_message_id`` are
    PYTHON-OWNED — api-ts must NOT write them. They only track whether/where
    ``bot/services/approval_notifier.py`` has DM'd the owning Telegram user
    for a given row, so the notifier never double-sends and the decision
    handler (``bot/handlers/approvals.py``) can edit the original message in
    place. No-op (via ``has_table``) until api-ts has actually created the
    table.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return
    if "approval_requests" not in tables:
        return

    try:
        cols = {c["name"] for c in inspector.get_columns("approval_requests")}
    except Exception as e:
        logger.warning(f"Could not inspect approval_requests columns: {e}")
        return

    additions = []
    if "notified_at" not in cols:
        ts_type = "DATETIME" if is_sqlite else "TIMESTAMP"
        additions.append(f"ADD COLUMN notified_at {ts_type}")
    if "notify_chat_id" not in cols:
        bigint_type = "BIGINT" if not is_sqlite else "INTEGER"
        additions.append(f"ADD COLUMN notify_chat_id {bigint_type}")
    if "notify_message_id" not in cols:
        additions.append("ADD COLUMN notify_message_id INTEGER")

    if not additions:
        return

    try:
        with db_engine.begin() as conn:
            if is_sqlite:
                # SQLite doesn't support multi-column ALTER TABLE ADD COLUMN
                # in one statement.
                for addition in additions:
                    conn.execute(text(f"ALTER TABLE approval_requests {addition}"))
            else:
                for addition in additions:
                    conn.execute(
                        text(
                            f"ALTER TABLE approval_requests "
                            f"{addition.replace('ADD COLUMN', 'ADD COLUMN IF NOT EXISTS')}"
                        )
                    )
        logger.info(f"Added approval_requests notify columns: {additions}")
    except Exception as e:
        logger.warning(f"Failed to add approval_requests notify columns: {e}")


def _create_agent_webhook_deliveries_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create agent_webhook_deliveries idempotently (durable approval-decision webhooks).

    Python-owned table — ``approval_requests`` (id: uuid, agent_id: varchar(64))
    is owned by api-ts (``api-ts/src/db/schema/approvals.ts``); this table only
    references it by id/agent_id string values, it never creates or alters
    that table. ``id`` is a text/uuid primary key assigned by this bot on
    enqueue (not autoincrement) so a delivery row can be created without a
    round-trip to read back an identity value. Includes ``claimed_at`` from
    the start (unlike the upstream port, which added it in a follow-up
    migration) so ``WebhookDispatcher`` can reclaim rows stranded in
    ``status='sending'`` by a crash mid-POST.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return
    if "agent_webhook_deliveries" in tables:
        return

    json_type = "TEXT" if is_sqlite else "JSONB"
    ts_type = "DATETIME" if is_sqlite else "TIMESTAMP"

    try:
        with db_engine.begin() as conn:
            conn.execute(text(f"""
                    CREATE TABLE IF NOT EXISTS agent_webhook_deliveries (
                        id VARCHAR(36) PRIMARY KEY,
                        approval_id VARCHAR(36) NOT NULL,
                        agent_id TEXT,
                        url VARCHAR(1024) NOT NULL,
                        payload_json {json_type} NOT NULL,
                        signature_ts VARCHAR(32),
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        attempts INTEGER NOT NULL DEFAULT 0,
                        claimed_at {ts_type},
                        next_attempt_at {ts_type},
                        last_error TEXT,
                        created_at {ts_type} NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        delivered_at {ts_type}
                    )
                    """))
            for idx, cols in (
                ("ix_agent_webhook_deliveries_status_next", "status, next_attempt_at"),
                ("ix_agent_webhook_deliveries_approval_id", "approval_id"),
            ):
                conn.execute(
                    text(f"CREATE INDEX IF NOT EXISTS {idx} ON agent_webhook_deliveries ({cols})")
                )
        logger.info("Created agent_webhook_deliveries table")
    except Exception as e:
        logger.warning(f"Failed to create agent_webhook_deliveries table: {e}")


def _add_agents_owner_user_id_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add agents.owner_user_id (nullable FK -> users.id) idempotently.

    Shared column: api-ts already ships this on agents.ts's ownerUserId via
    Drizzle. This migration exists for any Python-provisioned database
    (sqlite dev/tests, or Postgres where the Python side runs first) so it
    also gets the column. Additive/nullable; never touches agents creation.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return
    if "agents" not in tables:
        return
    try:
        cols = {c["name"] for c in inspector.get_columns("agents")}
    except Exception as e:
        logger.warning(f"Could not inspect agents columns: {e}")
        return
    if "owner_user_id" in cols:
        return
    try:
        with db_engine.begin() as conn:
            conn.execute(text("ALTER TABLE agents ADD COLUMN owner_user_id INTEGER"))
        logger.info("Added agents.owner_user_id column")
    except Exception as e:
        logger.warning(f"Failed to add agents.owner_user_id column: {e}")


def _create_agent_link_codes_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create agent_link_codes idempotently (agent ownership linking).

    Matches api-ts's shipped Drizzle schema (agentLinkCodes.ts) exactly:
    agent_id is an INTEGER FK to agents.id (NOT agents.uuid), code_hash is a
    UNIQUE varchar(64) sha256 hex digest of a code minted+shown once by
    api-ts's POST /v1/agent/link/code, expires_at/used_at/created_at are
    timestamps. Exists for any Python-provisioned database that hasn't seen
    api-ts's migration yet.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return
    if "agent_link_codes" in tables:
        return

    ts_type = "DATETIME" if is_sqlite else "TIMESTAMP"
    pk_extra = "AUTOINCREMENT" if is_sqlite else ""

    try:
        with db_engine.begin() as conn:
            conn.execute(
                text(
                    f"CREATE TABLE IF NOT EXISTS agent_link_codes ("
                    f"id INTEGER PRIMARY KEY {pk_extra}, "
                    f"agent_id INTEGER NOT NULL, "
                    f"code_hash VARCHAR(64) NOT NULL, "
                    f"expires_at {ts_type} NOT NULL, "
                    f"used_at {ts_type}, "
                    f"created_at {ts_type} NOT NULL DEFAULT CURRENT_TIMESTAMP)"
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_agent_link_codes_code_hash "
                    "ON agent_link_codes (code_hash)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_agent_link_codes_agent_id "
                    "ON agent_link_codes (agent_id)"
                )
            )
        logger.info("Created agent_link_codes table")
    except Exception as e:
        logger.warning(f"Failed to create agent_link_codes table: {e}")


# ---------------------------------------------------------------------------
# Market data parity Phase 1 — normalized OHLCV candles
# ---------------------------------------------------------------------------


def _create_market_candles_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the market_candles table idempotently.

    Backs the Historical API (GET /v1/data/history/ohlcv) per
    docs/plans/market-data-parity.md. One row per (symbol, chain, timeframe, ts)
    candle; populated by bot/services/market_data.py (Phase 2 — not yet
    implemented as of this migration). open/high/low/close/volume use
    NUMERIC(38,18) for exact decimal arithmetic across chains with wildly
    different token decimals.

    Mirrors api-ts's Drizzle schema (marketCandles.ts) exactly.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "market_candles" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS market_candles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        symbol VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        token_address VARCHAR(255),
                        timeframe VARCHAR(10) NOT NULL,
                        ts DATETIME NOT NULL,
                        open NUMERIC(38,18) NOT NULL,
                        high NUMERIC(38,18) NOT NULL,
                        low NUMERIC(38,18) NOT NULL,
                        close NUMERIC(38,18) NOT NULL,
                        volume NUMERIC(38,18),
                        source VARCHAR(20) NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS market_candles (
                        id SERIAL PRIMARY KEY,
                        symbol VARCHAR(20) NOT NULL,
                        chain VARCHAR(50) NOT NULL,
                        token_address VARCHAR(255),
                        timeframe VARCHAR(10) NOT NULL,
                        ts TIMESTAMPTZ NOT NULL,
                        open NUMERIC(38,18) NOT NULL,
                        high NUMERIC(38,18) NOT NULL,
                        low NUMERIC(38,18) NOT NULL,
                        close NUMERIC(38,18) NOT NULL,
                        volume NUMERIC(38,18),
                        source VARCHAR(20) NOT NULL,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created market_candles table")

        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_market_candles_symbol_chain_timeframe_ts "
                "ON market_candles(symbol, chain, timeframe, ts)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_market_candles_symbol_chain_timeframe_ts "
                "ON market_candles(symbol, chain, timeframe, ts DESC)"
            )
        )


def _create_api_usage_daily_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the api_usage_daily table idempotently.

    Per-caller (`api_key_id`), per-route, per-day request counter backing
    /v1/data/* metering (see `callerKeyOf()` in api-ts/src/routes/data.ts).
    One row per (api_key_id, route, day); `count` increments per request and
    `last_used_at` records the most recent hit.

    Mirrors api-ts's Drizzle schema (apiUsageDaily.ts) exactly.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "api_usage_daily" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS api_usage_daily (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        api_key_id TEXT NOT NULL,
                        route TEXT NOT NULL,
                        day DATE NOT NULL,
                        count INTEGER NOT NULL DEFAULT 0,
                        last_used_at DATETIME
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS api_usage_daily (
                        id BIGSERIAL PRIMARY KEY,
                        api_key_id TEXT NOT NULL,
                        route TEXT NOT NULL,
                        day DATE NOT NULL,
                        count BIGINT NOT NULL DEFAULT 0,
                        last_used_at TIMESTAMPTZ
                    )
                """))
            logger.info("Created api_usage_daily table")

        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_api_usage_daily_key_route_day "
                "ON api_usage_daily(api_key_id, route, day)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_api_usage_daily_key_day "
                "ON api_usage_daily(api_key_id, day)"
            )
        )


# ---------------------------------------------------------------------------
# Market data parity Round 5 — perps / predictions / lend time series
# ---------------------------------------------------------------------------


def _create_perp_metrics_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the perp_metrics table idempotently.

    Backs /v1/data/perps/* per docs/plans/market-data-parity.md (Round 5).
    One row per (venue, symbol, ts) snapshot of a perp market — funding
    rate, open interest, mark/index price, 24h volume — captured every 60s
    from Hyperliquid REST metaAndAssetCtxs
    (bot/services/hyperliquid_client.py).

    Mirrors api-ts's Drizzle schema (perpMetrics.ts) exactly.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "perp_metrics" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS perp_metrics (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        venue TEXT NOT NULL,
                        symbol TEXT NOT NULL,
                        ts DATETIME NOT NULL,
                        funding_rate NUMERIC(38,18),
                        open_interest NUMERIC(38,18),
                        mark_price NUMERIC(38,18),
                        index_price NUMERIC(38,18),
                        volume_24h NUMERIC(38,18),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS perp_metrics (
                        id BIGSERIAL PRIMARY KEY,
                        venue TEXT NOT NULL,
                        symbol TEXT NOT NULL,
                        ts TIMESTAMPTZ NOT NULL,
                        funding_rate NUMERIC(38,18),
                        open_interest NUMERIC(38,18),
                        mark_price NUMERIC(38,18),
                        index_price NUMERIC(38,18),
                        volume_24h NUMERIC(38,18),
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created perp_metrics table")

        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_perp_metrics_venue_symbol_ts "
                "ON perp_metrics(venue, symbol, ts)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_perp_metrics_venue_symbol_ts "
                "ON perp_metrics(venue, symbol, ts DESC)"
            )
        )


def _create_prediction_snapshots_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the prediction_snapshots table idempotently.

    Backs /v1/data/predictions/* per docs/plans/market-data-parity.md
    (Round 5). One row per (venue, market_id, outcome, ts) odds snapshot,
    captured every 5 minutes for the top ~100 active markets by volume from
    Polymarket Gamma (bot/services/polymarket_api.py).

    Mirrors api-ts's Drizzle schema (predictionSnapshots.ts) exactly.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "prediction_snapshots" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS prediction_snapshots (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        venue TEXT NOT NULL,
                        market_id TEXT NOT NULL,
                        condition_id TEXT,
                        question TEXT,
                        outcome TEXT NOT NULL,
                        ts DATETIME NOT NULL,
                        price NUMERIC(38,18),
                        volume NUMERIC(38,18),
                        liquidity NUMERIC(38,18),
                        end_date DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS prediction_snapshots (
                        id BIGSERIAL PRIMARY KEY,
                        venue TEXT NOT NULL,
                        market_id TEXT NOT NULL,
                        condition_id TEXT,
                        question TEXT,
                        outcome TEXT NOT NULL,
                        ts TIMESTAMPTZ NOT NULL,
                        price NUMERIC(38,18),
                        volume NUMERIC(38,18),
                        liquidity NUMERIC(38,18),
                        end_date TIMESTAMPTZ,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created prediction_snapshots table")

        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "uq_prediction_snapshots_venue_market_id_outcome_ts "
                "ON prediction_snapshots(venue, market_id, outcome, ts)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_prediction_snapshots_venue_market_id_ts "
                "ON prediction_snapshots(venue, market_id, ts DESC)"
            )
        )


def _create_lend_metrics_table(db_engine, inspector, is_sqlite: bool) -> None:
    """Create the lend_metrics table idempotently.

    Backs /v1/data/lend/* per docs/plans/market-data-parity.md (Round 5).
    One row per (venue, market_id, ts) snapshot of a lending market —
    supply/borrow APY, TVL, utilization — captured every 10 minutes from
    Morpho GraphQL (bot/services/morpho_api.py).

    Mirrors api-ts's Drizzle schema (lendMetrics.ts) exactly.
    """
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    with db_engine.begin() as conn:
        if "lend_metrics" not in tables:
            if is_sqlite:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS lend_metrics (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        venue TEXT NOT NULL,
                        market_id TEXT NOT NULL,
                        chain_id INTEGER,
                        loan_symbol TEXT,
                        collateral_symbol TEXT,
                        ts DATETIME NOT NULL,
                        supply_apy NUMERIC(38,18),
                        borrow_apy NUMERIC(38,18),
                        tvl NUMERIC(38,18),
                        utilization NUMERIC(38,18),
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS lend_metrics (
                        id BIGSERIAL PRIMARY KEY,
                        venue TEXT NOT NULL,
                        market_id TEXT NOT NULL,
                        chain_id INTEGER,
                        loan_symbol TEXT,
                        collateral_symbol TEXT,
                        ts TIMESTAMPTZ NOT NULL,
                        supply_apy NUMERIC(38,18),
                        borrow_apy NUMERIC(38,18),
                        tvl NUMERIC(38,18),
                        utilization NUMERIC(38,18),
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
            logger.info("Created lend_metrics table")

        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_lend_metrics_venue_market_id_ts "
                "ON lend_metrics(venue, market_id, ts)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_lend_metrics_venue_market_id_ts "
                "ON lend_metrics(venue, market_id, ts DESC)"
            )
        )


def _add_trader_profiles_feed_opt_out_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add trader_profiles.show_in_feed — a per-trader opt-out for the /feed
    verified-trade feed (markets.xyz parity GAP 3).

    `is_public` (existing column) remains the single source of truth for
    "discoverable at all" (leaderboard, /traders search, copy-follow). A
    trader who is public may still not want their individual fills broadcast
    into the social feed, so this is a second, narrower gate: /feed only
    shows a trader's trades when BOTH `is_public` AND `show_in_feed` are true.
    Defaults to TRUE (matches existing public traders' expectations — going
    public already means "my trades are visible"); traders can opt out via
    /profile without giving up followability.
    """
    cols = {c["name"] for c in inspector.get_columns("trader_profiles")}

    if "show_in_feed" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE trader_profiles ADD COLUMN show_in_feed BOOLEAN DEFAULT TRUE"
        else:
            ddl = (
                "ALTER TABLE trader_profiles "
                "ADD COLUMN IF NOT EXISTS show_in_feed BOOLEAN DEFAULT TRUE"
            )
        with db_engine.begin() as conn:
            conn.execute(text(ddl))


def _add_trader_trades_created_at_index(db_engine, inspector, is_sqlite: bool) -> None:
    """Index trader_trades(created_at) for the /feed GLOBAL feed query, which
    orders across ALL opted-in traders by recency (the existing
    ix_trader_trades_trader_date index is scoped to a single trader_id and
    doesn't help a cross-trader ORDER BY created_at DESC scan)."""
    with db_engine.begin() as conn:
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_trader_trades_created_at "
                "ON trader_trades(created_at DESC)"
            )
        )


def _add_perp_positions_dex_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add perp_positions.dex — the HyperLiquid perp dex a position lives on
    (markets.xyz parity GAP 1: HIP-3 builder-deployed perp dexs).

    Empty string ("") means the native HyperLiquid dex (today's only dex,
    matching HL's own ``dex=""`` convention on /info + /exchange). A non-empty
    value is a builder-deployed dex name (e.g. equities/FX/commodities/bonds),
    required so closes/TP-SL/cancels on a HIP-3 position resolve the correct
    (offset) asset id rather than falling back to the native dex's asset table.
    Additive + idempotent; defaults to "" so every pre-existing row (all native
    positions) keeps working unchanged.
    """
    cols = {c["name"] for c in inspector.get_columns("perp_positions")}
    if "dex" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE perp_positions ADD COLUMN dex VARCHAR(50) DEFAULT ''"
        else:
            ddl = "ALTER TABLE perp_positions ADD COLUMN IF NOT EXISTS dex VARCHAR(50) DEFAULT ''"
        with db_engine.begin() as conn:
            conn.execute(text(ddl))
            conn.execute(text("UPDATE perp_positions SET dex = '' WHERE dex IS NULL"))


def _add_perp_orders_dex_column(db_engine, inspector, is_sqlite: bool) -> None:
    """Add perp_orders.dex — mirrors perp_positions.dex (see above) so scale-order
    legs, TWAPs, and TP/SL orders on a HIP-3 market carry their dex too.
    Additive + idempotent; defaults to "" (native dex).
    """
    cols = {c["name"] for c in inspector.get_columns("perp_orders")}
    if "dex" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE perp_orders ADD COLUMN dex VARCHAR(50) DEFAULT ''"
        else:
            ddl = "ALTER TABLE perp_orders ADD COLUMN IF NOT EXISTS dex VARCHAR(50) DEFAULT ''"
        with db_engine.begin() as conn:
            conn.execute(text(ddl))
            conn.execute(text("UPDATE perp_orders SET dex = '' WHERE dex IS NULL"))
