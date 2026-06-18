"""Tempo access key (session key) records.

An access key is a bot-held secp256k1 key that the user's Tempo *root* account
has authorized on the AccountKeychain precompile, scoped to the enshrined DEX +
TIP-20 selectors with an on-chain spending limit and expiry. It lets the bot run
automated Tempo swaps (DCA / limit / snipe) on the user's behalf WITHOUT their
root key and without per-trade re-auth — the protocol enforces the cap, so the
held key is bounded, revocable, and expiring.

The private key is stored with the same envelope (KMS v2) encryption as wallets.
On-chain authority is the source of truth; the scope/limit/expiry columns here are
for display + lifecycle bookkeeping.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, Text

from database.db import Base


class TempoAccessKey(Base):
    __tablename__ = "tempo_access_keys"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True, nullable=False)

    # The Tempo wallet that authorized the key (root) and the access key itself.
    root_address = Column(String(42), nullable=False, index=True)
    key_address = Column(String(42), nullable=False)  # key_id on the keychain

    # Envelope-encrypted access private key (mirrors HotWallet columns).
    encrypted_private_key = Column(Text, nullable=False)
    encryption_scheme = Column(String(40))
    kms_wrapped_dek = Column(Text)
    aesgcm_nonce = Column(Text)
    kms_key_id = Column(String(200))
    key_version = Column(Integer, default=1)

    # Granted scope/limit (display + reference; on-chain is authoritative).
    spend_token = Column(String(42))  # primary capped token (pathUSD)
    spend_limit_raw = Column(String(80))  # uint256 cap as decimal string
    period_seconds = Column(Integer, default=0)  # 0 = lifetime; else recurring window
    expiry = Column(Integer)  # unix timestamp; key auto-expires on-chain

    authorize_tx_hash = Column(String(80))
    revoke_tx_hash = Column(String(80))
    status = Column(String(20), default="active")  # active | revoked | expired

    created_at = Column(DateTime, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return (
            f"<TempoAccessKey(user={self.user_id}, key={self.key_address[:10]}…, "
            f"status={self.status})>"
        )
