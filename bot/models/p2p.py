"""P2P (peer-to-peer fiat<>crypto) marketplace models.

Suwappu aggregates P2P liquidity across three sources, exactly like the swap
engine races DEX aggregators:

  - ``native``  — Suwappu's own on-chain USDC escrow offer book (non-custodial)
  - ``noones``  — NoOnes centralized P2P marketplace (custodial, 500+ rails)
  - ``p2p_me``  — P2P.me decentralized LP network (USDC on Base, self-custody)

``P2POffer`` persists *native* offers (the book Suwappu itself hosts). External
provider offers are fetched live and returned as ephemeral quotes — they are not
stored here. ``P2PTrade`` records trades against ANY source so the user has one
unified history; for external trades we keep the provider's reference ids.
"""

import enum

from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Float,
    DateTime,
    ForeignKey,
    Text,
    Numeric,
    Index,
)
from sqlalchemy.sql import func

from database.db import Base


class P2PSource(str, enum.Enum):
    """Where the offer/trade liquidity comes from."""

    NATIVE = "native"  # Suwappu on-chain USDC escrow book
    NOONES = "noones"  # NoOnes marketplace API
    P2P_ME = "p2p_me"  # P2P.me LP network


class P2POfferType(str, enum.Enum):
    """Offer direction, from the *maker's* perspective."""

    SELL_CRYPTO = "sell_crypto"  # Maker sells crypto, wants fiat (taker buys crypto)
    BUY_CRYPTO = "buy_crypto"  # Maker buys crypto, sends fiat (taker sells crypto)


class P2POfferStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    FILLED = "filled"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class P2PTradeStatus(str, enum.Enum):
    """Lifecycle of a single trade.

    Native (escrow) happy path:
      INITIATED -> ESCROW_LOCKED -> FIAT_PENDING -> FIAT_SENT -> RELEASED -> COMPLETED
    External providers map their own states onto this enum.
    """

    INITIATED = "initiated"  # Trade created, awaiting escrow
    ESCROW_LOCKED = "escrow_locked"  # Crypto locked on-chain (native)
    FIAT_PENDING = "fiat_pending"  # Waiting for buyer to send fiat
    FIAT_SENT = "fiat_sent"  # Buyer marked fiat paid
    RELEASED = "released"  # Seller released / escrow released crypto
    COMPLETED = "completed"  # Settled end-to-end
    CANCELLED = "cancelled"
    DISPUTED = "disputed"
    RESOLVING = "resolving"  # arbiter claimed the dispute; on-chain move in flight
    EXPIRED = "expired"


class P2POffer(Base):
    """A native (Suwappu-hosted) P2P offer in the on-chain escrow book."""

    __tablename__ = "p2p_offers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    maker_user_id = Column(BigInteger, nullable=False, index=True)
    maker_wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=True)

    source = Column(String(16), nullable=False, default=P2PSource.NATIVE.value)
    offer_type = Column(String(16), nullable=False)  # P2POfferType
    status = Column(String(16), nullable=False, default=P2POfferStatus.ACTIVE.value, index=True)

    # Currency pair
    fiat_currency = Column(String(3), nullable=False, index=True)  # ISO 4217: USD, EUR, NGN...
    crypto_asset = Column(String(20), nullable=False, index=True)  # USDC, USDT, BTC, ETH
    crypto_chain = Column(String(32), nullable=False, default="base")  # base, ethereum, solana...

    # Pricing & limits (fiat per 1 unit of crypto)
    price_per_unit = Column(Numeric(20, 6), nullable=False)
    min_fiat_amount = Column(Numeric(20, 2), nullable=False)
    max_fiat_amount = Column(Numeric(20, 2), nullable=False)
    # Total crypto the maker has committed to this offer (in base units / wei-equiv string).
    available_crypto = Column(String(78), nullable=True)

    # Accepted payment rails — JSON array of method codes e.g. ["bank_transfer","pix","wise"]
    payment_methods = Column(Text, nullable=False, default="[]")
    # ISO-3166 alpha-2 region the maker serves; null = global.
    region = Column(String(8), nullable=True, index=True)

    # Free-text terms / instructions shown to the taker.
    terms = Column(Text, nullable=True)
    # Minutes the taker has to pay before the trade auto-cancels.
    payment_window_minutes = Column(Integer, nullable=False, default=30)

    # Maker reputation snapshot (denormalized for cheap listing).
    completion_rate = Column(Float, nullable=False, default=1.0)
    trade_count = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    __table_args__ = (Index("ix_p2p_offers_pair", "fiat_currency", "crypto_asset", "status"),)

    def __repr__(self):
        return (
            f"<P2POffer {self.id} {self.offer_type} {self.crypto_asset}/"
            f"{self.fiat_currency} @{self.price_per_unit} {self.status}>"
        )


class P2PTrade(Base):
    """A single P2P trade against a native or external offer.

    Records trades across all sources so the user gets one unified history.
    For external providers, ``external_trade_id`` / ``external_offer_id`` hold
    the provider's references and ``escrow_*`` stays null.
    """

    __tablename__ = "p2p_trades"

    id = Column(Integer, primary_key=True, autoincrement=True)

    source = Column(String(16), nullable=False, default=P2PSource.NATIVE.value)
    # Native offer link (null for external trades).
    offer_id = Column(Integer, ForeignKey("p2p_offers.id"), nullable=True, index=True)
    external_offer_id = Column(String(255), nullable=True)
    external_trade_id = Column(String(255), nullable=True, index=True)

    # Parties. taker is the Suwappu user driving the trade; maker may be another
    # Suwappu user (native) or an external counterparty (we only know their handle).
    taker_user_id = Column(BigInteger, nullable=False, index=True)
    maker_user_id = Column(BigInteger, nullable=True, index=True)
    counterparty_handle = Column(String(255), nullable=True)

    status = Column(String(20), nullable=False, default=P2PTradeStatus.INITIATED.value, index=True)
    offer_type = Column(String(16), nullable=False)  # P2POfferType (taker's effective side)

    # Economics
    fiat_currency = Column(String(3), nullable=False)
    crypto_asset = Column(String(20), nullable=False)
    crypto_chain = Column(String(32), nullable=False, default="base")
    fiat_amount = Column(Numeric(20, 2), nullable=False)
    crypto_amount = Column(String(78), nullable=False)  # base units string
    price_per_unit = Column(Numeric(20, 6), nullable=False)
    payment_method = Column(String(64), nullable=False)

    # Native on-chain escrow (null for external trades)
    escrow_address = Column(String(255), nullable=True)
    escrow_lock_tx = Column(String(255), nullable=True)
    escrow_release_tx = Column(String(255), nullable=True)

    # Resolved EVM payout addresses captured server-side at trade creation, so
    # settlement never relies on free-text operator input. release_escrow pays
    # buyer_address; an escrow refund pays seller_address.
    buyer_address = Column(String(255), nullable=True)
    seller_address = Column(String(255), nullable=True)

    # Fiat-leg proof submitted by the payer
    fiat_payment_ref = Column(String(255), nullable=True)

    # Dispute / arbitration
    dispute_reason = Column(Text, nullable=True)
    disputed_at = Column(DateTime, nullable=True)
    # User (taker or maker) who opened the dispute.
    disputed_by = Column(BigInteger, nullable=True)
    # Arbiter resolution: 'release' (buyer wins → escrow to buyer) or 'refund'
    # (seller wins → escrow to seller). Null until an admin resolves.
    dispute_resolution = Column(String(16), nullable=True)
    resolved_by = Column(BigInteger, nullable=True)  # admin who arbitrated
    resolved_at = Column(DateTime, nullable=True)
    resolution_note = Column(Text, nullable=True)

    error_message = Column(Text, nullable=True)

    # Timing
    expires_at = Column(DateTime, nullable=True)  # payment window deadline
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    completed_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return (
            f"<P2PTrade {self.id} [{self.source}] {self.offer_type} "
            f"{self.crypto_amount} {self.crypto_asset}/{self.fiat_currency} {self.status}>"
        )
