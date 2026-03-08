"""Alembic environment configuration for Suwappubot."""
import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import Base and all models to ensure metadata is populated
from database.db import Base

# Import all models so they register with Base.metadata
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction
from bot.models.fees import FeeConfig, FeeTransaction, FeeSummary
from bot.models.advanced import LimitOrder, DCAOrder, DCAExecution, SwapTemplate
from bot.models.referral import Referral, ReferralCode, ReferralReward, ReferralPayout
from bot.models.points import UserPoints, PointTransaction, PointRedemption, Milestone, UserMilestone, Reward
from bot.models.copy_trading import TraderProfile, CopyFollow, CopyTrade, CopyNotification, TraderTrade
from bot.models.snipe import SnipeOrder, SnipeConfig, SnipeHistory, WatchedToken, AutoSnipeRule

# This is the Alembic Config object
config = context.config

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Model's MetaData object for 'autogenerate' support
target_metadata = Base.metadata


def get_url() -> str:
    """Get database URL from environment variable."""
    url = os.getenv("DATABASE_URL", "")

    if not url:
        raise ValueError("DATABASE_URL environment variable is not set")

    # Handle Render's postgres:// vs postgresql:// scheme
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    return url


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.

    This configures the context with just a URL and not an Engine,
    though an Engine is acceptable here as well. By skipping the Engine
    creation we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode.

    In this scenario we need to create an Engine and associate a
    connection with the context.
    """
    # Get connect args for PostgreSQL SSL
    url = get_url()
    connect_args = {}

    if "postgresql" in url:
        connect_args = {
            "sslmode": "require",
            "connect_timeout": 10,
        }

    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
