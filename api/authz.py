"""Shared authorization checks for browser-session money paths."""

from typing import Any, Mapping

from fastapi import HTTPException


PROOF_OF_POSSESSION_SOURCES = frozenset({"telegram", "siwe", "passkey"})


def require_proof_of_possession(payload: Mapping[str, Any] | None) -> int:
    """Return user id only for sessions backed by a real possession proof.

    OAuth/refresh sessions use ``src='weak'``: useful for read/account UX, but
    insufficient to make the server sign, submit, or record a trade on behalf of
    the user. This mirrors api-ts's ``requireProofOfPossession`` contract.
    """
    if not payload or not payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    if payload.get("src") not in PROOF_OF_POSSESSION_SOURCES:
        raise HTTPException(
            status_code=403,
            detail="Verify a wallet, passkey, or Telegram session before trading",
        )
    return int(payload["user_id"])
