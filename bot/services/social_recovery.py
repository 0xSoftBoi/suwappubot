"""Social recovery via DKIM-verified email.

Flow:
  1. request_recovery(email, new_telegram_id) — from a new account that lost
     access. Looks the user up by their registered recovery email and creates a
     time-locked RecoveryRequest with a random challenge token.
  2. submit_approval_email(raw) — an email worker feeds in a received message.
     We DKIM-verify it, require it to come from the registered recovery address
     and carry the challenge token in its subject, then mark the request
     approved.
  3. finalize_recovery(request_id) — allowed only once the time-lock has elapsed
     AND the request is approved. Transfers control of the account (and thus its
     wallets) to the new Telegram id.
  4. cancel_recovery(request_id) — the original owner can cancel any time before
     execution, defeating a fraudulent recovery within the delay window.

The mandatory delay is the anti-theft property: a stolen recovery email alone
cannot instantly take an account; the real owner has the delay window to cancel.
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple

from bot.models.recovery import RecoveryRequest, RecoveryStatus
from bot.models.user import User
from bot.services.dkim_verifier import PublicKeyResolver, verify_email
from database.db import get_session

logger = logging.getLogger(__name__)

DEFAULT_DELAY_SECONDS = 86400  # 24h time-lock before a recovery can execute
DEFAULT_EXPIRY_SECONDS = 7 * 86400  # a request must complete within 7 days


class SocialRecoveryService:
    """DKIM-email social recovery state machine."""

    def request_recovery(
        self,
        guardian_email: str,
        new_telegram_id: int,
        delay_seconds: int = DEFAULT_DELAY_SECONDS,
    ) -> Tuple[Optional[dict], str]:
        """Create a recovery request. Returns (request_dict, message).

        request_dict is None on failure (no such recovery email, etc.).
        """
        guardian_email = guardian_email.strip().lower()
        now = datetime.utcnow()
        with get_session() as session:
            user = session.query(User).filter(User.recovery_email == guardian_email).first()
            if not user:
                return None, "No account is registered with that recovery email."

            # One active request per user. Reuse an existing live one rather than
            # spawning duplicates (which would each reset the time-lock).
            existing = (
                session.query(RecoveryRequest)
                .filter(
                    RecoveryRequest.user_id == user.id,
                    RecoveryRequest.status.in_([RecoveryStatus.PENDING, RecoveryStatus.APPROVED]),
                    RecoveryRequest.expires_at > now,
                )
                .first()
            )
            if existing:
                return (
                    self._to_dict(existing),
                    "A recovery is already in progress for this account.",
                )

            challenge = secrets.token_hex(8)
            req = RecoveryRequest(
                user_id=user.id,
                new_telegram_id=new_telegram_id,
                guardian_email=guardian_email,
                challenge=challenge,
                status=RecoveryStatus.PENDING,
                delay_seconds=delay_seconds,
                requested_at=now,
                execute_after=now + timedelta(seconds=delay_seconds),
                expires_at=now + timedelta(seconds=DEFAULT_EXPIRY_SECONDS),
            )
            session.add(req)
            session.flush()
            return self._to_dict(req), "Recovery request created."

    def submit_approval_email(
        self, raw_email: bytes, resolver: Optional[PublicKeyResolver] = None
    ) -> Tuple[bool, str]:
        """DKIM-verify an approval email and, if valid, approve the matching
        pending request. Returns (approved, message)."""
        result = verify_email(raw_email, resolver)
        if not result.verified:
            return False, f"Email not verified: {result.reason}"
        if not result.from_address:
            return False, "Email has no parseable From address."
        if not result.subject:
            return False, "Email has no subject."

        from_addr = result.from_address.strip().lower()
        now = datetime.utcnow()
        with get_session() as session:
            # Match a pending request whose challenge is in the verified subject.
            candidates = (
                session.query(RecoveryRequest)
                .filter(
                    RecoveryRequest.status == RecoveryStatus.PENDING,
                    RecoveryRequest.expires_at > now,
                )
                .all()
            )
            req = next((r for r in candidates if r.challenge in result.subject), None)
            if not req:
                return False, "No pending recovery matches this email's challenge."

            # The approval must come from the exact registered recovery address,
            # and DKIM must authenticate that address's own domain (From is in
            # the signed header set, so a verified signature binds the From).
            if from_addr != req.guardian_email:
                return False, "Approval must come from the registered recovery email."
            guardian_domain = req.guardian_email.split("@")[-1]
            if (result.domain or "").lower() != guardian_domain:
                return False, "DKIM domain does not match the recovery email domain."

            req.status = RecoveryStatus.APPROVED
            req.approved_at = now
            req.approved_domain = result.domain
            return True, "Recovery approved. It will be executable after the time-lock."

    def finalize_recovery(self, request_id: int) -> Tuple[bool, str]:
        """Execute an approved recovery once its time-lock has elapsed."""
        now = datetime.utcnow()
        with get_session() as session:
            req = session.query(RecoveryRequest).filter(RecoveryRequest.id == request_id).first()
            if not req:
                return False, "Recovery request not found."
            if req.status == RecoveryStatus.EXECUTED:
                return True, "Recovery already executed."
            if req.status != RecoveryStatus.APPROVED:
                return False, f"Recovery is not approved (status: {req.status})."
            if now > req.expires_at:
                req.status = RecoveryStatus.EXPIRED
                return False, "Recovery request has expired."
            if now < req.execute_after:
                remaining = int((req.execute_after - now).total_seconds())
                return False, f"Time-lock not elapsed ({remaining}s remaining)."

            # A new account cannot already exist for the target id, or we'd be
            # merging two accounts — refuse and let support handle it.
            clash = (
                session.query(User)
                .filter(
                    User.telegram_id == req.new_telegram_id,
                    User.id != req.user_id,
                )
                .first()
            )
            if clash:
                return False, "Target Telegram account is already registered."

            user = session.query(User).filter(User.id == req.user_id).first()
            if not user:
                return False, "Account to recover no longer exists."

            # Transfer control: the user's wallets follow the user row, so
            # rebinding telegram_id hands the whole account (and its wallets) to
            # the new device/account.
            user.telegram_id = req.new_telegram_id
            req.status = RecoveryStatus.EXECUTED
            req.finalized_at = now
            logger.info(
                f"Recovery {req.id} executed: user {req.user_id} -> tg {req.new_telegram_id}"
            )
            return True, "Recovery complete. Your account has been transferred."

    def cancel_recovery(self, request_id: int) -> Tuple[bool, str]:
        """Cancel a live recovery (the original owner's defense)."""
        with get_session() as session:
            req = session.query(RecoveryRequest).filter(RecoveryRequest.id == request_id).first()
            if not req:
                return False, "Recovery request not found."
            if req.status in (RecoveryStatus.EXECUTED, RecoveryStatus.CANCELLED):
                return False, f"Recovery cannot be cancelled (status: {req.status})."
            req.status = RecoveryStatus.CANCELLED
            return True, "Recovery cancelled."

    def get_active_request_for_user(self, user_id: int) -> Optional[dict]:
        """Return the live (pending/approved) request targeting a user, if any."""
        now = datetime.utcnow()
        with get_session() as session:
            req = (
                session.query(RecoveryRequest)
                .filter(
                    RecoveryRequest.user_id == user_id,
                    RecoveryRequest.status.in_([RecoveryStatus.PENDING, RecoveryStatus.APPROVED]),
                    RecoveryRequest.expires_at > now,
                )
                .first()
            )
            return self._to_dict(req) if req else None

    @staticmethod
    def _to_dict(req: RecoveryRequest) -> dict:
        return {
            "id": req.id,
            "user_id": req.user_id,
            "new_telegram_id": req.new_telegram_id,
            "guardian_email": req.guardian_email,
            "challenge": req.challenge,
            "status": req.status,
            "delay_seconds": req.delay_seconds,
            "execute_after": req.execute_after.isoformat() if req.execute_after else None,
            "expires_at": req.expires_at.isoformat() if req.expires_at else None,
        }


# Global instance
social_recovery_service = SocialRecoveryService()
