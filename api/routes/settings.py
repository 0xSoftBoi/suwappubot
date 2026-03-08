"""
User settings and push notification REST API routes.

These endpoints use JWT Bearer auth (no Telegram dependency)
for the iOS/Android mobile app.
"""
import logging
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from database.db import get_session, DATABASE_AVAILABLE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["settings"])


# --- Helpers ---

def _get_user_from_jwt(request: Request):
    """
    Extract authenticated user from JWT token.
    Reuses the JWT decode logic from api/main.py.
    """
    from api.main import decode_jwt_token

    # Check Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        payload = decode_jwt_token(token)
        if payload and payload.get("user_id"):
            return payload

    # Check cookie
    token = request.cookies.get("suwappu_auth")
    if token:
        payload = decode_jwt_token(token)
        if payload and payload.get("user_id"):
            return payload

    raise HTTPException(status_code=401, detail="Authentication required")


def _get_user_model(user_id: int):
    """Fetch User ORM object by ID."""
    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")

    from bot.models.user import User
    with get_session() as session:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user


# --- Request/Response Models ---

class PushTokenRequest(BaseModel):
    token: str


class PreferencesUpdateRequest(BaseModel):
    defaultSlippage: int | None = None
    notificationsEnabled: bool | None = None
    twoFaEnabled: bool | None = None
    twoFaThreshold: int | None = None


# --- Endpoints ---

@router.get("/me")
async def get_my_profile(request: Request):
    """Get authenticated user's full profile and preferences."""
    payload = _get_user_from_jwt(request)
    user_id = payload["user_id"]

    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")

    from bot.models.user import User, Wallet
    with get_session() as session:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        wallets = session.query(Wallet).filter(
            Wallet.user_id == user_id,
            Wallet.is_active == True,
        ).all()

        return {
            "user": {
                "id": user.id,
                "telegramId": user.telegram_id,
                "username": user.username,
                "firstName": user.first_name,
                "lastName": user.last_name,
            },
            "preferences": {
                "defaultSlippage": user.default_slippage,
                "notificationsEnabled": user.notifications_enabled,
                "twoFaEnabled": user.two_fa_enabled,
                "twoFaThreshold": user.two_fa_threshold,
            },
            "wallets": [
                {
                    "address": w.address,
                    "name": w.name,
                    "chainType": w.chain_type,
                    "provider": w.wallet_provider,
                    "isDefault": w.is_default,
                    "linkedAt": w.created_at.isoformat() if w.created_at else None,
                }
                for w in wallets
            ],
        }


@router.put("/me/preferences")
async def update_preferences(request: Request, body: PreferencesUpdateRequest):
    """Update user preferences."""
    payload = _get_user_from_jwt(request)
    user_id = payload["user_id"]

    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")

    from bot.models.user import User
    with get_session() as session:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if body.defaultSlippage is not None:
            user.default_slippage = body.defaultSlippage
        if body.notificationsEnabled is not None:
            user.notifications_enabled = body.notificationsEnabled
        if body.twoFaEnabled is not None:
            user.two_fa_enabled = body.twoFaEnabled
        if body.twoFaThreshold is not None:
            user.two_fa_threshold = body.twoFaThreshold

        session.commit()

        return {
            "success": True,
            "preferences": {
                "defaultSlippage": user.default_slippage,
                "notificationsEnabled": user.notifications_enabled,
                "twoFaEnabled": user.two_fa_enabled,
                "twoFaThreshold": user.two_fa_threshold,
            },
        }


@router.post("/me/push-token")
async def register_push_token(request: Request, body: PushTokenRequest):
    """Register an Expo push token for push notifications."""
    payload = _get_user_from_jwt(request)
    user_id = payload["user_id"]

    if not body.token or not body.token.startswith("ExponentPushToken"):
        raise HTTPException(status_code=400, detail="Invalid Expo push token format")

    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")

    from bot.models.user import User
    with get_session() as session:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.push_token = body.token
        session.commit()

    return {"success": True}


@router.delete("/me/push-token")
async def unregister_push_token(request: Request):
    """Remove push token (disable push notifications)."""
    payload = _get_user_from_jwt(request)
    user_id = payload["user_id"]

    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")

    from bot.models.user import User
    with get_session() as session:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.push_token = None
        session.commit()

    return {"success": True}


@router.get("/me/stats")
async def get_my_stats(request: Request):
    """Get user trading stats."""
    payload = _get_user_from_jwt(request)
    user_id = payload["user_id"]

    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        from bot.models.points import UserStats
        with get_session() as session:
            stats = session.query(UserStats).filter(UserStats.user_id == user_id).first()
            if not stats:
                return {
                    "totalSwaps": 0,
                    "totalVolume": 0,
                    "totalFees": 0,
                    "totalGas": 0,
                    "realizedPnl": 0,
                    "tier": "Bronze",
                }
            return {
                "totalSwaps": stats.total_swaps,
                "totalVolume": stats.total_volume_usd,
                "totalFees": stats.total_fees_paid,
                "totalGas": stats.total_gas_paid,
                "realizedPnl": stats.realized_pnl,
                "tier": stats.tier,
            }
    except Exception as e:
        logger.warning(f"Failed to get user stats: {e}")
        return {
            "totalSwaps": 0,
            "totalVolume": 0,
            "totalFees": 0,
            "totalGas": 0,
            "realizedPnl": 0,
            "tier": "Bronze",
        }
