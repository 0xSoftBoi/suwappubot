"""
Internal API routes for cross-service communication.

Authenticated via INTERNAL_API_KEY (shared secret between Python and TS services).
"""

import asyncio
import hashlib
import hmac
import logging
import re
from contextlib import contextmanager
from contextvars import ContextVar
from uuid import UUID
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, text
from sqlalchemy.exc import OperationalError

from typing import Optional, Dict, Any, Literal

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
    # Required: the caller (TS API) MUST assert which user owns this wallet so we
    # can enforce ownership before signing. The api-ts caller sends this field.
    user_id: int
    unsigned_transaction: dict
    chain_type: str = "evm"


class SignTransactionResponse(BaseModel):
    signed_transaction: str
    used_fallback: bool = False


def _verify_internal_key(x_internal_key: str = Header(None)):
    import os

    # Accept ONLY a dedicated internal secret. The agent_api_key (shared with
    # external AI agents) must NEVER unlock internal signing — falling back to it
    # let any agent key authenticate to /internal/sign-transaction. If no internal
    # secret is configured, fail closed (503) rather than open.
    expected = os.environ.get("INTERNAL_API_KEY") or getattr(settings, "internal_api_key", None)
    if not expected:
        raise HTTPException(status_code=503, detail="internal signing not configured")
    if not x_internal_key or not hmac.compare_digest(str(x_internal_key), str(expected)):
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

    with get_session() as session:
        wallet = session.query(Wallet).filter(Wallet.id == request.wallet_id).first()
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")

        # Ownership enforcement: the caller must prove the wallet belongs to the
        # user it claims to act for. Without this, possession of the internal key
        # let the caller sign a transaction for ANY wallet_id.
        if wallet.user_id != request.user_id:
            logger.warning(
                "Internal sign ownership mismatch: wallet %s belongs to user %s, "
                "request claimed user %s",
                request.wallet_id,
                wallet.user_id,
                request.user_id,
            )
            raise HTTPException(status_code=403, detail="Wallet does not belong to user")

        try:
            if request.chain_type == "evm":
                signed = await wallet_service.sign_evm_transaction(
                    wallet, request.unsigned_transaction
                )
            elif request.chain_type == "solana":
                tx_bytes = bytes.fromhex(request.unsigned_transaction.get("hex", ""))
                signed_bytes = await wallet_service.sign_solana_transaction(wallet, tx_bytes)
                signed = signed_bytes.hex()
            else:
                raise HTTPException(
                    status_code=400, detail=f"Unsupported chain type: {request.chain_type}"
                )

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


# ─── Tempo TIP-20 metadata ─────────────────────────────────


class TIP20InfoResponse(BaseModel):
    address: str
    name: str
    symbol: str
    decimals: int
    currency_code: str  # ISO-4217 (e.g. "USD") — empty for plain ERC-20s
    compliance_policy: Optional[str] = None
    is_tip20: bool


@router.get("/tempo/tip20/{token_address}", response_model=TIP20InfoResponse)
async def tempo_tip20_info(
    token_address: str,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Return TIP-20 metadata (currency code, compliance policy, is_tip20) for a
    Tempo token. Lets api-ts / the bot surface native TIP-20 details on demand
    without an on-chain call on every balance render.
    """
    _verify_internal_key(x_internal_key)

    from bot.services.tempo_tip20 import tempo_tip20

    try:
        info = await tempo_tip20.get_tip20_info(token_address)
    except Exception as e:
        logger.warning(f"TIP-20 info fetch failed for {token_address}: {e}")
        raise HTTPException(status_code=502, detail="TIP-20 info unavailable")

    return TIP20InfoResponse(
        address=info.address,
        name=info.name,
        symbol=info.symbol,
        decimals=info.decimals,
        currency_code=info.currency_code,
        compliance_policy=info.compliance_policy,
        is_tip20=info.is_tip20,
    )


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
    # On-chain payer (tx `from`). SECURITY: the TS caller MUST assert this maps to
    # a wallet bound to the authenticated agent/user (sender-spoof defense) before
    # crediting. May be None if the tx could not be resolved.
    sender: Optional[str] = None


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
        success, message, sender = await x402_service._verify_transaction_on_chain(
            tx_hash=request.tx_hash,
            chain=request.chain,
            expected_recipient=request.expected_recipient,
            expected_amount=amount,
            token_address=token_address,
        )

        return VerifyPaymentResponse(
            verified=success,
            error=message if not success else None,
            sender=sender,
        )
    except Exception as e:
        logger.error(f"x402 verification error: {e}")
        return VerifyPaymentResponse(
            verified=False,
            error=f"Verification error: {str(e)}",
        )


# ─── Agent Wallet Provisioning ─────────────────────────────


class AgentProvisionRequest(BaseModel):
    agent_uuid: UUID
    chain_type: Literal["evm", "solana"] = "evm"
    turnkey_wallet_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    turnkey_sub_org_id: str = Field(min_length=1, max_length=100)
    turnkey_account_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)


_EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_SOLANA_ADDRESS_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
_provision_retry_count: ContextVar[int] = ContextVar(
    "managed_agent_provision_retry_count", default=0
)


def _managed_agent_user_identity(agent_uuid: UUID) -> tuple[int, str]:
    """Return a stable, Telegram-namespaced DB identity for a managed agent.

    Real Telegram IDs are positive. A deterministic negative bigint keeps agent
    identities out of that namespace, while the full UUID in ``username`` lets
    us detect the vanishingly unlikely 63-bit digest collision instead of ever
    aliasing two agents to one execution user.
    """
    digest_value = int.from_bytes(hashlib.sha256(agent_uuid.bytes).digest()[:8], "big")
    numeric_id = digest_value & ((1 << 63) - 1)
    return -(numeric_id or 1), f"managed_agent:{agent_uuid}"


def _canonical_provision_address(request: AgentProvisionRequest) -> str:
    address = request.address.strip()
    valid = (
        _EVM_ADDRESS_RE.fullmatch(address)
        if request.chain_type == "evm"
        else _SOLANA_ADDRESS_RE.fullmatch(address)
    )
    if not valid:
        raise HTTPException(status_code=422, detail="Invalid managed wallet address")
    return address


def _wallet_addresses_match(left: str, right: str, chain_type: str) -> bool:
    if chain_type == "evm":
        return left.lower() == right.lower()
    return left == right


def _is_execution_lock_contention(error: OperationalError) -> bool:
    original = getattr(error, "orig", None)
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    return sqlstate == "55P03" or "could not obtain lock" in str(error).lower()


def _lock_managed_agent_identity(session, agent_int_id: int) -> None:
    """Serialize first registration on PostgreSQL before a User row exists."""
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        session.execute(
            text("SELECT pg_advisory_xact_lock(:identity_key)"),
            {"identity_key": agent_int_id},
        )


@router.post("/agent/provision-wallet")
async def provision_agent_wallet(
    request: AgentProvisionRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Register the TS-created Turnkey wallet as Python's execution wallet."""
    _verify_internal_key(x_internal_key)

    try:
        from bot.models.user import User

        agent_uuid = request.agent_uuid
        agent_int_id, agent_username = _managed_agent_user_identity(agent_uuid)
        address = _canonical_provision_address(request)
        wallet_name = f"agent_{str(agent_uuid)[:8]}"

        with get_session() as session:
            # Serialize even the first insert, when there is no User row to lock.
            _lock_managed_agent_identity(session, agent_int_id)
            user = (
                session.query(User)
                .filter(User.telegram_id == agent_int_id)
                .with_for_update()
                .first()
            )
            if user and user.username != agent_username:
                raise HTTPException(status_code=409, detail="Managed agent identity collision")
            if not user:
                user = User(
                    telegram_id=agent_int_id,
                    username=agent_username,
                    first_name="Managed Agent",
                )
                session.add(user)
                session.flush()
                logger.info(f"Created agent user: id={user.id}, telegram_id={agent_int_id}")
            user_id = user.id

            active_wallets = (
                session.query(Wallet)
                .filter(
                    Wallet.user_id == user_id,
                    Wallet.wallet_provider == "turnkey",
                    Wallet.chain_type == request.chain_type,
                    Wallet.is_active.is_(True),
                )
                .with_for_update()
                .all()
            )
            if len(active_wallets) > 1:
                raise HTTPException(status_code=409, detail="Managed wallet identity conflict")

            address_match = (
                func.lower(Wallet.address) == address.lower()
                if request.chain_type == "evm"
                else Wallet.address == address
            )
            identity_filters = [address_match]
            if request.turnkey_wallet_id:
                identity_filters.append(Wallet.turnkey_wallet_id == request.turnkey_wallet_id)
            if request.turnkey_account_id:
                identity_filters.append(Wallet.turnkey_account_id == request.turnkey_account_id)
            candidates = session.query(Wallet).filter(or_(*identity_filters)).all()
            if len(candidates) > 1:
                raise HTTPException(status_code=409, detail="Managed wallet identity conflict")

            if active_wallets:
                wallet = active_wallets[0]
                if candidates and candidates[0].id != wallet.id:
                    raise HTTPException(status_code=409, detail="Managed wallet identity conflict")
            elif candidates:
                wallet = candidates[0]
            else:
                wallet = None

            if wallet is not None:
                identity_matches = (
                    wallet.user_id == user_id
                    and wallet.wallet_provider == "turnkey"
                    and wallet.is_active is True
                    and wallet.turnkey_sub_org_id == request.turnkey_sub_org_id
                    and (
                        not request.turnkey_wallet_id
                        or wallet.turnkey_wallet_id == request.turnkey_wallet_id
                    )
                    and (
                        not request.turnkey_account_id
                        or wallet.turnkey_account_id == request.turnkey_account_id
                    )
                    and wallet.chain_type == request.chain_type
                    and _wallet_addresses_match(wallet.address, address, request.chain_type)
                )
                if not identity_matches:
                    raise HTTPException(status_code=409, detail="Managed wallet identity conflict")
            else:
                wallet = Wallet(
                    user_id=user_id,
                    name=wallet_name,
                    address=address,
                    encrypted_private_key=None,
                    encryption_scheme="turnkey",
                    wallet_provider="turnkey",
                    turnkey_sub_org_id=request.turnkey_sub_org_id,
                    turnkey_wallet_id=request.turnkey_wallet_id,
                    turnkey_account_id=request.turnkey_account_id,
                    chain_type=request.chain_type,
                    is_active=True,
                    is_default=True,
                )
                session.add(wallet)
                session.flush()

            wallet_id = wallet.id
            wallet_address = wallet.address

        logger.info(
            "Provisioned managed wallet for agent %s: user_id=%s, wallet_id=%s",
            str(agent_uuid)[:8],
            user_id,
            wallet_id,
        )

        return {
            "internal_user_id": user_id,
            "internal_wallet_id": wallet_id,
            "address": wallet_address,
        }

    except HTTPException:
        raise
    except OperationalError as e:
        # PostgreSQL is serialized by the advisory lock above. SQLite (used by
        # focused tests and some local installs) reports write contention
        # instead, so retry the complete idempotent transaction a bounded number
        # of times after rollback rather than exposing a transient 500.
        retry_count = _provision_retry_count.get()
        if "database is locked" in str(e).lower() and retry_count < 3:
            token = _provision_retry_count.set(retry_count + 1)
            try:
                await asyncio.sleep(0.05 * (retry_count + 1))
                return await provision_agent_wallet(request, x_internal_key)
            finally:
                _provision_retry_count.reset(token)
        logger.error("Agent provision database contention: %s", type(e).__name__)
        raise HTTPException(status_code=503, detail="Agent wallet provisioning busy")
    except Exception as e:
        logger.error(f"Agent provision failed: {e}")
        raise HTTPException(status_code=500, detail="Agent wallet provisioning failed")


# ─── Agent Swap Execution ─────────────────────────────


class AgentSwapRequest(BaseModel):
    agent_id: int
    agent_uuid: UUID
    wallet_address: str = Field(min_length=1, max_length=255)
    internal_user_id: int
    internal_wallet_id: int
    chain_type: Literal["evm", "solana"] = "evm"
    idempotency_key: Optional[str] = None
    quote_data: Dict[str, Any]


@contextmanager
def _require_agent_execution_wallet(request: AgentSwapRequest):
    """Lock and validate one managed wallet through the caller's execution."""
    expected_telegram_id, expected_username = _managed_agent_user_identity(request.agent_uuid)
    request_address = request.wallet_address.strip()
    valid_address = (
        _EVM_ADDRESS_RE.fullmatch(request_address)
        if request.chain_type == "evm"
        else _SOLANA_ADDRESS_RE.fullmatch(request_address)
    )
    if not valid_address:
        raise HTTPException(status_code=422, detail="Invalid managed wallet address")

    try:
        with get_session() as session:
            from bot.models.user import User

            user = (
                session.query(User)
                .filter(User.id == request.internal_user_id)
                .with_for_update(nowait=True)
                .first()
            )
            wallet = (
                session.query(Wallet)
                .filter(Wallet.id == request.internal_wallet_id)
                .with_for_update(nowait=True)
                .first()
            )
            if wallet is None or user is None:
                raise HTTPException(status_code=404, detail="Managed wallet not found")

            identity_matches = (
                wallet.user_id == request.internal_user_id
                and user.telegram_id == expected_telegram_id
                and user.username == expected_username
                and wallet.wallet_provider == "turnkey"
                and wallet.is_active is True
                and wallet.chain_type == request.chain_type
                and _wallet_addresses_match(
                    wallet.address,
                    request_address,
                    request.chain_type,
                )
            )
            if not identity_matches:
                logger.warning(
                    "Managed execution identity mismatch: agent=%s user_id=%s wallet_id=%s",
                    str(request.agent_uuid)[:8],
                    request.internal_user_id,
                    request.internal_wallet_id,
                )
                raise HTTPException(status_code=403, detail="Managed wallet identity mismatch")
            yield
    except OperationalError as error:
        if _is_execution_lock_contention(error):
            raise HTTPException(
                status_code=409,
                detail="Managed wallet execution is already in progress",
            ) from error
        raise


@router.post("/agent/execute-swap")
async def execute_agent_swap(
    request: AgentSwapRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Execute a swap using the full Python swap pipeline. Called by TS API."""
    _verify_internal_key(x_internal_key)

    try:
        from bot.services.swap_engine import SwapQuote, swap_engine
        from bot.services.fee_service import fee_service
        from datetime import datetime

        qd = request.quote_data

        # Carry the platform fee onto the rehydrated quote so EVM execution
        # re-fetches the swap tx WITH the fee param (agent/webapp swaps were
        # previously dropping it → collecting $0). Use the value the caller sent;
        # fall back to the default rate so collection still happens. On-chain
        # collection stays gated per-provider on a configured collector.
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
            timestamp=datetime.utcnow(),
            platform_fee_bps=qd.get("platform_fee_bps") or fee_service.get_fee_bps(),
        )

        logger.info(
            f"Executing swap for agent {str(request.agent_uuid)[:8]}: {quote.from_amount} {quote.from_token} → {quote.to_token}"
        )

        # Lock order is async wallet lock -> NOWAIT DB identity rows. Acquiring
        # the database rows first can deadlock the event loop when a second
        # request blocks synchronously while the first awaits provider I/O.
        async with swap_engine.wallet_execution_context(request.internal_wallet_id):
            with _require_agent_execution_wallet(request):
                swap_tx = await swap_engine.execute_swap(
                    quote=quote,
                    wallet_id=request.internal_wallet_id,
                    user_id=request.internal_user_id,
                    idempotency_key=request.idempotency_key,
                    _wallet_lock_held=True,
                )

        logger.info(
            f"Swap executed: id={swap_tx.id}, status={swap_tx.status}, tx_hash={swap_tx.tx_hash}"
        )

        return {
            "swap_id": swap_tx.id,
            "tx_hash": swap_tx.tx_hash,
            "status": swap_tx.status,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Agent swap execution failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ─── Internal Wallet Provisioning ─────────────────────────────


class ProvisionInternalWalletRequest(BaseModel):
    label: str
    chain_type: str = "evm"
    purpose: Optional[str] = None
    owner: Optional[str] = None
    ttl_days: Optional[int] = 30


class ProvisionInternalWalletResponse(BaseModel):
    name: str
    address: str
    chain_type: str
    created: bool


class RetireInternalWalletRequest(BaseModel):
    label: str
    reason: str
    retired_by: Optional[str] = None
    force: bool = False


@router.post("/provision-internal-wallet", response_model=ProvisionInternalWalletResponse)
async def provision_internal_wallet(
    request: ProvisionInternalWalletRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Provision an internal (non-operational) wallet for testing and deployments.

    Internal wallets are namespaced under 'internal/' and have both is_deposit_wallet
    and is_gas_payer flags set to False, preventing them from participating in
    operational flows (swap routing, gas payment, deposit cycles).
    """
    _verify_internal_key(x_internal_key)

    try:
        from bot.services.hot_wallet import hot_wallet_service

        wallet, created = await hot_wallet_service.provision_internal_wallet(
            label=request.label,
            chain_type=request.chain_type,
            purpose=request.purpose,
            owner=request.owner,
            ttl_days=request.ttl_days,
        )

        logger.info(
            f"{'Provisioned' if created else 'Reused'} internal wallet: "
            f"name={wallet.name}, address={wallet.address}, chain={wallet.chain_type}"
        )

        return ProvisionInternalWalletResponse(
            name=wallet.name,
            address=wallet.address,
            chain_type=wallet.chain_type,
            created=created,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Internal wallet provision failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/retire-internal-wallet")
async def retire_internal_wallet(
    request: RetireInternalWalletRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Decommission an internal wallet. Refuses if it still holds funds.

    Returns retired=False with the balances found rather than raising, so an
    automated caller can sweep and retry instead of treating it as an error.
    """
    _verify_internal_key(x_internal_key)

    try:
        from bot.services.hot_wallet import hot_wallet_service

        return await hot_wallet_service.retire_internal_wallet(
            label_or_name=request.label,
            reason=request.reason,
            retired_by=request.retired_by,
            force=request.force,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Internal wallet retire failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/internal-wallets")
async def audit_internal_wallets(
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Roster + balances: what is live, what is expired, what still holds funds."""
    _verify_internal_key(x_internal_key)

    try:
        from bot.services.hot_wallet import hot_wallet_service

        return await hot_wallet_service.audit_internal_wallets()
    except Exception as e:
        logger.error(f"Internal wallet audit failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class TokenSecurityRequest(BaseModel):
    chain: str
    token_address: str


class TokenSecurityResponse(BaseModel):
    """
    Token-security verdict for the autopilot's `security_scan_present` gate.

    Every field is optional and only set when we actually determined it. The
    caller treats a missing field as "unknown" and refuses the trade rather than
    assuming safe, so reporting a value we did not measure would be worse than
    reporting nothing.
    """

    chain: str
    token_address: str
    is_honeypot: Optional[bool] = None
    buy_tax_bps: Optional[int] = None
    sell_tax_bps: Optional[int] = None
    top_holder_pct: Optional[float] = None
    # Supply sitting in contracts (pools, vesting, bridges). Reported separately
    # from wallet concentration on purpose — a deep pool is not a whale.
    contract_held_pct: Optional[float] = None
    lp_locked: Optional[bool] = None
    mintable: Optional[bool] = None
    freezable: Optional[bool] = None
    verified: Optional[bool] = None
    flags: list = []
    sources: list = []


@router.post("/token-security", response_model=TokenSecurityResponse)
async def token_security(
    request: TokenSecurityRequest,
    x_internal_key: str = Header(None, alias="X-Internal-Key"),
):
    """Run the token-security stack for one token. Called by the api-ts autopilot."""
    _verify_internal_key(x_internal_key)

    chain = (request.chain or "").lower().strip()
    token = (request.token_address or "").strip()
    if not chain or not token:
        raise HTTPException(status_code=400, detail="chain and token_address are required")

    out = TokenSecurityResponse(chain=chain, token_address=token)
    sources = []
    flags = []

    # Holder concentration, deployer history and cluster/bundle flags — both stacks.
    try:
        from bot.services.token_intel.intel_service import token_intel_service

        # quick=True: the gate needs holder distribution and token info, not the
        # deployer-history walk that makes a full report take tens of seconds.
        report = await token_intel_service.analyze(token, chain, quick=True)
        if report.top10_pct is not None:
            out.top_holder_pct = float(report.top10_pct)
        if getattr(report, "contract_held_pct", None) is not None:
            out.contract_held_pct = float(report.contract_held_pct)
        if chain == "solana" and report.mint_authority is not None:
            # A live mint authority means supply can still be inflated.
            out.mintable = bool(report.mint_authority)
        flags.extend(report.flags or [])
        sources.append("token_intel")
    except Exception as e:
        logger.warning("token-security: intel failed for %s/%s: %s", chain, token, e)

    # Buy/sell simulation is Solana-only today (Jupiter round-trip). On EVM we
    # leave the tax fields unset rather than guessing.
    if chain == "solana":
        try:
            from bot.services.token_security.honeypot_detector import HoneypotDetector

            result = await HoneypotDetector().quick_check(token)
            out.is_honeypot = bool(result.is_honeypot)
            if result.buy_tax is not None:
                out.buy_tax_bps = int(round(float(result.buy_tax) * 100))
            if result.sell_tax is not None:
                out.sell_tax_bps = int(round(float(result.sell_tax) * 100))
            if result.reason is not None:
                flags.append(str(result.reason.value))
            sources.append("honeypot_detector")
        except Exception as e:
            logger.warning("token-security: honeypot check failed for %s: %s", token, e)

    out.flags = sorted(set(flags))
    out.sources = sources
    return out
