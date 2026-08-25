"""Tempo Machine Payments Protocol (MPP) client.

MPP enables streaming payments between agents and services.
Supports: one-time charges, pay-as-you-go sessions, and streamed payments.
Spec: mpp.dev
"""

import logging
from dataclasses import dataclass
from typing import Optional, List
from datetime import datetime, timezone

from bot.config.settings import settings
from bot.utils.http_client import get_session
from database.db import get_session as get_db_session

logger = logging.getLogger(__name__)

# MPP endpoints. NOTE (2026-07-26): the default hosts api.mpp.dev and
# directory.mpp.dev do NOT resolve (NXDOMAIN) — every call below fails until
# the protocol actually ships them. The whole MPP surface is therefore gated
# behind settings.mpp_enabled (default False); override these if MPP launches
# on different hosts.
MPP_API_BASE = settings.mpp_api_base
MPP_DIRECTORY_URL = settings.mpp_directory_url


@dataclass
class MPPService:
    """A service registered in the MPP directory."""

    url: str
    name: str
    description: str
    category: str
    fee_token: str  # Accepted TIP-20 token (usually pathUSD on Tempo)
    min_deposit: float
    supports_streaming: bool
    supports_one_time: bool


@dataclass
class MPPSession:
    """An active MPP streaming payment session."""

    session_id: str
    service_url: str
    service_name: str
    fee_token: str
    deposit_amount: float
    spent_amount: float
    status: str  # "active", "paused", "closed", "expired"
    created_at: datetime
    expires_at: Optional[datetime] = None


@dataclass
class MPPPaymentResult:
    """Result of an MPP payment."""

    success: bool
    tx_hash: Optional[str]
    amount: float
    fee_token: str
    service_url: str
    error: Optional[str] = None


class TempoMPP:
    """Client for Tempo's Machine Payments Protocol.

    MPP enables:
    - One-time payments to services
    - Streaming payment sessions (pay-as-you-go)
    - Service discovery via the payments directory
    """

    def __init__(self):
        self._sessions: dict[str, MPPSession] = {}

    async def get_directory(
        self,
        category: Optional[str] = None,
        limit: int = 20,
    ) -> List[MPPService]:
        """Fetch MPP-compatible services from the payments directory.

        Args:
            category: Filter by category (e.g. "ai", "data", "compute")
            limit: Max number of results
        """
        session = await get_session()

        params = {"limit": limit}
        if category:
            params["category"] = category

        try:
            async with session.get(
                f"{MPP_DIRECTORY_URL}/services",
                params=params,
            ) as response:
                if response.status != 200:
                    logger.warning(f"MPP directory error: {response.status}")
                    return []

                data = await response.json()
                return [
                    MPPService(
                        url=svc["url"],
                        name=svc["name"],
                        description=svc.get("description", ""),
                        category=svc.get("category", ""),
                        fee_token=svc.get("feeToken", "pathUSD"),
                        min_deposit=svc.get("minDeposit", 0),
                        supports_streaming=svc.get("supportsStreaming", False),
                        supports_one_time=svc.get("supportsOneTime", True),
                    )
                    for svc in data.get("services", [])
                ]
        except Exception as e:
            logger.error(f"MPP directory fetch failed: {e}")
            return []

    async def pay_one_time(
        self,
        service_url: str,
        amount: float,
        fee_token: str = "pathUSD",
        from_address: Optional[str] = None,
    ) -> MPPPaymentResult:
        """Make a one-time payment to an MPP service.

        Args:
            service_url: The MPP service endpoint URL
            amount: Payment amount in fee_token units
            fee_token: TIP-20 token symbol (default pathUSD)
            from_address: Sender wallet address
        """
        session = await get_session()

        try:
            async with session.post(
                f"{MPP_API_BASE}/pay",
                json={
                    "serviceUrl": service_url,
                    "amount": str(amount),
                    "feeToken": fee_token,
                    "fromAddress": from_address,
                },
            ) as response:
                data = await response.json()

                if response.status != 200:
                    return MPPPaymentResult(
                        success=False,
                        tx_hash=None,
                        amount=amount,
                        fee_token=fee_token,
                        service_url=service_url,
                        error=data.get("error", "Payment failed"),
                    )

                return MPPPaymentResult(
                    success=True,
                    tx_hash=data.get("txHash"),
                    amount=amount,
                    fee_token=fee_token,
                    service_url=service_url,
                )
        except Exception as e:
            logger.error(f"MPP payment failed: {e}")
            return MPPPaymentResult(
                success=False,
                tx_hash=None,
                amount=amount,
                fee_token=fee_token,
                service_url=service_url,
                error=str(e),
            )

    async def create_session(
        self,
        service_url: str,
        deposit_amount: float,
        fee_token: str = "pathUSD",
        from_address: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> Optional[MPPSession]:
        """Open a streaming payment session with an MPP service.

        Args:
            service_url: The MPP service endpoint URL
            deposit_amount: Initial deposit amount
            fee_token: TIP-20 token for payments (default pathUSD)
            from_address: Sender wallet address
            user_id: Database user ID for persistence
        """
        session = await get_session()

        try:
            async with session.post(
                f"{MPP_API_BASE}/sessions",
                json={
                    "serviceUrl": service_url,
                    "depositAmount": str(deposit_amount),
                    "feeToken": fee_token,
                    "fromAddress": from_address,
                },
            ) as response:
                if response.status != 200:
                    data = await response.json()
                    logger.warning(f"MPP session creation failed: {data}")
                    return None

                data = await response.json()
                mpp_session = MPPSession(
                    session_id=data["sessionId"],
                    service_url=service_url,
                    service_name=data.get("serviceName", service_url),
                    fee_token=fee_token,
                    deposit_amount=deposit_amount,
                    spent_amount=0,
                    status="active",
                    created_at=datetime.now(timezone.utc),
                )
                self._sessions[mpp_session.session_id] = mpp_session

                # Persist to database
                self._persist_session(mpp_session, user_id)

                return mpp_session
        except Exception as e:
            logger.error(f"MPP session creation failed: {e}")
            return None

    async def close_session(self, session_id: str) -> bool:
        """Close a streaming payment session and settle.

        Args:
            session_id: The session ID to close
        """
        session = await get_session()

        try:
            async with session.post(
                f"{MPP_API_BASE}/sessions/{session_id}/close",
            ) as response:
                if response.status == 200:
                    if session_id in self._sessions:
                        self._sessions[session_id].status = "closed"

                    # Update database
                    self._close_session_in_db(session_id)

                    return True
                return False
        except Exception as e:
            logger.error(f"MPP session close failed: {e}")
            return False

    def get_active_sessions(self, user_id: Optional[int] = None) -> List[MPPSession]:
        """Get all active MPP sessions, optionally filtered by user.

        Reads from database first, falls back to in-memory for in-flight sessions.
        """
        # Try database first
        db_sessions = self._load_sessions_from_db(user_id)
        if db_sessions:
            return db_sessions

        # Fall back to in-memory
        sessions = [s for s in self._sessions.values() if s.status == "active"]
        if user_id is not None:
            return sessions  # Can't filter by user without DB
        return sessions

    def load_sessions(self) -> None:
        """Load active sessions from database into memory on startup."""
        sessions = self._load_sessions_from_db()
        for s in sessions:
            self._sessions[s.session_id] = s
        if sessions:
            logger.info(f"Loaded {len(sessions)} active MPP sessions from database")

    # ─── Database helpers ───────────────────────────────────

    def _persist_session(self, mpp_session: MPPSession, user_id: Optional[int] = None) -> None:
        """Save a session to the database."""
        try:
            from bot.models.subscription import MPPSessionRecord

            with get_db_session() as db:
                record = MPPSessionRecord(
                    session_id=mpp_session.session_id,
                    user_id=user_id,
                    service_url=mpp_session.service_url,
                    service_name=mpp_session.service_name,
                    fee_token=mpp_session.fee_token,
                    deposit_amount=mpp_session.deposit_amount,
                    spent_amount=mpp_session.spent_amount,
                    status=mpp_session.status,
                    created_at=mpp_session.created_at,
                    expires_at=mpp_session.expires_at,
                )
                db.add(record)
        except Exception as e:
            logger.error(f"Failed to persist MPP session: {e}")

    def _close_session_in_db(self, session_id: str) -> None:
        """Mark a session as closed in the database."""
        try:
            from bot.models.subscription import MPPSessionRecord

            with get_db_session() as db:
                record = (
                    db.query(MPPSessionRecord)
                    .filter(MPPSessionRecord.session_id == session_id)
                    .first()
                )
                if record:
                    record.status = "closed"
                    record.closed_at = datetime.now(timezone.utc)
        except Exception as e:
            logger.error(f"Failed to close MPP session in DB: {e}")

    def _load_sessions_from_db(self, user_id: Optional[int] = None) -> List[MPPSession]:
        """Load active sessions from the database."""
        try:
            from bot.models.subscription import MPPSessionRecord

            with get_db_session() as db:
                query = db.query(MPPSessionRecord).filter(MPPSessionRecord.status == "active")
                if user_id is not None:
                    query = query.filter(MPPSessionRecord.user_id == user_id)

                records = query.all()
                return [
                    MPPSession(
                        session_id=r.session_id,
                        service_url=r.service_url,
                        service_name=r.service_name or r.service_url,
                        fee_token=r.fee_token,
                        deposit_amount=r.deposit_amount,
                        spent_amount=r.spent_amount,
                        status=r.status,
                        created_at=r.created_at,
                        expires_at=r.expires_at,
                    )
                    for r in records
                ]
        except Exception as e:
            logger.error(f"Failed to load MPP sessions from DB: {e}")
            return []


# Global instance
tempo_mpp = TempoMPP()
