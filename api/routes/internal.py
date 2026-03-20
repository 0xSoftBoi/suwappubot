"""
Internal API routes for cross-service communication.

Authenticated via INTERNAL_API_KEY (shared secret between Python and TS services).
"""

import logging
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from typing import Optional

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


def _verify_internal_key(x_internal_api_key: str = Header(None)):
    expected = getattr(settings, 'agent_api_key', None)
    if not expected or x_internal_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid internal API key")


@router.post("/sign-transaction", response_model=SignTransactionResponse)
async def sign_transaction(
    request: SignTransactionRequest,
    x_internal_api_key: str = Header(None),
):
    """
    Sign a transaction using a wallet's backup key.

    Used by the TS API when Turnkey is unavailable and it needs to delegate
    signing to the Python service (which has KMS access for backup keys).
    """
    _verify_internal_key(x_internal_api_key)

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
    x_internal_api_key: str = Header(None),
):
    """
    Verify an on-chain payment for MPP/x402 402 flow.

    Called by the TS API mppAuth middleware to confirm that a payment
    transaction matches the expected amount, token, and recipient.
    """
    _verify_internal_key(x_internal_api_key)

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
