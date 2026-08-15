"""Issue / rotate / revoke refresh tokens with reuse detection (H13).

The access JWT is short-lived; clients exchange a long-lived **rotating** refresh
token for a fresh access token. Each rotation revokes the presented token and mints
a successor in the same ``family_id``. Presenting an already-rotated token (stolen +
replayed) revokes the entire family — and is the revocation mechanism the stateless
7-day JWT lacks today.

Only SHA-256 hashes are stored; the opaque token is returned to the caller once.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from bot.models.auth import RefreshToken
from database.db import get_session

# Refresh tokens outlive access tokens by design; 30 days balances UX vs. exposure.
REFRESH_TTL_DAYS = 30


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """Treat naive DB timestamps (SQLite) as UTC."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def issue_refresh_token(
    user_id: int,
    address: Optional[str] = None,
    client: Optional[str] = None,
    family_id: Optional[str] = None,
) -> Tuple[str, datetime]:
    """Mint a fresh refresh token (new family unless ``family_id`` is given). Returns
    ``(opaque_token, expires_at)``."""
    token = secrets.token_urlsafe(48)
    expires_at = _utcnow() + timedelta(days=REFRESH_TTL_DAYS)
    with get_session() as session:
        session.add(
            RefreshToken(
                user_id=user_id,
                token_hash=_hash(token),
                family_id=family_id or str(uuid.uuid4()),
                address=address,
                client=client,
                issued_at=_utcnow(),
                expires_at=expires_at,
            )
        )
    return token, expires_at


def rotate_refresh_token(
    token: str, client: Optional[str] = None
) -> Optional[Tuple[int, Optional[str], str, datetime]]:
    """Validate + rotate a refresh token.

    Returns ``(user_id, address, new_token, new_expires_at)`` on success, or ``None``
    when the token is unknown, expired, or already-used (reuse → the whole family is
    revoked as a theft response).
    """
    token_hash = _hash(token)
    with get_session() as session:
        row = session.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
        if row is None:
            return None

        # Reuse detection: an already-revoked/rotated token presented again is theft.
        if row.revoked_at is not None or row.replaced_by is not None:
            session.query(RefreshToken).filter(
                RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None)
            ).update({RefreshToken.revoked_at: _utcnow()})
            return None

        if _aware(row.expires_at) <= _utcnow():
            return None

        user_id = row.user_id
        address = row.address
        family_id = row.family_id

        new_token = secrets.token_urlsafe(48)
        new_hash = _hash(new_token)
        new_expires = _utcnow() + timedelta(days=REFRESH_TTL_DAYS)
        session.add(
            RefreshToken(
                user_id=user_id,
                token_hash=new_hash,
                family_id=family_id,
                address=address,
                client=client or row.client,
                issued_at=_utcnow(),
                expires_at=new_expires,
            )
        )
        row.revoked_at = _utcnow()
        row.replaced_by = new_hash
        return user_id, address, new_token, new_expires


def revoke_refresh_token(token: str) -> bool:
    """Revoke a refresh token and its whole family (logout). Returns True if found."""
    token_hash = _hash(token)
    with get_session() as session:
        row = session.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
        if row is None:
            return False
        session.query(RefreshToken).filter(
            RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None)
        ).update({RefreshToken.revoked_at: _utcnow()})
        return True
