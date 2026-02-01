"""Internal API endpoints called by the TypeScript API over HTTP.

These are NOT exposed publicly. Access is gated by a shared secret
(INTERNAL_API_KEY env var) passed in the X-Internal-Key header.
"""

import logging
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from database.db import get_session, DATABASE_AVAILABLE
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction, SwapStatus
from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.services.turnkey_client import get_turnkey_client, is_turnkey_configured
from bot.utils.exceptions import SwapError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/agent", tags=["Internal"])

INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")


def _verify_internal_key(x_internal_key: str = Header(...)):
    """Verify the shared internal API key."""
    if not INTERNAL_API_KEY:
        raise HTTPException(status_code=500, detail="INTERNAL_API_KEY not configured")
    if x_internal_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid internal key")


# ----- Request/Response Models -----

class ProvisionWalletRequest(BaseModel):
    agent_uuid: str
    chain_type: str = "evm"


class ProvisionWalletResponse(BaseModel):
    internal_user_id: int
    internal_wallet_id: int
    wallet_address: str


class ExecuteSwapRequest(BaseModel):
    agent_id: int
    agent_uuid: str
    wallet_address: str
    internal_user_id: int
    internal_wallet_id: int
    chain_type: str = "evm"
    idempotency_key: Optional[str] = None
    # Quote data fields (matches SwapQuote constructor)
    quote_data: dict


class ExecuteSwapResponse(BaseModel):
    swap_id: int
    tx_hash: Optional[str]
    status: str


# ----- Endpoints -----

@router.post("/provision-wallet", response_model=ProvisionWalletResponse)
async def provision_wallet(
    request: ProvisionWalletRequest,
    x_internal_key: str = Header(...),
):
    """Create an internal User + Wallet row for an agent (Turnkey-backed)."""
    _verify_internal_key(x_internal_key)

    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")

    if not is_turnkey_configured():
        raise HTTPException(status_code=501, detail="Turnkey not configured")

    turnkey = get_turnkey_client()
    username = f"agent_{request.agent_uuid}"

    with get_session() as session:
        # Reuse existing user if one was already provisioned for this agent
        user = session.query(User).filter(User.username == username).first()
        if not user:
            user = User(
                telegram_id=None,
                username=username,
                created_at=datetime.utcnow(),
                tos_accepted=True,
                tos_accepted_at=datetime.utcnow(),
            )
            session.add(user)
            session.flush()

    # Create a Turnkey sub-org + wallet
    sub_org_name = f"agent_{request.agent_uuid}"
    sub_org = await turnkey.create_sub_organization(name=sub_org_name)

    turnkey_wallet = await turnkey.create_wallet(
        wallet_name=f"Agent Wallet ({request.chain_type})",
        chain_type=request.chain_type,
        organization_id=sub_org.sub_org_id,
    )

    with get_session() as session:
        user = session.query(User).filter(User.username == username).first()
        wallet = Wallet(
            user_id=user.id,
            name=f"Agent Wallet",
            address=turnkey_wallet.address or "",
            chain_type=request.chain_type,
            wallet_provider="turnkey",
            turnkey_sub_org_id=sub_org.sub_org_id,
            turnkey_wallet_id=turnkey_wallet.wallet_id,
            turnkey_account_id=turnkey_wallet.account_id,
            is_active=True,
            is_default=True,
        )
        session.add(wallet)
        session.flush()
        wallet_id = wallet.id
        user_id = user.id
        wallet_addr = wallet.address

    return ProvisionWalletResponse(
        internal_user_id=user_id,
        internal_wallet_id=wallet_id,
        wallet_address=wallet_addr,
    )


@router.post("/execute-swap", response_model=ExecuteSwapResponse)
async def execute_swap(
    request: ExecuteSwapRequest,
    x_internal_key: str = Header(...),
):
    """Execute a swap using the full Python swap pipeline on behalf of an agent."""
    _verify_internal_key(x_internal_key)

    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Rebuild a SwapQuote from the TS-provided quote_data dict
    qd = request.quote_data
    try:
        quote = SwapQuote(
            provider=qd.get("provider", "lifi"),
            from_chain=qd["from_chain"],
            to_chain=qd["to_chain"],
            from_token=qd["from_token"],
            to_token=qd["to_token"],
            from_amount=qd["from_amount"],
            from_amount_human=float(qd.get("from_amount_human", 0)),
            to_amount=qd["to_amount"],
            to_amount_human=float(qd.get("to_amount_human", 0)),
            to_amount_min=qd.get("to_amount_min", qd["to_amount"]),
            gas_cost_usd=float(qd.get("gas_cost_usd", 0)),
            fee_cost_usd=float(qd.get("fee_cost_usd", 0)),
            total_cost_usd=float(qd.get("total_cost_usd", 0)),
            estimated_time=int(qd.get("estimated_time", 60)),
            price_impact=float(qd.get("price_impact", 0)),
            exchange_rate=float(qd.get("exchange_rate", 0)),
            raw_quote=qd.get("raw_quote", {}),
            timestamp=datetime.utcnow(),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid quote_data: {exc}")

    engine = SwapEngine()

    try:
        swap_tx = await engine.execute_swap(
            quote=quote,
            wallet_id=request.internal_wallet_id,
            user_id=request.internal_user_id,
            idempotency_key=request.idempotency_key,
        )
    except SwapError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Internal execute-swap failed")
        raise HTTPException(status_code=500, detail=str(exc))

    # Stamp agent linkage onto the swap record
    with get_session() as session:
        db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_tx.id).first()
        if db_tx:
            db_tx.agent_id = request.agent_id
            db_tx.agent_uuid = request.agent_uuid

    # Fire swap.submitted webhook (inline, non-blocking)
    try:
        from bot.services.webhook_dispatcher import webhook_dispatcher
        from bot.models.agent import RegisteredAgent

        with get_session() as session:
            agent = session.query(RegisteredAgent).filter(
                RegisteredAgent.id == request.agent_id
            ).first()
            # Fall back to the TS agents table via agent_id -- but RegisteredAgent
            # may not have a matching row if the agent was registered via the TS API.
            # In that case the tx_poller webhook path will handle delivery.

        if agent and agent.callback_url:
            import json as _json
            payload = _json.dumps({
                "event": "swap.submitted",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "data": {
                    "swap_id": swap_tx.id,
                    "status": swap_tx.status,
                    "tx_hash": swap_tx.tx_hash,
                    "from_chain": swap_tx.from_chain,
                    "from_token": swap_tx.from_token,
                    "from_amount": swap_tx.from_amount,
                    "to_chain": swap_tx.to_chain,
                    "to_token": swap_tx.to_token,
                    "to_amount": swap_tx.to_amount,
                },
            })
            await webhook_dispatcher.dispatch(
                agent_id=request.agent_id,
                event_type="swap.submitted",
                payload=payload,
                callback_url=agent.callback_url,
            )
    except Exception as e:
        logger.warning(f"Failed to dispatch swap.submitted webhook: {e}")

    return ExecuteSwapResponse(
        swap_id=swap_tx.id,
        tx_hash=swap_tx.tx_hash,
        status=swap_tx.status,
    )
