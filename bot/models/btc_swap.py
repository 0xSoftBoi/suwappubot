"""Atomiq BTC bridge swap model (Starknet Phase 3).

Tracks Lightning→Starknet deposits and Starknet→BTC/Lightning withdrawals
executed through the Atomiq REST API. The Lightning-deposit claim preimage
("secret") is encrypted at rest with the SAME utility used for wallet
private keys (bot.utils.encryption Fernet + settings.encryption_key) and is
zeroized after it is revealed to the Atomiq API.
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from database.db import Base


def _utcnow():
    return datetime.now(timezone.utc)


class BtcSwap(Base):
    """One Atomiq bridge swap (LN-in deposit or Starknet→BTC/LN withdrawal)."""

    __tablename__ = "btc_swaps"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True, index=True)

    # Atomiq swap id (server-side identifier used for all status polling)
    swap_id = Column(String(128), nullable=False, unique=True, index=True)
    # "ln_in" (Lightning → Starknet), "btc_out" (Starknet → on-chain BTC),
    # "ln_out" (Starknet → Lightning invoice)
    direction = Column(String(16), nullable=False)

    src_token = Column(String(64), nullable=False)
    dst_token = Column(String(64), nullable=False)
    # Destination chain for LN-in deposits ("starknet" | "citrea"); NULL for
    # legacy rows (implicitly starknet) and for withdrawals.
    dst_chain = Column(String(32), nullable=True)
    # Raw base-unit amounts as strings (sats are 8dp; never floats)
    amount_raw = Column(String(64), nullable=True)
    quote_output_raw = Column(String(64), nullable=True)
    dst_address = Column(Text, nullable=True)

    # LN-in claim preimage, encrypted with the wallet-key encryption util.
    # Nullable: only Lightning deposits carry a secret.
    secret_encrypted = Column(Text, nullable=True)

    # Atomiq state name (e.g. "CREATED", "CLAIMED") + numeric state
    state = Column(String(64), nullable=True)
    atomiq_state_num = Column(Integer, nullable=True)

    # BOLT11 invoice the user must pay (LN-in only)
    invoice = Column(Text, nullable=True)
    # JSON-encoded list of on-chain tx hashes we produced/observed
    tx_hashes = Column(Text, nullable=True)

    # First-seen Atomiq escrow contract address (hex) — pinned for the swap's
    # lifetime; later SignSmartChainTransaction actions must target the same one.
    escrow_address = Column(Text, nullable=True)
    # Terminal error description when finished unsuccessfully (4xx, give-up)
    last_error = Column(Text, nullable=True)

    finished = Column(Boolean, nullable=False, default=False)
    success = Column(Boolean, nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
