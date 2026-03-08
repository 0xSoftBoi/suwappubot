"""Baseline migration - establishes migration tracking for existing schema.

Revision ID: 001_baseline
Revises:
Create Date: 2024-01-17

This migration represents the existing database schema created by
Base.metadata.create_all() in database/db.py. It's a baseline that
allows Alembic to track future changes.

For new databases: Tables are created by this migration.
For existing databases: Run `alembic stamp 001_baseline` to mark as applied.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '001_baseline'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all tables if they don't exist (baseline schema)."""

    # Check if tables already exist (existing deployment)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # Users table
    if 'users' not in existing_tables:
        op.create_table(
            'users',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('telegram_id', sa.Integer(), unique=True, nullable=True, index=True),
            sa.Column('whatsapp_id', sa.String(255), unique=True, nullable=True, index=True),
            sa.Column('username', sa.String(255), nullable=True),
            sa.Column('first_name', sa.String(255), nullable=True),
            sa.Column('last_name', sa.String(255), nullable=True),
            sa.Column('default_slippage', sa.Integer(), default=50),
            sa.Column('notifications_enabled', sa.Boolean(), default=True),
            sa.Column('tos_accepted', sa.Boolean(), default=False),
            sa.Column('tos_accepted_at', sa.DateTime(), nullable=True),
            sa.Column('referred_by_user_id', sa.Integer(), nullable=True, index=True),
            sa.Column('total_referral_rewards', sa.Float(), default=0.0),
            sa.Column('referral_count', sa.Integer(), default=0),
            sa.Column('two_fa_enabled', sa.Boolean(), default=False),
            sa.Column('totp_secret', sa.String(64), nullable=True),
            sa.Column('two_fa_threshold', sa.Integer(), default=1000),
            sa.Column('created_at', sa.DateTime(), default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), default=sa.func.now(), onupdate=sa.func.now()),
            sa.Column('last_active_at', sa.DateTime(), default=sa.func.now()),
        )

    # Wallets table
    if 'wallets' not in existing_tables:
        op.create_table(
            'wallets',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('name', sa.String(100), default='Default Wallet'),
            sa.Column('address', sa.String(255), nullable=False),
            sa.Column('encrypted_private_key', sa.Text(), nullable=True),
            sa.Column('encryption_scheme', sa.String(50), default='legacy_fernet_v1'),
            sa.Column('kms_wrapped_dek', sa.Text(), nullable=True),
            sa.Column('aesgcm_nonce', sa.String(32), nullable=True),
            sa.Column('kms_key_id', sa.String(255), nullable=True),
            sa.Column('key_version', sa.Integer(), default=1),
            sa.Column('wallet_provider', sa.String(20), default='local'),
            sa.Column('turnkey_sub_org_id', sa.String(100), nullable=True),
            sa.Column('turnkey_wallet_id', sa.String(100), nullable=True),
            sa.Column('turnkey_account_id', sa.String(100), nullable=True),
            sa.Column('chain_type', sa.String(20), nullable=False),
            sa.Column('is_active', sa.Boolean(), default=True),
            sa.Column('is_default', sa.Boolean(), default=False),
            sa.Column('created_at', sa.DateTime(), default=sa.func.now()),
        )

    # Swap transactions table
    if 'swap_transactions' not in existing_tables:
        op.create_table(
            'swap_transactions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('from_chain', sa.String(50), nullable=False),
            sa.Column('from_token', sa.String(20), nullable=False),
            sa.Column('from_amount', sa.String(78), nullable=False),
            sa.Column('from_amount_usd', sa.Float(), nullable=True),
            sa.Column('to_chain', sa.String(50), nullable=False),
            sa.Column('to_token', sa.String(20), nullable=False),
            sa.Column('to_amount', sa.String(78), nullable=True),
            sa.Column('to_amount_usd', sa.Float(), nullable=True),
            sa.Column('status', sa.String(30), default='pending'),
            sa.Column('tx_hash', sa.String(255), nullable=True),
            sa.Column('bridge_tx_hash', sa.String(255), nullable=True),
            sa.Column('destination_tx_hash', sa.String(255), nullable=True),
            sa.Column('idempotency_key', sa.String(128), nullable=True, index=True, unique=True),
            sa.Column('route_provider', sa.String(50), nullable=True),
            sa.Column('route_data', sa.Text(), nullable=True),
            sa.Column('gas_fee', sa.Float(), nullable=True),
            sa.Column('bridge_fee', sa.Float(), nullable=True),
            sa.Column('slippage', sa.Integer(), default=50),
            sa.Column('created_at', sa.DateTime(), default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), default=sa.func.now(), onupdate=sa.func.now()),
            sa.Column('completed_at', sa.DateTime(), nullable=True),
            sa.Column('error_message', sa.Text(), nullable=True),
        )

    # Note: Additional tables (fees, referrals, points, copy_trading, snipe)
    # are created by their respective models via Base.metadata.create_all()
    # Future migrations will track changes to all tables.


def downgrade() -> None:
    """Drop baseline tables (DANGEROUS - only for fresh databases)."""
    # Only drop if this is truly a rollback scenario
    # In practice, you'd never want to run this on production
    op.drop_table('swap_transactions')
    op.drop_table('wallets')
    op.drop_table('users')
