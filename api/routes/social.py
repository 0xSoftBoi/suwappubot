"""JellyJelly-backed social discovery and account claims.

JellyJelly is the source of the human moment.  Suwappu deliberately accepts
only canonical *public* Jelly URLs and Firehose metadata; it never accepts,
proxies, stores, or re-encodes a creator's video stream.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import logging
import re
import secrets
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from bot.models.social import JellyAccountClaim
from bot.models.user import User
from bot.utils.redis_cache import redis_cache
from database import db as db_module
from database.db import get_session

logger = logging.getLogger(__name__)

# `/webapp` is already routed to Python by the production edge gateway. Keeping
# this social surface beneath it means a Railway deploy makes the feature live
# without a second, separately-authenticated Worker deployment.
router = APIRouter(prefix="/webapp/social", tags=["social"])

JELLYJELLY_API_BASE = "https://api.jellyjelly.com"
JELLYJELLY_SEARCH_PATH = "/v3/jelly/search"
JELLYJELLY_WATCH_HOSTS = {"jellyjelly.com", "www.jellyjelly.com"}
JELLY_SEARCH_CACHE_TTL_SECONDS = 30
JELLY_CLAIM_TTL_SECONDS = 10 * 60
_MAX_JELLY_ID_LENGTH = 128
_MAX_JELLY_URL_LENGTH = 300
_MAX_PUBLIC_TEXT_LENGTH = 400
_CANONICAL_JELLY_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_HANDLE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,79}$")
_TEXT_KEYS = {
    "title",
    "summary",
    "description",
    "caption",
    "transcript",
    "transcript_overlay",
    "text",
    "word",
    "words",
    "content",
    "sentence",
}


class JellyClaimVerificationRequest(BaseModel):
    """The one canonical Jelly URL that proves a creator controls an account."""

    challengeId: str
    jellyUrl: str


def _as_short_public_text(value: Any, fallback: str = "") -> str:
    """Normalize an upstream string without reflecting an unbounded payload."""
    if not isinstance(value, str):
        return fallback
    return value.strip()[:_MAX_PUBLIC_TEXT_LENGTH] or fallback


def _jelly_id(item: dict[str, Any]) -> str:
    value = item.get("id") or item.get("jelly_id")
    return str(value).strip() if value is not None else ""


def _watch_url(jelly_id: str) -> str:
    return f"https://jellyjelly.com/watch/{jelly_id}"


def _find_username(value: Any, depth: int = 0) -> str:
    """Extract a creator username from the documented/observed Firehose shapes."""
    if depth > 3:
        return ""
    if isinstance(value, dict):
        candidate = value.get("username") or value.get("handle")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        for key in ("creator", "user", "owner", "participant", "participants"):
            nested = value.get(key)
            found = _find_username(nested, depth + 1)
            if found:
                return found
    elif isinstance(value, list):
        for entry in value:
            found = _find_username(entry, depth + 1)
            if found:
                return found
    return ""


def _normalized_handle(value: str) -> str:
    handle = value.strip().lstrip("@").lower()
    return handle if _HANDLE.fullmatch(handle) else ""


def _claim_username(item: dict[str, Any]) -> str:
    """Return an unambiguous creator handle for account-control proof.

    Search cards may show the first participant supplied by Firehose.  A claim
    is stricter: when the provider exposes several participants and no explicit
    creator field, we refuse to guess who owns the public account.
    """
    for key in ("username", "handle"):
        candidate = item.get(key)
        if isinstance(candidate, str) and (handle := _normalized_handle(candidate)):
            return handle

    for key in ("creator", "user", "owner"):
        profile = item.get(key)
        if not isinstance(profile, dict):
            continue
        for handle_key in ("username", "handle"):
            candidate = profile.get(handle_key)
            if isinstance(candidate, str) and (handle := _normalized_handle(candidate)):
                return handle

    participants = item.get("participants") or item.get("participant")
    if not isinstance(participants, list):
        return ""
    candidates = {
        _normalized_handle(_find_username(participant))
        for participant in participants
        if _normalized_handle(_find_username(participant))
    }
    return next(iter(candidates)) if len(candidates) == 1 else ""


def _public_jelly(item: dict[str, Any]) -> dict[str, Any] | None:
    """Return a deliberately small, display-safe public Jelly card.

    In particular, this never returns `video`, `hls_master`, `mp4_fallback`,
    or an upstream watch URL.  Playback always goes to JellyJelly's canonical
    page, which keeps provenance and access controls with the source product.
    """
    jelly_id = _jelly_id(item)
    if not _CANONICAL_JELLY_ID.fullmatch(jelly_id):
        return None

    return {
        "id": jelly_id,
        "title": _as_short_public_text(item.get("title"), "Untitled Jelly"),
        "summary": _as_short_public_text(item.get("summary") or item.get("description")),
        "username": _normalized_handle(_find_username(item)),
        # The current surface links out rather than embedding or proxying media.
        "thumbnailUrl": None,
        "watchUrl": _watch_url(jelly_id),
        "likesCount": (
            int(item.get("likes_count") or 0) if str(item.get("likes_count") or "").isdigit() else 0
        ),
        "viewsCount": (
            int(item.get("all_views") or item.get("views_count") or 0)
            if str(item.get("all_views") or item.get("views_count") or "").isdigit()
            else 0
        ),
        "createdAt": item.get("created_at") or item.get("createdAt") or None,
    }


def _jelly_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    items = payload.get("jellies") or payload.get("results") or payload.get("data") or []
    return items if isinstance(items, list) else []


def _jelly_from_payload(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    candidate = payload.get("jelly") or payload.get("data") or payload
    return candidate if isinstance(candidate, dict) else None


def _canonical_jelly_id(jelly_url: str) -> str:
    """Accept only a canonical public JellyJelly watch URL.

    Rejecting direct media URLs here is intentional: it makes the claim
    primitive impossible to satisfy with an uploaded MP4/HLS asset or a lookalike
    provider URL.
    """
    if not isinstance(jelly_url, str) or len(jelly_url) > _MAX_JELLY_URL_LENGTH:
        raise HTTPException(status_code=422, detail="Provide a canonical JellyJelly watch URL")
    try:
        parsed = urlparse(jelly_url.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail="Provide a canonical JellyJelly watch URL"
        ) from exc

    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in JELLYJELLY_WATCH_HOSTS:
        raise HTTPException(status_code=422, detail="Provide a canonical JellyJelly watch URL")
    if parsed.params or parsed.query or parsed.fragment:
        raise HTTPException(
            status_code=422, detail="Jelly links cannot include query parameters or fragments"
        )

    match = re.fullmatch(r"/watch/([A-Za-z0-9_-]{1,128})", parsed.path)
    if not match:
        raise HTTPException(
            status_code=422, detail="Provide a canonical JellyJelly /watch/{id} URL"
        )
    return match.group(1)


def _normalized_text(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def _public_text(item: dict[str, Any], depth: int = 0) -> str:
    """Collect text fields we may use to match a posted public claim phrase."""
    if depth > 6:
        return ""
    values: list[str] = []
    for key, value in item.items():
        if key.lower() not in _TEXT_KEYS:
            continue
        if isinstance(value, str):
            values.append(value[:4_000])
        elif isinstance(value, dict):
            values.append(_public_text(value, depth + 1))
        elif isinstance(value, list):
            for entry in value[:2_000]:
                if isinstance(entry, str):
                    values.append(entry[:4_000])
                elif isinstance(entry, dict):
                    values.append(_public_text(entry, depth + 1))
    return " ".join(values)


def _is_public_jelly(item: dict[str, Any]) -> bool:
    privacy = item.get("privacy")
    return not isinstance(privacy, str) or privacy.lower() in {"public", "open"}


async def _firehose_get(path: str, *, params: dict[str, Any] | None = None) -> Any:
    """Fetch Firehose JSON with a narrow, safe error contract."""
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=False) as client:
            response = await client.get(
                f"{JELLYJELLY_API_BASE}{path}",
                params=params,
                headers={"Accept": "application/json", "User-Agent": "suwappu-social/1.0"},
            )
            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="Public Jelly not found")
            response.raise_for_status()
            try:
                return response.json()
            except ValueError as exc:
                raise HTTPException(
                    status_code=502, detail="Social provider returned invalid data"
                ) from exc
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Social feed timed out") from exc
    except httpx.HTTPStatusError as exc:
        logger.warning("JellyJelly Firehose returned HTTP %s", exc.response.status_code)
        raise HTTPException(
            status_code=502, detail="Social feed is temporarily unavailable"
        ) from exc
    except httpx.RequestError as exc:
        logger.warning("JellyJelly Firehose request failed: %s", exc)
        raise HTTPException(
            status_code=502, detail="Social feed is temporarily unavailable"
        ) from exc


async def _require_single_use_claim_store() -> None:
    """Fail closed when Redis cannot provide cross-replica single-use proofs."""
    if not await redis_cache.ping():
        raise HTTPException(
            status_code=503,
            detail="Jelly account claims are temporarily unavailable; retry shortly",
        )


def _search_cache_key(q: str, username: str, page: int, page_size: int) -> str:
    raw = f"{q.lower()}\x00{username.lower()}\x00{page}\x00{page_size}".encode()
    return f"social:jelly-search:{hashlib.sha256(raw).hexdigest()}"


def _wallet_authenticated_user(request: Request) -> tuple[int, str]:
    """Require the account proof that backs a public creator-profile claim."""
    from api.main import decode_jwt_token

    authorization = request.headers.get("Authorization", "")
    token = (
        authorization[7:]
        if authorization.startswith("Bearer ")
        else request.cookies.get("suwappu_auth")
    )
    payload = decode_jwt_token(token) if token else None
    if not payload or not payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Authentication required")
    if payload.get("src") != "siwe":
        raise HTTPException(
            status_code=403,
            detail="Connect and sign in with your wallet before claiming a Jelly account",
        )
    wallet_address = str(payload.get("address") or "").strip()
    if not wallet_address:
        raise HTTPException(status_code=403, detail="A wallet-backed session is required")
    try:
        return int(payload["user_id"]), wallet_address
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Authentication required") from exc


def _claim_key(challenge_id: str) -> str:
    return f"social:jelly-claim:{challenge_id}"


def _serialize_claim(claim: JellyAccountClaim) -> dict[str, Any]:
    claimed_at = claim.claimed_at
    if claimed_at.tzinfo is None:
        claimed_at = claimed_at.replace(tzinfo=timezone.utc)
    return {
        "username": claim.jelly_username,
        "claimJellyId": claim.claim_jelly_id,
        "watchUrl": _watch_url(claim.claim_jelly_id),
        "walletAddress": claim.wallet_address,
        "walletProof": claim.wallet_proof,
        "claimedAt": claimed_at.isoformat(),
    }


def _persist_claim(
    *, user_id: int, wallet_address: str, jelly_username: str, jelly_id: str
) -> JellyAccountClaim:
    """Upsert a claim while preventing a public Jelly account from being shared."""
    if not db_module.DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Claims are temporarily unavailable")

    try:
        with get_session() as session:
            if not session.query(User.id).filter(User.id == user_id).first():
                raise HTTPException(status_code=404, detail="Suwappu account not found")

            same_handle = (
                session.query(JellyAccountClaim)
                .filter(JellyAccountClaim.jelly_username == jelly_username)
                .first()
            )
            if same_handle and same_handle.user_id != user_id:
                raise HTTPException(status_code=409, detail="That Jelly account is already claimed")

            same_jelly = (
                session.query(JellyAccountClaim)
                .filter(JellyAccountClaim.claim_jelly_id == jelly_id)
                .first()
            )
            if same_jelly and same_jelly.user_id != user_id:
                raise HTTPException(
                    status_code=409, detail="That Jelly has already been used as a claim proof"
                )

            claim = (
                session.query(JellyAccountClaim)
                .filter(JellyAccountClaim.user_id == user_id)
                .first()
            )
            if claim is None:
                claim = JellyAccountClaim(
                    user_id=user_id,
                    jelly_username=jelly_username,
                    claim_jelly_id=jelly_id,
                    wallet_address=wallet_address,
                    wallet_proof="siwe-session",
                    claimed_at=datetime.now(timezone.utc),
                )
                session.add(claim)
            else:
                claim.jelly_username = jelly_username
                claim.claim_jelly_id = jelly_id
                claim.wallet_address = wallet_address
                claim.wallet_proof = "siwe-session"
                claim.claimed_at = datetime.now(timezone.utc)

            # Surface unique conflicts inside this block so we can return a
            # useful 409 rather than leak a raw database exception.
            session.flush()
            return claim
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409, detail="That Jelly account is already claimed"
        ) from exc


@router.get("/jellies")
async def search_jellies(
    q: str = Query(default="", max_length=120),
    username: str = Query(default="", max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=24),
):
    """Search the public Firehose catalog without exposing media URLs or tokens."""
    query = q.strip()
    creator = username.strip()
    if not query and not creator:
        raise HTTPException(status_code=422, detail="Provide a search term or creator username")

    cache_key = _search_cache_key(query, creator, page, page_size)
    cached = await redis_cache.get(cache_key)
    if isinstance(cached, dict):
        return cached

    payload = await _firehose_get(
        JELLYJELLY_SEARCH_PATH,
        params={"q": query, "username": creator, "page": page, "page_size": page_size},
    )
    items = [card for item in _jelly_items(payload) if (card := _public_jelly(item)) is not None]
    result = {"items": items, "page": page}
    await redis_cache.set(cache_key, result, ttl_seconds=JELLY_SEARCH_CACHE_TTL_SECONDS)
    return result


@router.post("/jelly/claims/challenge")
async def create_jelly_claim_challenge(request: Request):
    """Issue a short-lived phrase for a creator to record in a public Jelly."""
    user_id, wallet_address = _wallet_authenticated_user(request)
    await _require_single_use_claim_store()
    challenge_id = secrets.token_urlsafe(24)
    nonce = secrets.token_hex(12)
    phrase = f"Suwappu claim {nonce}"
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=JELLY_CLAIM_TTL_SECONDS)
    await redis_cache.set(
        _claim_key(challenge_id),
        {"user_id": user_id, "wallet_address": wallet_address, "phrase": phrase},
        ttl_seconds=JELLY_CLAIM_TTL_SECONDS,
    )
    return {
        "challengeId": challenge_id,
        "phrase": phrase,
        "expiresAt": expires_at.isoformat(),
        "instructions": "Record and publish a public Jelly that says this exact phrase, then paste its canonical jellyjelly.com/watch URL. Suwappu never accepts a video upload or media URL.",
    }


@router.post("/jelly/claims/verify")
async def verify_jelly_claim(body: JellyClaimVerificationRequest, request: Request):
    """Bind a Jelly account to the wallet-backed Suwappu account that issued it."""
    if len(body.challengeId) > 128:
        raise HTTPException(status_code=422, detail="Invalid claim challenge")
    jelly_id = _canonical_jelly_id(body.jellyUrl)
    user_id, wallet_address = _wallet_authenticated_user(request)
    await _require_single_use_claim_store()

    # GETDEL makes the proof single-use across Python API replicas.  An invalid
    # Jelly does consume a challenge, forcing a fresh human-recorded proof.
    challenge = await redis_cache.get_del(_claim_key(body.challengeId))
    if not isinstance(challenge, dict) or not isinstance(challenge.get("user_id"), int):
        raise HTTPException(status_code=400, detail="Claim challenge is invalid or expired")
    if challenge["user_id"] != user_id or challenge.get("wallet_address") != wallet_address:
        raise HTTPException(
            status_code=403, detail="This claim challenge belongs to a different wallet session"
        )

    payload = await _firehose_get(f"/v3/jelly/{jelly_id}")
    jelly = _jelly_from_payload(payload)
    if jelly is None or _jelly_id(jelly) != jelly_id:
        raise HTTPException(
            status_code=502, detail="Social provider returned an invalid Jelly record"
        )
    if not _is_public_jelly(jelly):
        raise HTTPException(status_code=409, detail="The claim Jelly must be public")

    phrase = str(challenge.get("phrase") or "")
    if not phrase or _normalized_text(phrase) not in _normalized_text(_public_text(jelly)):
        raise HTTPException(
            status_code=422, detail="The public Jelly does not contain this claim phrase"
        )

    jelly_username = _claim_username(jelly)
    if not jelly_username:
        raise HTTPException(
            status_code=422, detail="The public Jelly does not expose a valid creator handle"
        )

    claim = _persist_claim(
        user_id=challenge["user_id"],
        wallet_address=str(challenge.get("wallet_address") or ""),
        jelly_username=jelly_username,
        jelly_id=jelly_id,
    )
    return {"claim": _serialize_claim(claim)}


@router.get("/me/jelly")
async def get_my_jelly_claim(request: Request):
    """Return the caller's claimed Jelly account, if any."""
    user_id, _ = _wallet_authenticated_user(request)
    if not db_module.DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Claims are temporarily unavailable")
    with get_session() as session:
        claim = (
            session.query(JellyAccountClaim).filter(JellyAccountClaim.user_id == user_id).first()
        )
        return {"claim": _serialize_claim(claim) if claim else None}


@router.delete("/me/jelly")
async def remove_my_jelly_claim(request: Request):
    """Remove the public profile binding without touching source media."""
    user_id, _ = _wallet_authenticated_user(request)
    if not db_module.DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Claims are temporarily unavailable")
    with get_session() as session:
        claim = (
            session.query(JellyAccountClaim).filter(JellyAccountClaim.user_id == user_id).first()
        )
        if claim:
            session.delete(claim)
    return {"removed": True}
