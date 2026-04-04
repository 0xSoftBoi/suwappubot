"""
Internal API routes for cross-service communication.

Authenticated via INTERNAL_API_KEY (shared secret between Python and TS services).
"""

import logging
import os
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from typing import Optional, Dict, Any

from bot.config.settings import settings
from bot.services.wallet import WalletService
from bot.services.x402_service import x402_service
from bot.models.user import Wallet
from database.db import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])

wallet_service = WalletService()


class SignTransactionRequest(BaseModel):
    wallet_id: int
    unsigned_transaction: dict
    chain_type: str = "evm"


class SignTransactionResponse(BaseModel):
    signed_transaction: str
    used_fallback: bool = False


def _verify_internal_key(x_internal_key: str = Header(None)):
    import os
    expected = os.environ.get("INTERNAL_API_KEY") or getattr(settings, 'internal_api_key', None) or getattr(settings, 'agent_api_key', None)
    if not expected or x_internal_key != expected:
        raise HTTPException(status_code=401, detail="Invalid internal API key")


@router.post("/sign-transaction", response_model=SignTransactionResponse)
async def sign_transaction(
    request: SignTransactionRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """
    Sign a transaction using a wallet's backup key.

    Used by the TS API when Turnkey is unavailable and it needs to delegate
    signing to the Python service (which has KMS access for backup keys).
    """
    _verify_internal_key(x_internal_key)

    # Spending limit check
    max_usd = float(os.environ.get("MAX_SIGNING_AMOUNT_USD", "10000"))
    tx_value_raw = request.unsigned_transaction.get("value") or request.unsigned_transaction.get("amount")
    tx_amount_usd: Optional[float] = None
    try:
        if tx_value_raw is not None:
            tx_amount_usd = float(tx_value_raw)
    except (TypeError, ValueError):
        logger.warning(
            "sign-transaction: unparseable value field — rejecting",
            extra={"wallet_id": request.wallet_id, "value_raw": str(tx_value_raw)[:64]},
        )
        raise HTTPException(status_code=422, detail="Transaction value could not be parsed; signing rejected")

    logger.info(
        "sign-transaction request",
        extra={
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "wallet_id": request.wallet_id,
            "chain_type": request.chain_type,
            "amount_usd": tx_amount_usd,
            "destination": request.unsigned_transaction.get("to") or request.unsigned_transaction.get("destination"),
        },
    )

    if tx_amount_usd is not None and tx_amount_usd > max_usd:
        logger.warning(
            "sign-transaction: amount exceeds MAX_SIGNING_AMOUNT_USD — rejected",
            extra={"amount_usd": tx_amount_usd, "limit_usd": max_usd, "wallet_id": request.wallet_id},
        )
        raise HTTPException(
            status_code=422,
            detail=f"Transaction value ${tx_amount_usd} exceeds signing limit ${max_usd}",
        )

    with get_session() as session:
        wallet = session.query(Wallet).filter(Wallet.id == request.wallet_id).first()
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")

        try:
            if request.chain_type == "evm":
                signed = await wallet_service.sign_evm_transaction(wallet, request.unsigned_transaction)
            elif request.chain_type == "solana":
                tx_bytes = bytes.fromhex(request.unsigned_transaction.get("hex", ""))
                signed_bytes = await wallet_service.sign_solana_transaction(wallet, tx_bytes)
                signed = signed_bytes.hex()
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported chain type: {request.chain_type}")

            # Check if fallback was used
            from bot.services.turnkey_fallback import get_circuit_breaker
            used_fallback = get_circuit_breaker().is_open

            return SignTransactionResponse(
                signed_transaction=signed,
                used_fallback=used_fallback,
            )

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"Internal signing failed for wallet {request.wallet_id}: {e}")
            raise HTTPException(status_code=500, detail="Signing failed")


# ─── x402 Payment Verification ─────────────────────────────


class VerifyPaymentRequest(BaseModel):
    tx_hash: str
    chain: str = "tempo"
    expected_amount: str
    expected_token: str = "pathUSD"
    expected_recipient: str


class VerifyPaymentResponse(BaseModel):
    verified: bool
    error: Optional[str] = None


@router.post("/x402/verify", response_model=VerifyPaymentResponse)
async def verify_x402_payment(
    request: VerifyPaymentRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """
    Verify an on-chain payment for MPP/x402 402 flow.

    Called by the TS API mppAuth middleware to confirm that a payment
    transaction matches the expected amount, token, and recipient.
    """
    _verify_internal_key(x_internal_key)

    # Resolve token address from symbol
    chain_tokens = x402_service.payment_tokens.get(request.chain, {})
    token_address = chain_tokens.get(request.expected_token)

    if not token_address and request.expected_token:
        # Try case-insensitive lookup
        for sym, addr in chain_tokens.items():
            if sym.lower() == request.expected_token.lower():
                token_address = addr
                break

    try:
        amount = float(request.expected_amount)
    except (ValueError, TypeError):
        return VerifyPaymentResponse(
            verified=False,
            error=f"Invalid amount: {request.expected_amount}",
        )

    try:
        success, message = x402_service._verify_transaction_on_chain(
            tx_hash=request.tx_hash,
            chain=request.chain,
            expected_recipient=request.expected_recipient,
            expected_amount=amount,
            token_address=token_address,
        )

        return VerifyPaymentResponse(
            verified=success,
            error=message if not success else None,
        )
    except Exception as e:
        logger.error(f"x402 verification error: {e}")
        return VerifyPaymentResponse(
            verified=False,
            error=f"Verification error: {str(e)}",
        )


# ─── Agent Wallet Provisioning ─────────────────────────────


class AgentProvisionRequest(BaseModel):
    agent_uuid: str
    chain_type: str = "evm"
    turnkey_wallet_id: Optional[str] = None
    turnkey_sub_org_id: Optional[str] = None


@router.post("/agent/provision-wallet")
async def provision_agent_wallet(
    request: AgentProvisionRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Create a User + Wallet row for an agent. Called by TS API after Turnkey wallet creation."""
    _verify_internal_key(x_internal_key)

    try:
        from bot.models.user import User
        agent_int_id = abs(hash(request.agent_uuid)) % (2**31 - 1)

        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == agent_int_id).first()
            if not user:
                user = User(
                    telegram_id=agent_int_id,
                    username=f"agent_{request.agent_uuid[:8]}",
                    first_name="Agent",
                )
                session.add(user)
                session.flush()
                logger.info(f"Created agent user: id={user.id}, telegram_id={agent_int_id}")
            user_id = user.id

        # Create Turnkey-managed wallet row directly — no local key encryption needed
        from datetime import datetime as dt
        with get_session() as session:
            wallet = Wallet(
                user_id=user_id,
                name=f"agent_{request.agent_uuid[:8]}",
                address="pending",
                encrypted_private_key="turnkey_managed",
                encryption_scheme="turnkey",
                wallet_provider="turnkey",
                turnkey_wallet_id=request.turnkey_wallet_id,
                turnkey_sub_org_id=request.turnkey_sub_org_id,
                chain_type=request.chain_type,
                is_active=True,
                is_default=True,
                created_at=dt.utcnow(),
            )
            session.add(wallet)
            session.flush()
            wallet_id = wallet.id

        logger.info(f"Provisioned wallet for agent {request.agent_uuid[:8]}: user_id={user_id}, wallet_id={wallet_id}")

        return {
            "internal_user_id": user_id,
            "internal_wallet_id": wallet_id,
        }

    except Exception as e:
        logger.error(f"Agent provision failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Agent Swap Execution ─────────────────────────────


class AgentSwapRequest(BaseModel):
    agent_id: int
    agent_uuid: str
    wallet_address: str
    internal_user_id: int
    internal_wallet_id: int
    chain_type: str = "evm"
    idempotency_key: Optional[str] = None
    quote_data: Dict[str, Any]


@router.post("/agent/execute-swap")
async def execute_agent_swap(
    request: AgentSwapRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Execute a swap using the full Python swap pipeline. Called by TS API."""
    _verify_internal_key(x_internal_key)

    try:
        from bot.services.swap_engine import SwapEngine, SwapQuote
        swap_engine = SwapEngine()
        from datetime import datetime, timezone

        qd = request.quote_data

        quote = SwapQuote(
            provider=qd.get("provider", "lifi"),
            from_chain=str(qd.get("from_chain", "base")),
            to_chain=str(qd.get("to_chain", "base")),
            from_token=str(qd.get("from_token", "")),
            to_token=str(qd.get("to_token", "")),
            from_amount=str(qd.get("from_amount", "0")),
            from_amount_human=float(qd.get("from_amount_human", 0)),
            to_amount=str(qd.get("to_amount", "0")),
            to_amount_human=float(qd.get("to_amount_human", 0)),
            to_amount_min=str(qd.get("to_amount_min", qd.get("to_amount", "0"))),
            gas_cost_usd=float(qd.get("gas_cost_usd", 0)),
            fee_cost_usd=float(qd.get("fee_cost_usd", 0)),
            total_cost_usd=float(qd.get("total_cost_usd", 0)),
            estimated_time=int(qd.get("estimated_time", 60)),
            price_impact=float(qd.get("price_impact", 0)),
            exchange_rate=float(qd.get("exchange_rate", 0)),
            raw_quote=qd.get("raw_quote", {}),
            timestamp=datetime.now(timezone.utc),
        )

        logger.info(f"Executing swap for agent {request.agent_uuid[:8]}: {quote.from_amount} {quote.from_token} → {quote.to_token}")

        swap_tx = await swap_engine.execute_swap(
            quote=quote,
            wallet_id=request.internal_wallet_id,
            user_id=request.internal_user_id,
            idempotency_key=request.idempotency_key,
        )

        logger.info(f"Swap executed: id={swap_tx.id}, status={swap_tx.status}, tx_hash={swap_tx.tx_hash}")

        return {
            "swap_id": swap_tx.id,
            "tx_hash": swap_tx.tx_hash,
            "status": swap_tx.status,
        }

    except Exception as e:
        logger.error(f"Agent swap execution failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
