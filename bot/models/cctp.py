"""Persistence for in-flight CCTP V2 -> HyperCore deposits.

A CCTP native-USDC deposit is a multi-step, cross-chain, asynchronous flow: the
user burns USDC on a source chain, then a HYPE-funded relayer waits for Circle's
attestation and completes the mint + HyperCore credit on HyperEVM. We persist
each deposit so the relayer can resume across restarts, never double-process, and
notify the user when funds land. See bot/services/cctp_relayer.py.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, Numeric

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
