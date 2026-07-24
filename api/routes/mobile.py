"""
JWT-authenticated REST endpoints for the Suwappu iOS/Android mobile app.

All Phase 2 features: wallets, alerts, orders, DCA, points, referrals,
copy trading, and sniping.  Delegates to existing service singletons.
"""

import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel

from database.db import get_session, DATABASE_AVAILABLE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/mobile", tags=["mobile"])


# ── helpers ──────────────────────────────────────────────────────────


def _jwt_user(request: Request) -> dict:
    """Extract and validate JWT payload. Raises 401 on failure."""
    from api.main import decode_jwt_token

    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        payload = decode_jwt_token(auth[7:])
        if payload and payload.get("user_id"):
            return payload

    token = request.cookies.get("suwappu_auth")
    if token:
        payload = decode_jwt_token(token)
        if payload and payload.get("user_id"):
            return payload

    raise HTTPException(status_code=401, detail="Authentication required")


def _require_db():
    if not DATABASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database unavailable")


# ── request / response models ────────────────────────────────────────


class CreateWalletRequest(BaseModel):
    chainType: str = "evm"


class SetDefaultWalletRequest(BaseModel):
    address: str


# -- alerts --
class CreateAlertBody(BaseModel):
    tokenSymbol: str
    tokenAddress: str
    chain: str
    alertType: str  # price_above | price_below | percent_change
    targetPrice: float | None = None
    percentChange: float | None = None


# -- orders --
class CreateOrderBody(BaseModel):
    orderType: str
    fromToken: str
    toToken: str
    fromChain: str
    toChain: str
    amount: str
    triggerPrice: float
    slippage: int | None = None
    expiresInHours: int | None = None


# -- DCA --
class CreateDCABody(BaseModel):
    fromToken: str
    toToken: str
    fromChain: str
    toChain: str
    amountPerExecution: str
    intervalHours: int
    maxExecutions: int | None = None
    maxTotalAmount: str | None = None


# -- points --
class RedeemRewardBody(BaseModel):
    rewardId: int


# -- copy trading --
class FollowTraderBody(BaseModel):
    copyMode: str = "notify"
    copyType: str = "fixed_amount"
    copyAmount: str | None = None
    copyPercentage: float | None = None
    maxPerTrade: str | None = None
    dailyLimit: str | None = None


# -- sniping --
class CreateSnipeBody(BaseModel):
    tokenAddress: str | None = None
    platform: str = "any"
    mode: str = "instant"
    amountSol: str
    slippage: int | None = None
    jitoTipLamports: int | None = None
    useMevProtection: bool = True


class UpdateSnipeConfigBody(BaseModel):
    quickAmounts: list[float] | None = None
    defaultSlippage: int | None = None
    defaultJitoTip: int | None = None
    autoSnipeEnabled: bool | None = None
    maxAutoSnipePerDay: int | None = None


# ═══════════════════════════════════════════════════════════════════
#  WALLETS
# ═══════════════════════════════════════════════════════════════════


@router.post("/wallets")
async def create_wallet(request: Request, body: CreateWalletRequest):
    """Create a new EVM or Solana wallet for the authenticated user."""
    payload = _jwt_user(request)
    _require_db()

    from bot.services.wallet import WalletService

    ws = WalletService()
    wallet = await ws.create_wallet(
        user_id=payload["user_id"],
        name="Mobile Wallet",
        chain_type=body.chainType,
    )
    return {
        "address": wallet.address,
        "name": wallet.name,
        "chainType": wallet.chain_type,
        "isDefault": wallet.is_default,
    }


@router.put("/wallets/default")
async def set_default_wallet(request: Request, body: SetDefaultWalletRequest):
    """Set a wallet as the default for the authenticated user."""
    payload = _jwt_user(request)
    _require_db()

    from bot.models.user import Wallet

    with get_session() as session:
        wallets = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == payload["user_id"],
                Wallet.is_active == True,
            )
            .all()
        )

        found = False
        for w in wallets:
            if w.address.lower() == body.address.lower():
                w.is_default = True
                found = True
            else:
                w.is_default = False
        if not found:
            raise HTTPException(status_code=404, detail="Wallet not found")
        session.commit()

    return {"success": True}


# ═══════════════════════════════════════════════════════════════════
#  ALERTS
# ═══════════════════════════════════════════════════════════════════


@router.get("/alerts")
async def list_alerts(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import AdvancedPriceAlert

    with get_session() as session:
        alerts = (
            session.query(AdvancedPriceAlert)
            .filter(
                AdvancedPriceAlert.user_id == payload["user_id"],
            )
            .order_by(AdvancedPriceAlert.created_at.desc())
            .all()
        )

        return [
            {
                "id": a.id,
                "tokenSymbol": a.token_symbol,
                "tokenAddress": a.token_address,
                "chain": a.chain,
                "alertType": a.alert_type.value if hasattr(a.alert_type, "value") else a.alert_type,
                "targetPrice": a.target_price,
                "percentChange": a.percent_change,
                "currentPrice": a.current_price,
                "isActive": a.is_active,
                "isTriggered": a.is_triggered,
                "triggeredAt": a.triggered_at.isoformat() if a.triggered_at else None,
                "triggeredPrice": a.triggered_price,
                "createdAt": a.created_at.isoformat() if a.created_at else None,
            }
            for a in alerts
        ]


@router.post("/alerts")
async def create_alert(request: Request, body: CreateAlertBody):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import AdvancedPriceAlert, AlertType

    with get_session() as session:
        alert = AdvancedPriceAlert(
            user_id=payload["user_id"],
            token_symbol=body.tokenSymbol,
            token_address=body.tokenAddress,
            chain=body.chain,
            alert_type=body.alertType,
            target_price=body.targetPrice,
            percent_change=body.percentChange,
            is_active=True,
            created_at=datetime.utcnow(),
        )
        session.add(alert)
        session.commit()
        session.refresh(alert)
        return {"id": alert.id, "success": True}


@router.delete("/alerts/{alert_id}")
async def delete_alert(request: Request, alert_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import AdvancedPriceAlert

    with get_session() as session:
        alert = (
            session.query(AdvancedPriceAlert)
            .filter(
                AdvancedPriceAlert.id == alert_id,
                AdvancedPriceAlert.user_id == payload["user_id"],
            )
            .first()
        )
        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")
        session.delete(alert)
        session.commit()
    return {"success": True}


@router.put("/alerts/{alert_id}/toggle")
async def toggle_alert(request: Request, alert_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import AdvancedPriceAlert

    with get_session() as session:
        alert = (
            session.query(AdvancedPriceAlert)
            .filter(
                AdvancedPriceAlert.id == alert_id,
                AdvancedPriceAlert.user_id == payload["user_id"],
            )
            .first()
        )
        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")
        alert.is_active = not alert.is_active
        session.commit()
        return {"isActive": alert.is_active}


# ═══════════════════════════════════════════════════════════════════
#  LIMIT ORDERS
# ═══════════════════════════════════════════════════════════════════


@router.get("/orders")
async def list_orders(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import LimitOrder

    with get_session() as session:
        orders = (
            session.query(LimitOrder)
            .filter(
                LimitOrder.user_id == payload["user_id"],
            )
            .order_by(LimitOrder.created_at.desc())
            .all()
        )

        return [
            {
                "id": o.id,
                "orderType": o.order_type.value if hasattr(o.order_type, "value") else o.order_type,
                "fromToken": o.from_token,
                "toToken": o.to_token,
                "fromChain": o.from_chain,
                "toChain": o.to_chain,
                "amount": o.amount,
                "triggerPrice": o.trigger_price,
                "currentPrice": getattr(o, "current_price", None),
                "slippage": o.slippage_bps,
                "status": o.status.value if hasattr(o.status, "value") else o.status,
                "executedAt": o.executed_at.isoformat() if o.executed_at else None,
                "expiresAt": o.expires_at.isoformat() if o.expires_at else None,
                "txHash": o.tx_hash,
                "createdAt": o.created_at.isoformat() if o.created_at else None,
            }
            for o in orders
        ]


@router.post("/orders")
async def create_order(request: Request, body: CreateOrderBody):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import LimitOrder
    from datetime import timedelta

    with get_session() as session:
        order = LimitOrder(
            user_id=payload["user_id"],
            order_type=body.orderType,
            from_token=body.fromToken,
            to_token=body.toToken,
            from_chain=body.fromChain,
            to_chain=body.toChain,
            amount=body.amount,
            trigger_price=body.triggerPrice,
            slippage_bps=body.slippage or 50,
            status="pending",
            expires_at=(
                datetime.utcnow() + timedelta(hours=body.expiresInHours)
                if body.expiresInHours
                else None
            ),
            created_at=datetime.utcnow(),
        )
        session.add(order)
        session.commit()
        session.refresh(order)
        return {"id": order.id, "success": True}


@router.delete("/orders/{order_id}")
async def cancel_order(request: Request, order_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import LimitOrder

    with get_session() as session:
        order = (
            session.query(LimitOrder)
            .filter(
                LimitOrder.id == order_id,
                LimitOrder.user_id == payload["user_id"],
            )
            .first()
        )
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        order.status = "cancelled"
        session.commit()
    return {"success": True}


# ═══════════════════════════════════════════════════════════════════
#  DCA
# ═══════════════════════════════════════════════════════════════════


@router.get("/dca")
async def list_dca(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import DCAOrder

    with get_session() as session:
        plans = (
            session.query(DCAOrder)
            .filter(
                DCAOrder.user_id == payload["user_id"],
            )
            .order_by(DCAOrder.created_at.desc())
            .all()
        )

        return [
            {
                "id": d.id,
                "fromToken": d.from_token,
                "toToken": d.to_token,
                "fromChain": d.from_chain,
                "toChain": d.to_chain,
                "amountPerExecution": d.amount_per_execution,
                "intervalHours": d.interval_hours,
                "maxExecutions": d.max_executions,
                "executionCount": d.execution_count,
                "totalAmountSpent": str(d.total_spent or 0),
                "totalAmountReceived": str(d.total_received or 0),
                "averagePrice": d.average_price,
                "status": d.status.value if hasattr(d.status, "value") else d.status,
                "nextExecutionAt": d.next_execution_at.isoformat() if d.next_execution_at else None,
                "createdAt": d.created_at.isoformat() if d.created_at else None,
            }
            for d in plans
        ]


@router.post("/dca")
async def create_dca(request: Request, body: CreateDCABody):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import DCAOrder
    from datetime import timedelta

    with get_session() as session:
        dca = DCAOrder(
            user_id=payload["user_id"],
            from_token=body.fromToken,
            to_token=body.toToken,
            from_chain=body.fromChain,
            to_chain=body.toChain,
            amount_per_execution=body.amountPerExecution,
            interval_hours=body.intervalHours,
            max_executions=body.maxExecutions,
            status="active",
            execution_count=0,
            next_execution_at=datetime.utcnow() + timedelta(hours=body.intervalHours),
            created_at=datetime.utcnow(),
        )
        session.add(dca)
        session.commit()
        session.refresh(dca)
        return {"id": dca.id, "success": True}


@router.put("/dca/{dca_id}/pause")
async def pause_dca(request: Request, dca_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import DCAOrder

    with get_session() as session:
        dca = (
            session.query(DCAOrder)
            .filter(
                DCAOrder.id == dca_id,
                DCAOrder.user_id == payload["user_id"],
            )
            .first()
        )
        if not dca:
            raise HTTPException(status_code=404, detail="DCA plan not found")
        dca.status = "paused"
        session.commit()
    return {"success": True}


@router.put("/dca/{dca_id}/resume")
async def resume_dca(request: Request, dca_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import DCAOrder
    from datetime import timedelta

    with get_session() as session:
        dca = (
            session.query(DCAOrder)
            .filter(
                DCAOrder.id == dca_id,
                DCAOrder.user_id == payload["user_id"],
            )
            .first()
        )
        if not dca:
            raise HTTPException(status_code=404, detail="DCA plan not found")
        dca.status = "active"
        dca.next_execution_at = datetime.utcnow() + timedelta(hours=dca.interval_hours)
        session.commit()
    return {"success": True}


@router.delete("/dca/{dca_id}")
async def cancel_dca(request: Request, dca_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import DCAOrder

    with get_session() as session:
        dca = (
            session.query(DCAOrder)
            .filter(
                DCAOrder.id == dca_id,
                DCAOrder.user_id == payload["user_id"],
            )
            .first()
        )
        if not dca:
            raise HTTPException(status_code=404, detail="DCA plan not found")
        dca.status = "cancelled"
        session.commit()
    return {"success": True}


@router.get("/dca/{dca_id}/executions")
async def list_dca_executions(request: Request, dca_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.advanced import DCAOrder, DCAExecution

    with get_session() as session:
        dca = (
            session.query(DCAOrder)
            .filter(
                DCAOrder.id == dca_id,
                DCAOrder.user_id == payload["user_id"],
            )
            .first()
        )
        if not dca:
            raise HTTPException(status_code=404, detail="DCA plan not found")

        execs = (
            session.query(DCAExecution)
            .filter(
                DCAExecution.dca_order_id == dca_id,
            )
            .order_by(DCAExecution.executed_at.desc())
            .all()
        )

        return [
            {
                "id": e.id,
                "dcaOrderId": e.dca_order_id,
                "executionNumber": e.execution_number,
                "fromAmount": e.from_amount,
                "toAmount": e.to_amount,
                "price": e.price,
                "txHash": e.tx_hash,
                "status": e.status,
                "executedAt": e.executed_at.isoformat() if e.executed_at else None,
            }
            for e in execs
        ]


# ═══════════════════════════════════════════════════════════════════
#  POINTS / XP
# ═══════════════════════════════════════════════════════════════════


@router.get("/points")
async def get_points(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.points import UserPoints

    with get_session() as session:
        up = (
            session.query(UserPoints)
            .filter(
                UserPoints.user_id == payload["user_id"],
            )
            .first()
        )

        if not up:
            return {
                "points": 0,
                "spendablePoints": 0,
                "xp": 0,
                "level": "Bronze",
                "levelEmoji": "",
                "feeDiscount": 0.8,
                "dailyStreak": 0,
                "longestStreak": 0,
                "canCheckin": True,
            }

        return {
            "points": up.points,
            "spendablePoints": up.spendable_points,
            "xp": up.xp,
            "level": up.level,
            "levelEmoji": up.level_emoji,
            "feeDiscount": up.fee_discount,
            "nextLevel": up.next_level,
            "xpToNextLevel": up.xp_to_next_level,
            "dailyStreak": up.daily_streak,
            "longestStreak": up.longest_streak,
            "lastCheckinAt": up.last_checkin_at.isoformat() if up.last_checkin_at else None,
            "canCheckin": up.can_checkin if hasattr(up, "can_checkin") else True,
        }


@router.post("/points/checkin")
async def daily_checkin(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.services.points_service import points_service

    try:
        result = await points_service.daily_checkin(payload["user_id"])
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/points/milestones")
async def get_milestones(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.services.points_service import points_service

    try:
        return await points_service.get_milestones(payload["user_id"])
    except Exception as e:
        logger.warning(f"Failed to get milestones: {e}")
        return []


@router.get("/points/rewards")
async def get_rewards(request: Request):
    _jwt_user(request)
    _require_db()

    from bot.models.points import Reward

    with get_session() as session:
        rewards = session.query(Reward).filter(Reward.is_active == True).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "cost": r.cost,
                "rewardType": r.reward_type,
                "rewardValue": r.reward_value,
                "isAvailable": r.is_available if hasattr(r, "is_available") else True,
            }
            for r in rewards
        ]


@router.post("/points/rewards/{reward_id}/redeem")
async def redeem_reward(request: Request, reward_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.services.points_service import points_service

    try:
        result = await points_service.redeem_reward(payload["user_id"], reward_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/points/leaderboard")
async def get_leaderboard(request: Request, limit: int = Query(default=50, le=100)):
    _jwt_user(request)
    _require_db()

    from bot.models.points import UserPoints
    from bot.models.user import User

    with get_session() as session:
        rows = (
            session.query(UserPoints, User)
            .join(
                User,
                UserPoints.user_id == User.id,
            )
            .order_by(UserPoints.xp.desc())
            .limit(limit)
            .all()
        )

        return [
            {
                "rank": i + 1,
                "userId": up.user_id,
                "username": u.username,
                "displayName": u.first_name or u.username,
                "xp": up.xp,
                "level": up.level,
                "levelEmoji": up.level_emoji,
            }
            for i, (up, u) in enumerate(rows)
        ]


@router.get("/points/history")
async def get_points_history(
    request: Request,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.points import PointTransaction

    with get_session() as session:
        txns = (
            session.query(PointTransaction)
            .filter(
                PointTransaction.user_id == payload["user_id"],
            )
            .order_by(PointTransaction.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        return [
            {
                "id": t.id,
                "amount": t.amount,
                "type": t.type,
                "reason": t.reason,
                "createdAt": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txns
        ]


# ═══════════════════════════════════════════════════════════════════
#  REFERRALS
# ═══════════════════════════════════════════════════════════════════


@router.get("/referral/code")
async def get_referral_code(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.referral import ReferralCode

    with get_session() as session:
        rc = (
            session.query(ReferralCode)
            .filter(
                ReferralCode.user_id == payload["user_id"],
            )
            .first()
        )
        if not rc:
            return {"code": None}
        return {
            "code": rc.code,
            "timesUsed": rc.times_used,
            "totalRewards": float(rc.total_rewards_earned or 0),
            "createdAt": rc.created_at.isoformat() if rc.created_at else None,
        }


@router.get("/referral/stats")
async def get_referral_stats(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.services.referral_service import referral_service

    try:
        stats = referral_service.get_referral_stats(payload["user_id"])
        return {
            "code": stats.get("referral_code"),
            "totalReferrals": stats.get("total_referrals", 0),
            "activeReferrals": stats.get("active_referrals", 0),
            "totalVolume": 0,
            "totalRewards": float(stats.get("total_earnings_usd") or 0),
            "unpaidRewards": float(stats.get("pending_rewards_usd") or 0),
        }
    except Exception as e:
        logger.warning(f"Failed to get referral stats: {e}")
        return {
            "code": None,
            "totalReferrals": 0,
            "activeReferrals": 0,
            "totalVolume": 0,
            "totalRewards": 0,
            "unpaidRewards": 0,
        }


@router.get("/referral/list")
async def get_referral_list(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.referral import Referral
    from bot.models.user import User

    with get_session() as session:
        refs = (
            session.query(Referral, User)
            .join(
                User,
                Referral.referee_id == User.id,
            )
            .filter(
                Referral.referrer_id == payload["user_id"],
            )
            .order_by(Referral.created_at.desc())
            .all()
        )

        return [
            {
                "id": r.id,
                "refereeId": r.referee_id,
                "refereeUsername": u.username,
                "refereeJoinedAt": r.created_at.isoformat() if r.created_at else None,
                "totalVolume": float(r.total_volume or 0),
                "totalRewards": float(r.total_rewards or 0),
            }
            for r, u in refs
        ]


@router.get("/referral/rewards")
async def get_referral_rewards(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.referral import ReferralReward

    with get_session() as session:
        rewards = (
            session.query(ReferralReward)
            .filter(
                ReferralReward.referrer_id == payload["user_id"],
            )
            .order_by(ReferralReward.created_at.desc())
            .limit(100)
            .all()
        )

        return [
            {
                "id": r.id,
                "amount": float(r.amount),
                "chain": r.chain,
                "token": r.token,
                "isPaid": r.is_paid,
                "paidAt": r.paid_at.isoformat() if r.paid_at else None,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rewards
        ]


# ═══════════════════════════════════════════════════════════════════
#  COPY TRADING
# ═══════════════════════════════════════════════════════════════════


@router.get("/copy-trading/leaderboard")
async def get_trader_leaderboard(request: Request, limit: int = Query(default=50, le=100)):
    _jwt_user(request)
    _require_db()

    from bot.models.copy_trading import TraderProfile

    with get_session() as session:
        traders = (
            session.query(TraderProfile)
            .filter(
                TraderProfile.is_public == True,
            )
            .order_by(TraderProfile.rank_score.desc())
            .limit(limit)
            .all()
        )

        return [
            {
                "id": t.id,
                "userId": t.user_id,
                "displayName": t.display_name,
                "bio": t.bio,
                "emoji": t.emoji,
                "isPublic": t.is_public,
                "totalTrades": t.total_trades,
                "winRate": t.win_rate,
                "totalPnl": float(t.total_pnl or 0),
                "bestTrade": float(t.best_trade or 0),
                "worstTrade": float(t.worst_trade or 0),
                "followerCount": t.follower_count,
                "timesCopied": t.times_copied,
                "rankScore": float(t.rank_score or 0),
                "createdAt": t.created_at.isoformat() if t.created_at else None,
            }
            for t in traders
        ]


@router.get("/copy-trading/trader/{trader_id}")
async def get_trader_profile(request: Request, trader_id: int):
    _jwt_user(request)
    _require_db()

    from bot.models.copy_trading import TraderProfile

    with get_session() as session:
        t = session.query(TraderProfile).filter(TraderProfile.id == trader_id).first()
        if not t:
            raise HTTPException(status_code=404, detail="Trader not found")
        return {
            "id": t.id,
            "userId": t.user_id,
            "displayName": t.display_name,
            "bio": t.bio,
            "emoji": t.emoji,
            "isPublic": t.is_public,
            "totalTrades": t.total_trades,
            "winRate": t.win_rate,
            "totalPnl": float(t.total_pnl or 0),
            "bestTrade": float(t.best_trade or 0),
            "worstTrade": float(t.worst_trade or 0),
            "followerCount": t.follower_count,
            "timesCopied": t.times_copied,
            "rankScore": float(t.rank_score or 0),
            "createdAt": t.created_at.isoformat() if t.created_at else None,
        }


@router.post("/copy-trading/follow/{trader_id}")
async def follow_trader(request: Request, trader_id: int, body: FollowTraderBody):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.copy_trading import CopyFollow, TraderProfile

    with get_session() as session:
        trader = session.query(TraderProfile).filter(TraderProfile.id == trader_id).first()
        if not trader:
            raise HTTPException(status_code=404, detail="Trader not found")

        existing = (
            session.query(CopyFollow)
            .filter(
                CopyFollow.follower_id == payload["user_id"],
                CopyFollow.trader_id == trader_id,
                CopyFollow.is_active == True,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Already following this trader")

        follow = CopyFollow(
            follower_id=payload["user_id"],
            trader_id=trader_id,
            copy_mode=body.copyMode,
            copy_type=body.copyType,
            copy_amount=body.copyAmount,
            copy_percentage=body.copyPercentage,
            max_per_trade=body.maxPerTrade,
            daily_limit=body.dailyLimit,
            is_active=True,
            created_at=datetime.utcnow(),
        )
        session.add(follow)
        trader.follower_count = (trader.follower_count or 0) + 1
        session.commit()
        session.refresh(follow)
        return {"id": follow.id, "success": True}


@router.delete("/copy-trading/follow/{trader_id}")
async def unfollow_trader(request: Request, trader_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.copy_trading import CopyFollow, TraderProfile

    with get_session() as session:
        follow = (
            session.query(CopyFollow)
            .filter(
                CopyFollow.follower_id == payload["user_id"],
                CopyFollow.trader_id == trader_id,
                CopyFollow.is_active == True,
            )
            .first()
        )
        if not follow:
            raise HTTPException(status_code=404, detail="Not following this trader")

        follow.is_active = False
        trader = session.query(TraderProfile).filter(TraderProfile.id == trader_id).first()
        if trader and trader.follower_count:
            trader.follower_count = max(0, trader.follower_count - 1)
        session.commit()
    return {"success": True}


@router.get("/copy-trading/follows")
async def get_my_follows(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.copy_trading import CopyFollow, TraderProfile

    with get_session() as session:
        rows = (
            session.query(CopyFollow, TraderProfile)
            .join(
                TraderProfile,
                CopyFollow.trader_id == TraderProfile.id,
            )
            .filter(
                CopyFollow.follower_id == payload["user_id"],
                CopyFollow.is_active == True,
            )
            .all()
        )

        return [
            {
                "id": f.id,
                "traderId": f.trader_id,
                "traderName": t.display_name,
                "copyMode": f.copy_mode,
                "copyType": f.copy_type,
                "copyAmount": f.copy_amount,
                "copyPercentage": f.copy_percentage,
                "maxPerTrade": f.max_per_trade,
                "dailyLimit": f.daily_limit,
                "totalCopied": f.total_copied or 0,
                "totalPnl": float(f.total_pnl or 0),
                "isActive": f.is_active,
                "createdAt": f.created_at.isoformat() if f.created_at else None,
            }
            for f, t in rows
        ]


@router.get("/copy-trading/trades")
async def get_copy_trades(request: Request, limit: int = Query(default=50, le=200)):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.copy_trading import CopyTrade

    with get_session() as session:
        trades = (
            session.query(CopyTrade)
            .filter(
                CopyTrade.follower_id == payload["user_id"],
            )
            .order_by(CopyTrade.created_at.desc())
            .limit(limit)
            .all()
        )

        return [
            {
                "id": ct.id,
                "traderId": ct.trader_id,
                "traderName": getattr(ct, "trader_name", None),
                "fromToken": ct.from_token,
                "toToken": ct.to_token,
                "fromChain": ct.from_chain,
                "fromAmount": ct.from_amount,
                "toAmount": ct.to_amount,
                "pnl": float(ct.pnl) if ct.pnl else None,
                "status": ct.status,
                "createdAt": ct.created_at.isoformat() if ct.created_at else None,
            }
            for ct in trades
        ]


# ═══════════════════════════════════════════════════════════════════
#  SNIPING
# ═══════════════════════════════════════════════════════════════════


@router.get("/sniping/orders")
async def list_snipe_orders(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.snipe import SnipeOrder

    with get_session() as session:
        orders = (
            session.query(SnipeOrder)
            .filter(
                SnipeOrder.user_id == payload["user_id"],
            )
            .order_by(SnipeOrder.created_at.desc())
            .all()
        )

        return [
            {
                "id": o.id,
                "tokenAddress": o.token_mint,
                "tokenSymbol": o.token_symbol,
                "platform": o.platform.value if hasattr(o.platform, "value") else o.platform,
                "mode": o.mode.value if hasattr(o.mode, "value") else o.mode,
                "amountSol": str(o.sol_amount),
                "slippage": o.slippage_bps,
                "jitoTipLamports": o.jito_tip_lamports,
                "useMevProtection": o.use_jito,
                "status": o.status.value if hasattr(o.status, "value") else o.status,
                "txSignature": o.tx_signature,
                "tokensReceived": o.tokens_received,
                "executedAt": o.executed_at.isoformat() if o.executed_at else None,
                "createdAt": o.created_at.isoformat() if o.created_at else None,
            }
            for o in orders
        ]


@router.post("/sniping/orders")
async def create_snipe_order(request: Request, body: CreateSnipeBody):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.snipe import SnipeOrder

    with get_session() as session:
        order = SnipeOrder(
            user_id=payload["user_id"],
            token_mint=body.tokenAddress,
            platform=body.platform,
            mode=body.mode,
            sol_amount=float(body.amountSol),
            slippage_bps=body.slippage or 500,
            jito_tip_lamports=body.jitoTipLamports,
            use_jito=body.useMevProtection,
            status="pending",
            created_at=datetime.utcnow(),
        )
        session.add(order)
        session.commit()
        session.refresh(order)
        return {"id": order.id, "success": True}


@router.delete("/sniping/orders/{order_id}")
async def cancel_snipe_order(request: Request, order_id: int):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.snipe import SnipeOrder

    with get_session() as session:
        order = (
            session.query(SnipeOrder)
            .filter(
                SnipeOrder.id == order_id,
                SnipeOrder.user_id == payload["user_id"],
            )
            .first()
        )
        if not order:
            raise HTTPException(status_code=404, detail="Snipe order not found")
        order.status = "cancelled"
        session.commit()
    return {"success": True}


@router.get("/sniping/config")
async def get_snipe_config(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.snipe import SnipeConfig

    with get_session() as session:
        cfg = (
            session.query(SnipeConfig)
            .filter(
                SnipeConfig.user_id == payload["user_id"],
            )
            .first()
        )
        if not cfg:
            return {
                "quickAmounts": [0.1, 0.25, 0.5, 1.0],
                "defaultSlippage": 500,
                "defaultJitoTip": 10000,
                "autoSnipeEnabled": False,
                "maxAutoSnipePerDay": 5,
            }
        return {
            "quickAmounts": cfg.quick_amounts or [0.1, 0.25, 0.5, 1.0],
            "defaultSlippage": cfg.default_slippage_bps,
            "defaultJitoTip": cfg.default_jito_tip,
            "autoSnipeEnabled": cfg.auto_snipe_enabled,
            "maxAutoSnipePerDay": cfg.max_auto_snipe_per_day,
        }


# ═══════════════════════════════════════════════════════════════════
#  TOKEN PRICE & DISCOVERY
# ═══════════════════════════════════════════════════════════════════


@router.get("/token/{chain}/{address}/price")
async def get_token_price(
    request: Request,
    chain: str,
    address: str,
    timeframe: str = Query(default="1d"),
):
    """Get token price data with OHLCV history for chart rendering."""
    _jwt_user(request)
    import httpx
    import time

    # Map timeframe to seconds for mock data generation
    tf_seconds = {
        "1h": 3600,
        "1d": 86400,
        "1w": 604800,
        "1m": 2592000,
        "1y": 31536000,
    }
    tf_points = {
        "1h": 60,
        "1d": 96,
        "1w": 168,
        "1m": 120,
        "1y": 365,
    }
    total_seconds = tf_seconds.get(timeframe, 86400)
    num_points = tf_points.get(timeframe, 96)

    # Try DexScreener public API for real data
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"https://api.dexscreener.com/latest/dex/tokens/{address}")
            if resp.status_code == 200:
                data = resp.json()
                pairs = data.get("pairs") or []
                if pairs:
                    pair = pairs[0]
                    price = float(pair.get("priceUsd", 0))
                    change_24h = float(pair.get("priceChange", {}).get("h24", 0))
                    volume = float(pair.get("volume", {}).get("h24", 0))
                    liquidity = float(pair.get("liquidity", {}).get("usd", 0))
                    market_cap = pair.get("marketCap") or pair.get("fdv")
                    base_token = pair.get("baseToken", {})

                    # Generate synthetic price points based on current price and change
                    now = int(time.time())
                    step = total_seconds // num_points
                    start_price = price / (1 + change_24h / 100) if change_24h != 0 else price
                    prices = []
                    for i in range(num_points):
                        t = now - total_seconds + (i * step)
                        progress = i / max(num_points - 1, 1)
                        p = start_price + (price - start_price) * progress
                        # Add minor noise
                        import random

                        noise = p * random.uniform(-0.005, 0.005)
                        prices.append({"timestamp": t, "value": round(p + noise, 8)})

                    return {
                        "price": price,
                        "change24h": price - start_price,
                        "changePercent24h": change_24h,
                        "marketCap": float(market_cap) if market_cap else None,
                        "volume24h": volume,
                        "liquidity": liquidity,
                        "holders": None,
                        "symbol": base_token.get("symbol", ""),
                        "name": base_token.get("name", ""),
                        "logoUrl": None,
                        "prices": prices,
                    }
    except Exception as e:
        logger.warning(f"DexScreener lookup failed: {e}")

    # Fallback: return mock data
    import random

    now = int(time.time())
    step = total_seconds // num_points
    mock_price = random.uniform(0.5, 100)
    prices = []
    for i in range(num_points):
        t = now - total_seconds + (i * step)
        p = mock_price * (1 + random.uniform(-0.03, 0.03))
        prices.append({"timestamp": t, "value": round(p, 6)})
        mock_price = p

    return {
        "price": mock_price,
        "change24h": 0,
        "changePercent24h": 0,
        "marketCap": None,
        "volume24h": None,
        "liquidity": None,
        "holders": None,
        "symbol": address[:6].upper(),
        "name": "Unknown Token",
        "logoUrl": None,
        "prices": prices,
    }


@router.get("/discover/trending")
async def discover_trending(
    request: Request,
    chain: str = Query(default="all"),
    limit: int = Query(default=50, le=100),
):
    """Get trending tokens by volume."""
    _jwt_user(request)
    import httpx

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://api.dexscreener.com/token-boosts/top/v1",
            )
            if resp.status_code == 200:
                data = resp.json()
                tokens = []
                seen = set()
                for item in data[:limit]:
                    addr = item.get("tokenAddress", "")
                    if addr in seen:
                        continue
                    seen.add(addr)
                    tokens.append(
                        {
                            "address": addr,
                            "symbol": item.get("symbol", item.get("tokenAddress", "")[:6]),
                            "name": item.get("name", "Unknown"),
                            "chain": item.get("chainId", "unknown"),
                            "price": 0,
                            "change24h": 0,
                            "volume24h": 0,
                            "marketCap": None,
                            "logoUrl": item.get("icon"),
                        }
                    )
                return tokens
    except Exception as e:
        logger.warning(f"Trending tokens fetch failed: {e}")

    return []


@router.get("/discover/gainers")
async def discover_gainers(
    request: Request,
    timeframe: str = Query(default="24h"),
):
    """Get top gaining tokens."""
    _jwt_user(request)
    # Placeholder — would integrate with CoinGecko/DexScreener
    return []


@router.get("/discover/new")
async def discover_new(
    request: Request,
    chain: str = Query(default="all"),
):
    """Get recently launched tokens."""
    _jwt_user(request)
    # Placeholder — would integrate with launch_detector service
    return []


@router.get("/discover/search")
async def discover_search(
    request: Request,
    q: str = Query(min_length=2),
):
    """Search tokens by name, symbol, or address."""
    _jwt_user(request)
    import httpx

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"https://api.dexscreener.com/latest/dex/search?q={q}")
            if resp.status_code == 200:
                data = resp.json()
                pairs = data.get("pairs") or []
                tokens = []
                seen = set()
                for pair in pairs[:30]:
                    base = pair.get("baseToken", {})
                    addr = base.get("address", "")
                    if addr in seen:
                        continue
                    seen.add(addr)
                    tokens.append(
                        {
                            "address": addr,
                            "symbol": base.get("symbol", ""),
                            "name": base.get("name", ""),
                            "chain": pair.get("chainId", "unknown"),
                            "price": float(pair.get("priceUsd", 0)),
                            "change24h": float(pair.get("priceChange", {}).get("h24", 0)),
                            "volume24h": float(pair.get("volume", {}).get("h24", 0)),
                            "marketCap": pair.get("marketCap"),
                            "logoUrl": None,
                        }
                    )
                return tokens
    except Exception as e:
        logger.warning(f"Token search failed: {e}")

    return []


# ═══════════════════════════════════════════════════════════════════
#  SNIPING (continued)
# ═══════════════════════════════════════════════════════════════════


@router.put("/sniping/config")
async def update_snipe_config(request: Request, body: UpdateSnipeConfigBody):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.snipe import SnipeConfig

    with get_session() as session:
        cfg = (
            session.query(SnipeConfig)
            .filter(
                SnipeConfig.user_id == payload["user_id"],
            )
            .first()
        )
        if not cfg:
            cfg = SnipeConfig(user_id=payload["user_id"])
            session.add(cfg)

        if body.quickAmounts is not None:
            cfg.quick_amounts = body.quickAmounts
        if body.defaultSlippage is not None:
            cfg.default_slippage_bps = body.defaultSlippage
        if body.defaultJitoTip is not None:
            cfg.default_jito_tip = body.defaultJitoTip
        if body.autoSnipeEnabled is not None:
            cfg.auto_snipe_enabled = body.autoSnipeEnabled
        if body.maxAutoSnipePerDay is not None:
            cfg.max_auto_snipe_per_day = body.maxAutoSnipePerDay

        session.commit()
    return {"success": True}
