"""Persistence for in-flight CCTP V2 -> HyperCore deposits.

A CCTP native-USDC deposit is a multi-step, cross-chain, asynchronous flow: the
user burns USDC on a source chain, then a HYPE-funded relayer waits for Circle's
attestation and completes the mint + HyperCore credit on HyperEVM. We persist
each deposit so the relayer can resume across restarts, never double-process, and
notify the user when funds land. See bot/services/cctp_relayer.py.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, Numeric, Index

from database.db import Base


class CctpDeposit(Base):
    """A single CCTP V2 deposit being relayed into a HyperCore account."""

    __tablename__ = "cctp_deposits"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    hl_address = Column(String(66), nullable=False)  # recipient HyperCore/HL account

    from_chain = Column(String(40), nullable=False)
    burn_tx_hash = Column(String(80), nullable=False, unique=True, index=True)
    amount_raw = Column(Numeric(precision=40, scale=0), nullable=False)  # 6dp USDC, smallest units

    # Status machine:
    #   burned   -> source burn submitted, awaiting Circle attestation
    #   attested -> attestation retrieved, ready to mint on HyperEVM
    #   minted   -> receiveMessage done (native USDC on HyperEVM) + gas-dropped
    #   credited -> ERC20 transfer to system address done (HyperCore spot credited)
    #   failed   -> a step errored; last_error has detail
    status = Column(String(20), default="burned", index=True)
    last_error = Column(String(400), nullable=True)
    attempts = Column(Integer, default=0)

    mint_tx_hash = Column(String(80), nullable=True)  # HyperEVM receiveMessage tx
    credit_tx_hash = Column(String(80), nullable=True)  # HyperEVM->Core transfer tx

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CctpGenericDeposit(Base):
    """A single generic-rail CCTP V2 transfer (bot/services/cctp_api.py) being
    relayed to completion by bot/services/cctp_generic_relayer.py.

    Unlike CctpDeposit (which always mints on HyperEVM and then credits
    HyperCore), a generic-rail transfer's destination is ARBITRARY -- any of
    the CCTP V2 EVM domains in cctp_api.CCTP_DOMAINS. There is no HyperCore
    credit step: `receiveMessage` on `to_chain` mints native USDC straight to
    `recipient_address` and the transfer is done.
    """

    __tablename__ = "cctp_generic_deposits"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    recipient_address = Column(String(66), nullable=False)

    from_chain = Column(String(40), nullable=False)
    to_chain = Column(String(40), nullable=False)
    burn_tx_hash = Column(String(80), nullable=False, unique=True, index=True)
    amount_raw = Column(Numeric(precision=40, scale=0), nullable=False)  # 6dp USDC, smallest units
    version = Column(Integer, default=2)  # CCTP version the burn was built with (must match mint)

    # Status machine:
    #   pending_broadcast -> record_burn called BEFORE send_raw_transaction so
    #                a crash/timeout mid-broadcast still leaves a DB row (see
    #                swap_engine._execute_cctp_swap). Reconciled against the
    #                SOURCE chain receipt, promoted to "burned" or dropped.
    #   burned   -> source burn confirmed broadcast, awaiting Circle attestation
    #   attested -> attestation retrieved (reserved; current relayer collapses
    #                this straight into a mint attempt within one pass)
    #   minted   -> receiveMessage done (or verified already-relayed via
    #                MessageTransmitterV2.usedNonces) on to_chain; transfer complete
    #   failed   -> terminal; max attempts/stall-hours exhausted, last_error has
    #                detail, admins alerted -- requires human intervention/requeue
    status = Column(String(20), default="pending_broadcast", index=True)
    last_error = Column(String(400), nullable=True)
    attempts = Column(Integer, default=0)  # genuine/permanent relayer errors
    stall_count = Column(
        Integer, default=0
    )  # transient/insufficient-gas errors (never terminal by count alone)

    mint_tx_hash = Column(String(80), nullable=True)  # to_chain receiveMessage tx (or sentinel)

    # Claim/lease so two relayer replicas never both broadcast the same receiveMessage.
    claimed_at = Column(DateTime, nullable=True)
    claimed_by = Column(String(120), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_cctp_generic_deposits_status_attempts", "status", "attempts"),)
