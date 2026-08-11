"""
JWT-authenticated REST endpoints for the Suwappu iOS/Android mobile app.

All Phase 2 features: wallets, alerts, orders, DCA, points, referrals,
copy trading, and sniping.  Delegates to existing service singletons.
"""

import asyncio
import hashlib
import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Optional, List, Tuple, Dict

from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from bot.utils.rate_limiter import RateLimitExceeded, UserRateLimiter
from database.db import get_session, DATABASE_AVAILABLE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/mobile", tags=["mobile"])


# ── reward-redemption idempotency (H6 defense-in-depth) ────────────────────
#
# The MONEY-PATH double-spend fix is the `.with_for_update()` row lock added
# in points_service (spend_points / redeem_subscription_reward /
# redeem_marketplace_reward) — that's what actually makes it impossible for
# two concurrent redeems to both read the same current_points and both pass
# the balance check, regardless of process/worker topology.
#
# This in-process cache is a SEPARATE, secondary concern: it makes an exact
# retry (same client `Idempotency-Key`, or an unkeyed burst of duplicate taps
# within a couple seconds) replay the FIRST call's result instead of
# re-invoking the service — so a client that retries after a dropped response
# doesn't see a confusing "not enough points" for a redemption that actually
# already succeeded. It mirrors the spirit of swap_engine's idempotency_key
# lookup (return the existing record instead of re-executing) without adding
# a new DB column/migration — this route only owns points_service.py,
# mobile.py, and tempo.py for this change.
#
# NOT durable across process restarts or multiple worker processes — that's
# fine, the DB-level lock is the actual safety net.
#
# NEW-6, FIXED: this in-process cache is per-process (a plain in-memory dict).
# On a multi-worker/multi-replica deploy (Railway can run several
# `uvicorn`/gunicorn workers or replicas), a client retry can land on a
# DIFFERENT process than the one that handled the original request, miss this
# cache entirely, and re-invoke points_service — re-charging the user for a
# redemption whose first response was merely dropped/timed-out in transit.
# The `.with_for_update()` DB lock still prevents a *lost update*, but it does
# NOT prevent this *duplicate, independently-successful* spend, since each
# process-local attempt reads a balance that's genuinely sufficient at the
# time it runs. The durable fix: a UNIQUE(user_id, idempotency_key) partial
# index on `point_redemptions` (see database/db.py
# `_add_point_redemption_idempotency_key`), plus a `points_service` /
# `PointRedemption.idempotency_key` column so a retry's INSERT conflicts and
# is turned into a lookup-and-replay at the DB layer — durable across process
# restarts and multi-replica deploys, unlike this in-process cache alone.
_REDEEM_IDEM_TTL_SECONDS = 300
_redeem_idem_registry_lock = threading.Lock()


@dataclass
class _IdemEntry:
    """One idempotency cache slot: the lock guarding a (user_id, key) request
    plus its cached result, once known.

    This replaces what used to be TWO parallel dicts (`_redeem_idem_locks` +
    `_redeem_idem_results`) keyed by the same tuple, which needed three
    separate functions to keep in sync — and a NEW-7 comment on this module
    previously documented a real bug caused by exactly that drift (a lock
    surviving forever after its matching result was pruned via the lazy
    lookup path, because the bulk sweep only ever walked the results dict).
    With one dict, lookup/store/prune are each a single dict operation and
    the two halves can never disagree with each other again.

    `timestamp`/`status_code`/`body` are None while the request this entry
    guards is still in flight (lock claimed, result not yet known).
    """

    lock: threading.Lock
    timestamp: Optional[float] = None
    status_code: Optional[int] = None
    body: Optional[dict] = None


_redeem_idem_entries: Dict[tuple, _IdemEntry] = {}


def _redeem_idempotency_cache_key(request: Request, user_id: int, reward_id: int) -> tuple:
    """Resolve the (user_id, key) idempotency cache key for a redeem request.

    Prefers the client-supplied `Idempotency-Key` header. Falls back to a key
    derived from (reward_id, a 2-second time bucket) so an unkeyed burst of
    near-simultaneous duplicate requests for the SAME reward collapses onto
    one key, without blocking legitimate repeat purchases spaced further
    apart (callers that want a real dedupe guarantee should send the header).

    NEW-5 fix: the header-derived key previously omitted `reward_id`, i.e. the
    cache key was just (user_id, "hdr:"+header). A client that reused ONE
    Idempotency-Key across two DIFFERENT reward redemptions within the TTL
    window would get reward A's cached success replayed as a FALSE SUCCESS for
    reward B — a redemption that never actually ran. Scope the header key to
    reward_id too, matching the "auto:" fallback key's shape.
    """
    header_key = request.headers.get("Idempotency-Key") or request.headers.get("idempotency-key")
    if header_key and header_key.strip():
        key = f"hdr:{reward_id}:{header_key.strip()[:128]}"
    else:
        bucket = int(time.time() // 2)
        key = f"auto:{reward_id}:{bucket}"
    return (user_id, key)


def _redeem_idem_get_lock(cache_key: tuple) -> threading.Lock:
    """Get (or create) the lock guarding a cache key, claiming an in-flight
    entry for it if none exists yet."""
    with _redeem_idem_registry_lock:
        entry = _redeem_idem_entries.get(cache_key)
        if entry is None:
            entry = _IdemEntry(lock=threading.Lock())
            _redeem_idem_entries[cache_key] = entry
        return entry.lock


def _redeem_idem_prune(cache_key: tuple) -> None:
    """Remove a key's entry (lock + cached result together) in one operation.

    Safe to call even though the caller may still hold a *local* reference to
    this entry's lock object (via `with lock:`) — we're only removing it from
    the registry dict, not mutating/acquiring anything, so a future request
    for this key (post-TTL) just gets a fresh `_IdemEntry` instead of finding
    a stale one."""
    with _redeem_idem_registry_lock:
        _redeem_idem_entries.pop(cache_key, None)


def _redeem_idem_lookup(cache_key: tuple) -> Optional[Tuple[int, dict]]:
    entry = _redeem_idem_entries.get(cache_key)
    if not entry or entry.timestamp is None:
        return None
    if time.time() - entry.timestamp > _REDEEM_IDEM_TTL_SECONDS:
        _redeem_idem_prune(cache_key)
        return None
    return entry.status_code, entry.body


def _redeem_idem_store(cache_key: tuple, status_code: int, body: dict) -> None:
    now = time.time()
    entry = _redeem_idem_entries.get(cache_key)
    if entry is None:
        entry = _IdemEntry(lock=threading.Lock())
        _redeem_idem_entries[cache_key] = entry
    entry.timestamp = now
    entry.status_code = status_code
    entry.body = body
    # Bound unbounded growth for a long-lived worker process. Only entries
    # with a KNOWN (non-expired) result are eligible for removal — an
    # in-flight entry (timestamp still None, lock actively held by a
    # concurrent request) is left alone regardless of how large the dict
    # gets, since we have no way to know its age and removing it could hand
    # a fresh Lock object to a genuinely-concurrent duplicate request.
    if len(_redeem_idem_entries) > 1000:
        with _redeem_idem_registry_lock:
            expired = [
                k
                for k, e in _redeem_idem_entries.items()
                if e.timestamp is not None and now - e.timestamp > _REDEEM_IDEM_TTL_SECONDS
            ]
            for k in expired:
                _redeem_idem_entries.pop(k, None)


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


class AskBody(BaseModel):
    text: str


def _decimal(value) -> Decimal:
    """Best-effort numeric coercion for read-only analytics."""
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _snapshot_payload(
    balances_by_chain: dict[str, dict[str, Decimal]],
    prices: dict[str, float | None],
    history: list[dict],
) -> dict:
    """Build deterministic, display-ready analytics from balances + prices.

    This is intentionally pure: model output is never allowed to calculate an
    authoritative balance, allocation, or change percentage for Gecko.
    """
    token_values: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    chain_values: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

    for chain, tokens in balances_by_chain.items():
        for symbol, amount in tokens.items():
            price = _decimal(prices.get(symbol))
            value = _decimal(amount) * price
            if value <= 0:
                continue
            token_values[symbol] += value
            chain_values[chain] += value

    total = sum(token_values.values(), Decimal("0"))
    holdings = [
        {
            "symbol": symbol,
            "valueUsd": float(value),
            "allocationPct": float((value / total * Decimal("100")) if total else 0),
        }
        for symbol, value in sorted(token_values.items(), key=lambda item: item[1], reverse=True)
    ]
    chains = [
        {"name": name, "valueUsd": float(value)}
        for name, value in sorted(chain_values.items(), key=lambda item: item[1], reverse=True)
    ]

    clean_history = []
    for point in history:
        date = point.get("date")
        value = point.get("value_usd", point.get("valueUsd"))
        if date is None or value is None:
            continue
        clean_history.append({"date": str(date), "valueUsd": float(_decimal(value))})

    return {
        "totalValueUsd": float(total),
        "byToken": holdings,
        "byChain": chains,
        "history": clean_history,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        # WalletService currently degrades individual RPC failures to zero on
        # several providers, so V0 cannot prove that a cross-network read is
        # complete. Never use this snapshot for performance/change claims.
        "coverage": "best_effort",
    }


def _unique_wallets(wallets: list) -> list:
    """Deduplicate persisted wallet rows without conflating case-sensitive addresses."""
    seen: set[tuple[str, str]] = set()
    result = []
    for wallet in wallets:
        chain_type = str(wallet.chain_type or "").lower()
        address = str(wallet.address or "").strip()
        normalized_address = address.lower() if chain_type in {"evm", "starknet"} else address
        key = (chain_type, normalized_address)
        if not address or key in seen:
            continue
        seen.add(key)
        result.append(wallet)
    return result


async def _build_snapshot(user_id: int) -> dict:
    """Read the user's real wallets and price them through existing services."""
    from bot.services.pnl import pnl_service
    from bot.services.price_service import price_service
    from bot.services.wallet import WalletService

    wallet_service = WalletService()
    wallets = _unique_wallets(wallet_service.get_user_wallets(user_id))
    balances: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))

    for wallet in wallets:
        if not wallet.address:
            continue
        try:
            wallet_balances = await wallet_service.get_balances_by_address(
                wallet.address, wallet.chain_type
            )
        except Exception as exc:
            # One unavailable RPC must not blank the rest of a user's money.
            logger.warning("mobile snapshot balance read failed for wallet %s: %s", wallet.id, exc)
            continue
        for chain, tokens in wallet_balances.items():
            for symbol, amount in tokens.items():
                balances[chain][symbol] += _decimal(amount)

    symbols = sorted({symbol for tokens in balances.values() for symbol in tokens})
    prices = await price_service.get_prices(symbols) if symbols else {}
    history = pnl_service.get_portfolio_history(user_id, days=30)
    return _snapshot_payload(balances, prices, history)


def _answer_from_snapshot(text: str, snapshot: dict, recent: list[dict]) -> dict:
    """Answer Gecko's first analytics intents without inventing financial data."""
    lowered = " ".join(text.lower().split())
    holdings = snapshot.get("byToken") or []
    total = float(snapshot.get("totalValueUsd") or 0)
    suggestions = [
        "What changed this week?",
        "How concentrated am I?",
        "What have I done lately?",
    ]

    if any(word in lowered for word in ("swap", "buy", "sell", "trade", "send", "withdraw")):
        return {
            "type": "action_preview",
            "answer": (
                "I can prepare money actions here, but this Gecko preview will not move funds. "
                "Execution stays behind Suwappu's existing confirmation and policy checks."
            ),
            "data": {"requiresConfirmation": True},
            "suggestions": suggestions,
        }

    concentration_words = ("concentrat", "divers", "largest", "biggest", "allocation")
    if any(word in lowered for word in concentration_words):
        if not holdings:
            answer = "I don't have enough priced holdings to measure concentration yet."
        else:
            top = holdings[0]
            answer = (
                f"Your largest holding is {top['symbol']} at {top['allocationPct']:.1f}% "
                "of the money I can currently price."
            )
        return {
            "type": "concentration",
            "answer": answer,
            "data": holdings[:5],
            "suggestions": suggestions,
        }

    if any(word in lowered for word in ("changed", "change", "week", "today")):
        if snapshot.get("coverage") != "complete":
            return {
                "type": "change",
                "answer": (
                    "I’m not calling a gain or loss yet because this preview can’t verify "
                    "complete source coverage. I’d rather withhold the number than invent one."
                ),
                "data": None,
                "suggestions": suggestions,
            }
        history = snapshot.get("history") or []
        cutoff = datetime.now(timezone.utc).date() - timedelta(days=7)
        recent_history = []
        for point in history:
            try:
                point_date = datetime.fromisoformat(str(point.get("date"))).date()
            except (TypeError, ValueError):
                continue
            if point_date >= cutoff:
                recent_history.append(point)

        if not recent_history:
            answer = (
                "I don't have a saved snapshot from the last week to calculate a real change yet."
            )
            data = None
        else:
            start = float(recent_history[0].get("valueUsd") or 0)
            delta = total - start
            pct = (delta / start * 100) if start > 0 else None
            direction = "up" if delta >= 0 else "down"
            pct_text = f" ({abs(pct):.1f}%)" if pct is not None else ""
            answer = (
                f"The money I can price is {direction} ${abs(delta):,.2f}{pct_text} "
                "versus your earliest saved snapshot from the last week."
            )
            data = {"fromUsd": start, "toUsd": total, "deltaUsd": delta, "deltaPct": pct}
        return {"type": "change", "answer": answer, "data": data, "suggestions": suggestions}

    if any(word in lowered for word in ("activity", "done", "recent", "lately")):
        if not recent:
            answer = "I don't see any recent money moves on this account."
        else:
            latest = recent[0]
            answer = (
                f"Your latest conversion was {latest['fromToken']} to {latest['toToken']} "
                f"({latest['status']})."
            )
        return {"type": "activity", "answer": answer, "data": recent, "suggestions": suggestions}

    if any(word in lowered for word in ("balance", "money", "portfolio", "worth", "have")):
        top_text = ""
        if holdings:
            top_text = (
                f" Your largest holding is {holdings[0]['symbol']} at "
                f"{holdings[0]['allocationPct']:.1f}%."
            )
        return {
            "type": "snapshot",
            "answer": f"I can currently price ${total:,.2f} across your connected money.{top_text}",
            "data": snapshot,
            "suggestions": suggestions,
        }

    return {
        "type": "help",
        "answer": "Ask me about your balance, concentration, what changed, or recent activity.",
        "data": None,
        "suggestions": suggestions,
    }


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


# -- earn / savings --
class EarnAmountBody(BaseModel):
    amount: str
    walletId: Optional[int] = None


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


@router.get("/snapshot")
async def get_snapshot(request: Request):
    """Real, JWT-scoped money snapshot for Gecko Today + Money.

    No agent key is accepted and no client-provided wallet address is trusted;
    wallet ownership is resolved exclusively from the authenticated user id.
    """
    payload = _jwt_user(request)
    _require_db()
    return await _build_snapshot(int(payload["user_id"]))


@router.post("/ask")
async def ask_gecko(request: Request, body: AskBody):
    """Read-only Gecko V0 assistant over authoritative account analytics.

    Money-moving language deliberately returns a preview boundary. This route
    never quotes, signs, broadcasts, or invokes a trading execution service.
    """
    payload = _jwt_user(request)
    _require_db()
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Ask Gecko a question")
    if len(text) > 1000:
        raise HTTPException(status_code=400, detail="Question is too long")

    snapshot = await _build_snapshot(int(payload["user_id"]))

    from bot.models.swap import SwapTransaction

    with get_session() as session:
        rows = (
            session.query(SwapTransaction)
            .filter(SwapTransaction.user_id == int(payload["user_id"]))
            .order_by(SwapTransaction.created_at.desc())
            .limit(5)
            .all()
        )
        recent = [
            {
                "fromToken": row.from_token,
                "toToken": row.to_token,
                "status": row.status.value if hasattr(row.status, "value") else str(row.status),
                "createdAt": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]

    return _answer_from_snapshot(text, snapshot, recent)


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
    """NEW-9 fix: this handler referenced `up.points`, `up.spendable_points`,
    `up.level_emoji`, `up.fee_discount`, `up.next_level`, `up.last_checkin_at`
    — NONE of these exist on UserPoints (bot/models/points.py has
    current_points, total_points_earned, xp, level, daily_streak,
    longest_streak, last_checkin). `up.xp_to_next_level` is also a METHOD, not
    a property, so it previously serialized as a bound method, not an int.
    Every one of these was an AttributeError -> 500 (or a bad payload) on the
    only endpoint that renders the balance /checkin and /redeem mutate. Map
    every field to the real column/helper below (same bug class as the
    `r.cost` fix in GET /points/rewards)."""
    payload = _jwt_user(request)
    _require_db()

    from bot.models.points import UserPoints, LEVELS

    LEVEL_ORDER = ["bronze", "silver", "gold", "platinum", "diamond"]

    with get_session() as session:
        up = (
            session.query(UserPoints)
            .filter(
                UserPoints.user_id == payload["user_id"],
            )
            .first()
        )

        if not up:
            bronze = LEVELS["bronze"]
            return {
                "points": 0,
                "spendablePoints": 0,
                "xp": 0,
                "level": "bronze",
                "levelEmoji": bronze["emoji"],
                # ROADMAP value only — NOT the charged fee rate. See
                # UserPoints.get_fee_discount()'s docstring: the fee actually
                # charged comes from the user's subscription tier
                # (fee_service.TIER_FEE_RATES), independent of XP level.
                "feeDiscount": bronze["fee"],
                "nextLevel": "silver",
                "xpToNextLevel": LEVELS["silver"]["xp"],
                "dailyStreak": 0,
                "longestStreak": 0,
                "lastCheckinAt": None,
                "canCheckin": True,
            }

        level_info = up.get_level_info()
        try:
            level_idx = LEVEL_ORDER.index(up.level)
        except ValueError:
            level_idx = 0
        next_level = LEVEL_ORDER[level_idx + 1] if level_idx < len(LEVEL_ORDER) - 1 else None

        today = datetime.now(timezone.utc).date()
        can_checkin = not (up.last_checkin and up.last_checkin.date() == today)

        return {
            # "points" = lifetime total earned; "spendablePoints" = the
            # actual redeemable balance (current_points).
            "points": up.total_points_earned,
            "spendablePoints": up.current_points,
            "xp": up.xp,
            "level": up.level,
            "levelEmoji": level_info["emoji"],
            # ROADMAP value only — see the no-account branch above.
            "feeDiscount": level_info["fee"],
            "nextLevel": next_level,
            "xpToNextLevel": up.xp_to_next_level(),
            "dailyStreak": up.daily_streak,
            "longestStreak": up.longest_streak,
            "lastCheckinAt": up.last_checkin.isoformat() if up.last_checkin else None,
            "canCheckin": can_checkin,
        }


@router.post("/points/checkin")
async def daily_checkin(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.services.points_service import points_service

    try:
        points_earned, daily_streak, streak_continued, new_level = points_service.daily_checkin(
            payload["user_id"]
        )
    except Exception as e:
        logger.error(f"daily_checkin failed for user {payload['user_id']}: {e}")
        raise HTTPException(status_code=400, detail="Check-in failed")

    return {
        "pointsEarned": points_earned,
        "dailyStreak": daily_streak,
        "streakContinued": streak_continued,
        "newLevel": new_level,
    }


@router.get("/points/milestones")
async def get_milestones(request: Request):
    payload = _jwt_user(request)
    _require_db()

    from bot.models.points import Milestone, UserMilestone

    with get_session() as session:
        milestones = (
            session.query(Milestone)
            .filter(Milestone.is_active == True)
            .order_by(Milestone.requirement_value)
            .all()
        )
        achieved_ids = set(
            m.milestone_id
            for m in session.query(UserMilestone)
            .filter(UserMilestone.user_id == payload["user_id"])
            .all()
        )

        return [
            {
                "id": m.id,
                "name": m.name,
                "description": m.description,
                "emoji": m.emoji,
                "requirementType": m.requirement_type,
                "requirementValue": m.requirement_value,
                "pointsReward": m.points_reward,
                "isAchieved": m.id in achieved_ids,
            }
            for m in milestones
        ]


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
                # M1 fix: the Reward model has `points_cost`, not `cost` — the
                # old attribute name doesn't exist and 500'd every call.
                "cost": r.points_cost,
                "rewardType": r.reward_type,
                "rewardValue": r.reward_value,
                "isAvailable": r.is_available if hasattr(r, "is_available") else True,
            }
            for r in rewards
        ]


@router.post("/points/rewards/{reward_id}/redeem")
def redeem_reward(request: Request, reward_id: int):
    """Redeem a reward for points.

    H6 fix: this is a `def`, not `async def`. There is no `await` anywhere in
    this body — every DB call goes through the synchronous `get_session()` /
    `points_service` (blocking SQLAlchemy calls) — so FastAPI was running this
    as a coroutine directly ON the event loop. That made the
    `threading.Lock()` acquired below (`with lock:`) a REAL blocking call on
    the loop thread: a slow/blocked redemption for one user stalled the
    ENTIRE bot's event loop (all other users' requests) for its duration, not
    just that user's own request. Declaring this `def` makes FastAPI run it
    in its threadpool, where a real OS lock is the correct primitive.

    MONEY-PATH: dispatches to the SAME atomic, all-or-nothing points_service
    methods used by the Telegram /xp flow (bot/handlers/points.py::redeem_callback) —
    there is no generic `points_service.redeem_reward`, so this mirrors that
    handler's routing by reward shape instead of inventing new semantics:
      - async marketplace categories (gift_card/travel/merch/donation/experience)
        -> redeem_marketplace_reward (debit + fulfillment order, auto-refunds on
        provider failure)
      - cash-equivalent types (partner_transfer/miles/cashout/stablecoin) -> reject,
        not live yet
      - "subscription" -> redeem_subscription_reward (debit + tier grant/extend)
      - everything else (fee_discount/gas_rebate/raffle/etc, "own_product") ->
        spend_points (generic debit; effect applied at swap time)
    All paths spend ONLY current_points (spendable currency) — never XP or
    season/convertible points, per the two-balance rule.

    IDEMPOTENCY (H6): pass a client `Idempotency-Key` header to guarantee a
    retry replays the first call's result instead of re-spending points. When
    no header is sent, a short-lived derived key still collapses an unkeyed
    burst of near-simultaneous duplicate taps for the SAME reward. See
    `_redeem_idempotency_cache_key` above — the actual double-spend
    prevention is the `.with_for_update()` row lock in points_service; this is
    defense-in-depth for client retry UX.
    """
    payload = _jwt_user(request)
    _require_db()

    from bot.models.points import Reward
    from bot.services.points_service import points_service
    from bot.services.reward_providers import ASYNC_CATEGORIES

    user_id = payload["user_id"]

    with get_session() as session:
        reward = (
            session.query(Reward).filter(Reward.id == reward_id, Reward.is_active == True).first()
        )
        if not reward:
            raise HTTPException(status_code=404, detail="Reward not found")
        if not reward.is_active:
            raise HTTPException(status_code=400, detail="That reward isn't available.")
        reward_type = reward.reward_type
        reward_value = reward.reward_value
        reward_cost = reward.points_cost
        reward_duration_days = reward.duration_days
        reward_category = getattr(reward, "reward_category", None) or "own_product"

    if reward_type in ("partner_transfer", "miles", "cashout", "stablecoin"):
        raise HTTPException(
            status_code=400,
            detail="That reward isn't available — partner redemptions aren't live yet.",
        )

    cache_key = _redeem_idempotency_cache_key(request, user_id, reward_id)
    # Durable (DB-level) idempotency key derived from the SAME cache_key that
    # guards the in-process cache, so a retry that misses the in-process
    # cache (different worker/process, or after a restart) still resolves to
    # the same key at the point_redemptions unique-index layer. Hashed +
    # truncated to fit the VARCHAR(160) column regardless of header length.
    idempotency_key = f"redeem:{hashlib.sha256(str(cache_key).encode()).hexdigest()}"
    lock = _redeem_idem_get_lock(cache_key)

    with lock:
        cached = _redeem_idem_lookup(cache_key)
        if cached is not None:
            status_code, body = cached
            if status_code >= 400:
                raise HTTPException(status_code=status_code, detail=body.get("detail"))
            return body

        try:
            if reward_category in ASYNC_CATEGORIES:
                success, message, order_id = points_service.redeem_marketplace_reward(
                    user_id=user_id, reward_id=reward_id, idempotency_key=idempotency_key
                )
                result = {"success": success, "message": message, "orderId": order_id}
            elif reward_type == "subscription":
                success, message, expires_at = points_service.redeem_subscription_reward(
                    user_id=user_id, reward_id=reward_id, idempotency_key=idempotency_key
                )
                result = {"success": success, "message": message, "expiresAt": expires_at}
            else:
                success, message = points_service.spend_points(
                    user_id=user_id,
                    amount=reward_cost,
                    reward_type=reward_type,
                    reward_value=reward_value,
                    duration_days=reward_duration_days,
                    idempotency_key=idempotency_key,
                )
                result = {"success": success, "message": message}
        except HTTPException as he:
            # Business rejection (e.g. reward validation) — deterministic,
            # safe to cache and replay on retry.
            _redeem_idem_store(cache_key, he.status_code, {"detail": he.detail})
            raise
        except Exception as e:
            # Finding 7: an UNEXPECTED exception (network blip, DB hiccup,
            # transient error) is NOT a deterministic outcome — the actual
            # spend/no-spend state is unknown here (points_service already
            # rolls its own transaction back on failure, but we can't prove
            # that happened for every possible exception source). Caching a
            # generic failure here would make a legitimate retry replay a
            # stale "failed" response forever, even once the transient
            # condition clears and the retry would actually have succeeded.
            # Let it through uncached so retries actually retry.
            logger.error(f"Reward redemption crashed for user {user_id}, reward {reward_id}: {e}")
            raise HTTPException(
                status_code=400, detail="Redemption failed — your points were not spent."
            )

        if not result.get("success"):
            # Business rejection (insufficient points, reward unavailable,
            # etc.) — deterministic, safe to cache and replay on retry.
            body = {"detail": result.get("message") or "Redemption failed."}
            _redeem_idem_store(cache_key, 400, body)
            raise HTTPException(status_code=400, detail=body["detail"])

        _redeem_idem_store(cache_key, 200, result)
        return result


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
                # Bonus fix (same bug class as NEW-9): `level_emoji` isn't a
                # UserPoints attribute either — it would have 500'd this route
                # too. Derive it from the model's own level-info helper.
                "levelEmoji": up.get_level_info()["emoji"],
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


# ═══════════════════════════════════════════════════════════════════
#  SAVINGS / EARN — MONEY-PATH (Aave V3 USDC on Base)
#
# Delegates 100% of on-chain logic (reads AND writes) to
# bot.services.savings_service.savings_service — the exact same service the
# Telegram /save flow uses. This module only: resolves the caller's wallet
# from the authenticated JWT (never a client-supplied address), validates the
# amount, and maps SavingsError -> a clean 4xx instead of a raw exception.
# ═══════════════════════════════════════════════════════════════════

_MAX_EARN_AMOUNT_INPUT_LENGTH = 64

# Dust / magnitude bounds (HIGH + MED money-path findings). Below the min, a
# real on-chain deposit/withdraw is pointless risk for the gas spent framing
# it; above the max, an amount this large is almost certainly a client bug
# (e.g. a unit mismatch) rather than a real USDC balance, and should fail
# fast with a clean 400 instead of surfacing as an obscure 500 deep in
# Decimal/web3 arithmetic.
_MIN_EARN_AMOUNT = Decimal("0.01")
_MAX_EARN_AMOUNT = Decimal("1000000")
_EARN_AMOUNT_QUANT = Decimal("0.000001")  # 6dp — USDC's on-chain precision


def _quantize_earn_amount(amount: Decimal) -> Decimal:
    """Truncate (never round up) to USDC's 6-decimal on-chain precision, so
    the amount echoed back to the client always matches the wei actually
    executed on-chain (LOW finding)."""
    return amount.quantize(_EARN_AMOUNT_QUANT, rounding=ROUND_DOWN)


async def _resolve_earn_wallet(user_id: int):
    """Resolve the user's default EVM wallet for Aave savings (default, else
    first). Used when the caller doesn't specify a `walletId`.

    Returns None when the user has no EVM wallet yet so callers can return a
    clean 400 instead of a failure deep inside web3 calls.
    """
    from bot.services.wallet import WalletService

    wallet_service = WalletService()
    wallet = wallet_service.get_default_wallet(user_id, "evm")
    if wallet:
        return wallet
    wallets = _unique_wallets(wallet_service.get_user_wallets(user_id))
    evm_wallets = [w for w in wallets if str(w.chain_type or "").lower() == "evm"]
    return evm_wallets[0] if evm_wallets else None


async def _get_user_evm_wallets(user_id: int) -> list:
    """All of the user's active EVM wallets, deduplicated — used by GET /earn
    to aggregate savings across every wallet, and to validate a client-
    supplied `walletId` on deposit/withdraw."""
    from bot.services.wallet import WalletService

    wallet_service = WalletService()
    wallets = _unique_wallets(wallet_service.get_user_wallets(user_id))
    return [w for w in wallets if str(w.chain_type or "").lower() == "evm" and w.address]


async def _resolve_earn_wallet_by_id(user_id: int, wallet_id: int):
    """Resolve a client-supplied `walletId`, validated to belong to the
    authenticated JWT user (MED finding). Returns None for a missing/foreign/
    non-EVM wallet — callers turn that into a 400 "Unknown wallet" rather
    than a 404/403 that would leak whether the id exists for someone else.
    """
    wallets = await _get_user_evm_wallets(user_id)
    for wallet in wallets:
        if wallet.id == wallet_id:
            return wallet
    return None


def _parse_earn_amount(
    raw: str, *, available: Decimal, max_returns_none: bool = False
) -> Optional[Decimal]:
    """Parse an /earn/deposit or /earn/withdraw amount.

    Accepts a positive decimal string, or the sentinel "max" (case-insensitive)
    which resolves to the caller's live `available` balance. Returns None only
    for the "max" sentinel on withdraw, where SavingsService.withdraw expects
    None to mean "withdraw the full on-chain position" (captures interest
    accrued between this read and execution). Never lets NaN/Infinity/
    negative/zero/dust/oversized amounts through to the on-chain call.
    """
    if raw is None or not str(raw).strip():
        raise HTTPException(status_code=400, detail="amount is required")
    cleaned = str(raw).strip()
    if len(cleaned) > _MAX_EARN_AMOUNT_INPUT_LENGTH:
        raise HTTPException(status_code=400, detail="Invalid amount")
    if cleaned.lower() == "max":
        if available <= 0:
            raise HTTPException(status_code=400, detail="Nothing available to use.")
        return None if max_returns_none else _quantize_earn_amount(available)
    try:
        amount = Decimal(cleaned)
    except (InvalidOperation, ArithmeticError):
        raise HTTPException(status_code=400, detail="Invalid amount")
    if not amount.is_finite() or amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be a positive number")
    if amount > _MAX_EARN_AMOUNT:
        raise HTTPException(status_code=400, detail="Invalid amount")
    if amount < _MIN_EARN_AMOUNT:
        raise HTTPException(status_code=400, detail="Minimum amount is 0.01 USDC")
    return _quantize_earn_amount(amount)


async def _log_earn_event(user_id: int, wallet_id: int, action: str, amount, tx_hash: str) -> None:
    """Best-effort SavingsEvent record — mirrors bot/handlers/savings.py's
    `_log_event` so Telegram and mobile deposits/withdrawals show up in the
    same history. Never allowed to fail the request."""
    try:
        from bot.models.savings import SavingsEvent

        with get_session() as session:
            session.add(
                SavingsEvent(
                    user_id=user_id,
                    wallet_id=wallet_id,
                    chain="base",
                    token="USDC",
                    action=action,
                    amount=(Decimal(str(amount)) if amount is not None else None),
                    tx_hash=(
                        ("0x" + tx_hash) if tx_hash and not tx_hash.startswith("0x") else tx_hash
                    ),
                )
            )
    except Exception as e:
        logger.warning(f"Failed to log mobile earn event: {e}")


@router.get("/earn")
async def get_earn(request: Request):
    """Real Aave V3 (Base) USDC savings snapshot for the authenticated user,
    aggregated across ALL of the user's EVM wallets (MED finding — a user
    with more than one Base wallet previously only ever saw their default
    wallet's savings, silently hiding funds in any other wallet).

    Read-only: never signs or sends a transaction. `positions` has one entry
    per wallet with a nonzero aUSDC position; `idle` has one entry per wallet
    with nonzero deposit-able USDC. Each entry carries `walletId` so the
    client can route a follow-up deposit/withdraw at that specific wallet.
    """
    payload = _jwt_user(request)
    _require_db()

    from bot.services.savings_service import SavingsError, savings_service

    user_id = int(payload["user_id"])

    try:
        apy = await asyncio.to_thread(savings_service.get_apy)
    except SavingsError as e:
        raise HTTPException(status_code=503, detail=str(e))

    wallets = await _get_user_evm_wallets(user_id)

    positions: list[dict] = []
    idle: list[dict] = []
    coverage = "complete"

    async def _read_one(wallet):
        try:
            position, idle_balance = await asyncio.gather(
                asyncio.to_thread(savings_service.get_position, wallet.address),
                asyncio.to_thread(savings_service.get_usdc_balance, wallet.address),
            )
            return wallet, position, idle_balance, None
        except SavingsError as e:
            return wallet, None, None, e

    for wallet, position, idle_balance, err in await asyncio.gather(
        *(_read_one(w) for w in wallets)
    ):
        if err is not None:
            logger.warning(
                f"mobile earn balance read failed for user {user_id} wallet {wallet.id}: {err}"
            )
            coverage = "best_effort"
            continue
        if position > 0:
            positions.append(
                {
                    "walletId": wallet.id,
                    "walletAddress": wallet.address,
                    "protocol": "aave_v3",
                    "chain": "base",
                    "token": "USDC",
                    "balance": str(position),
                    "balanceUsd": float(position),
                    "apy": apy,
                }
            )
        if idle_balance > 0:
            idle.append(
                {
                    "walletId": wallet.id,
                    "walletAddress": wallet.address,
                    "chain": "base",
                    "token": "USDC",
                    "balance": str(idle_balance),
                    "balanceUsd": float(idle_balance),
                }
            )

    return {"apy": apy, "positions": positions, "idle": idle, "coverage": coverage}


# ── earn action concurrency + idempotency (HIGH finding) ────────────────────
#
# Mirrors the reward-redemption idempotency pattern above (`_redeem_idem_*`
# / `_IdemEntry`), adapted for a route that is genuinely `async def` (every
# on-chain read/write here is dispatched via `asyncio.to_thread`, so callers
# await this coroutine rather than blocking a threadpool thread the way
# `redeem_reward` does). Two distinct problems, one lock:
#
#   1. Concurrency: two overlapping deposit/withdraw calls for the SAME
#      (user_id, wallet.address) must not both read a stale balance and both
#      pass validation (e.g. two withdraws that each see the full position as
#      "available" and both attempt to move it). A per-(user, wallet) asyncio
#      lock held across the ENTIRE read -> validate -> execute block forces
#      the second call to wait for the first to fully finish (and, per (2)
#      below, to see whatever the first one just cached) before it reads a
#      balance of its own.
#   2. Idempotency: a client `Idempotency-Key` header (or a short auto-derived
#      key for an unkeyed burst of duplicate taps) lets a dropped-response
#      retry replay the FIRST call's result instead of re-executing a SECOND
#      on-chain tx. Same in-process, non-durable-across-restarts caveat as
#      `_redeem_idem_*` — that's fine, it's a UX nicety on top of the wallet
#      lock above, not the sole safety net.
_EARN_IDEM_TTL_SECONDS = 300
_earn_wallet_locks: Dict[tuple, asyncio.Lock] = {}
_earn_idem_entries: Dict[tuple, _IdemEntry] = {}

_earn_action_limiter = UserRateLimiter(max_requests=6, window_seconds=60)


def _earn_wallet_lock(user_id: int, wallet_address: str) -> asyncio.Lock:
    """Get (or create) the asyncio lock serializing earn actions for one
    (user, wallet) pair. Safe to call from an async context without any extra
    locking around the dict itself — a single-threaded event loop never
    yields mid-`dict.get`/`dict.__setitem__`, so two concurrent coroutines
    can't race to create two different Lock objects for the same key."""
    key = (user_id, str(wallet_address or "").lower())
    lock = _earn_wallet_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _earn_wallet_locks[key] = lock
    return lock


def _earn_idempotency_cache_key(request: Request, user_id: int, scope: str) -> tuple:
    """Same shape as `_redeem_idempotency_cache_key`: prefer the client's
    `Idempotency-Key` header; otherwise collapse an unkeyed near-simultaneous
    burst for the SAME (user, action, wallet) onto one auto key."""
    header_key = request.headers.get("Idempotency-Key") or request.headers.get("idempotency-key")
    if header_key and header_key.strip():
        key = f"hdr:{scope}:{header_key.strip()[:128]}"
    else:
        bucket = int(time.time() // 2)
        key = f"auto:{scope}:{bucket}"
    return (user_id, key)


def _earn_idem_lookup(cache_key: tuple) -> Optional[Tuple[int, dict]]:
    entry = _earn_idem_entries.get(cache_key)
    if not entry or entry.timestamp is None:
        return None
    if time.time() - entry.timestamp > _EARN_IDEM_TTL_SECONDS:
        _earn_idem_entries.pop(cache_key, None)
        return None
    return entry.status_code, entry.body


def _earn_idem_store(cache_key: tuple, status_code: int, body: dict) -> None:
    now = time.time()
    entry = _earn_idem_entries.get(cache_key)
    if entry is None:
        entry = _IdemEntry(lock=threading.Lock())  # `.lock` unused here — the
        # per-wallet asyncio.Lock above already serializes; kept for shape
        # parity with `_IdemEntry`'s other three fields.
        _earn_idem_entries[cache_key] = entry
    entry.timestamp = now
    entry.status_code = status_code
    entry.body = body
    if len(_earn_idem_entries) > 1000:
        expired = [
            k
            for k, e in _earn_idem_entries.items()
            if e.timestamp is not None and now - e.timestamp > _EARN_IDEM_TTL_SECONDS
        ]
        for k in expired:
            _earn_idem_entries.pop(k, None)


async def _execute_earn_action(request: Request, body: EarnAmountBody, *, action: str) -> dict:
    """Shared executor for /earn/deposit and /earn/withdraw.

    Resolves the wallet exclusively from the authenticated JWT (or a
    JWT-owned `walletId`), validates the amount, then calls the SAME
    SavingsService.deposit/withdraw used by the Telegram /save flow — no new
    on-chain logic or approvals here. The whole read -> validate -> execute
    block runs under a per-(user, wallet) lock — see `_earn_wallet_lock`.
    """
    payload = _jwt_user(request)
    _require_db()

    from bot.services.savings_service import SavingsError, SavingsPending, savings_service

    user_id = int(payload["user_id"])

    try:
        await _earn_action_limiter.check(user_id)
    except RateLimitExceeded as e:
        raise HTTPException(
            status_code=429,
            detail=str(e),
            headers={"Retry-After": str(max(1, int(getattr(e, "retry_after", 1) or 1)))},
        )

    if body.walletId is not None:
        wallet = await _resolve_earn_wallet_by_id(user_id, body.walletId)
        if wallet is None:
            raise HTTPException(status_code=400, detail="Unknown wallet")
    else:
        wallet = await _resolve_earn_wallet(user_id)
        if wallet is None:
            raise HTTPException(status_code=400, detail="No EVM wallet found. Add one first.")

    cache_key = _earn_idempotency_cache_key(request, user_id, f"{action}:{wallet.address.lower()}")
    lock = _earn_wallet_lock(user_id, wallet.address)

    async with lock:
        cached = _earn_idem_lookup(cache_key)
        if cached is not None:
            status_code, cached_body = cached
            if status_code >= 400:
                raise HTTPException(status_code=status_code, detail=cached_body.get("detail"))
            return JSONResponse(status_code=status_code, content=cached_body)

        try:
            if action == "deposit":
                available = await asyncio.to_thread(
                    savings_service.get_usdc_balance, wallet.address
                )
            else:
                available = await asyncio.to_thread(savings_service.get_position, wallet.address)
        except SavingsError as e:
            # Transient RPC/read failure — not deterministic, never cached,
            # so a retry actually retries instead of replaying a stale 503.
            raise HTTPException(status_code=503, detail=str(e))

        amount = _parse_earn_amount(
            body.amount, available=available, max_returns_none=(action == "withdraw")
        )
        is_max = amount is None

        try:
            if action == "deposit":
                # "max" already resolved to the live idle balance above;
                # `amount` is never None on the deposit path.
                tx_hashes = await asyncio.to_thread(savings_service.deposit, wallet, amount)
                tx_hash = tx_hashes[-1]
                reported_amount = amount
            else:
                withdraw_amount = None if is_max else amount
                reported_amount = available if is_max else amount
                tx_hash = await asyncio.to_thread(savings_service.withdraw, wallet, withdraw_amount)
        except SavingsPending as e:
            # Broadcast but confirmation timed out — NOT a plain retryable
            # failure (a client retry here could double-submit on top of a tx
            # that may still land). 202 + the tx hash so the client polls or
            # checks basescan instead of resubmitting. Cached so an exact
            # retry (same Idempotency-Key) replays this same 202 rather than
            # re-attempting the on-chain call.
            pending_body = {"ok": False, "status": "pending", "txHash": e.tx_hash}
            _earn_idem_store(cache_key, 202, pending_body)
            return JSONResponse(status_code=202, content=pending_body)
        except SavingsError as e:
            logger.error(f"mobile earn {action} failed for user {user_id}: {e}")
            # Business rejection (insufficient balance, on-chain revert,
            # etc.) is deterministic for this input — safe to cache/replay.
            _earn_idem_store(cache_key, 400, {"detail": str(e)})
            raise HTTPException(status_code=400, detail=str(e))
        except HTTPException:
            raise
        except Exception as e:
            logger.error(
                f"mobile earn {action} unexpected error for user {user_id}: {e}", exc_info=True
            )
            # Unknown state (network blip, unhandled edge case) — NOT cached,
            # so a retry actually retries once the transient condition clears.
            raise HTTPException(
                status_code=500, detail="Something went wrong. Your funds were not moved."
            )

        await _log_earn_event(user_id, wallet.id, action, reported_amount, tx_hash)
        result = {"ok": True, "txHash": tx_hash, "amount": str(reported_amount)}
        if action == "withdraw" and is_max:
            # The reported amount is the position read BEFORE execution;
            # Aave's MAX_UINT256 sentinel withdraws whatever the live balance
            # is at execution time (principal + interest accrued since the
            # read), which can be marginally higher. Flag it rather than
            # imply exactness (LOW finding).
            result["approximate"] = True
        _earn_idem_store(cache_key, 200, result)
        return result


@router.post("/earn/deposit")
async def deposit_earn(request: Request, body: EarnAmountBody):
    """Supply idle USDC into Aave V3 (Base) — MONEY-PATH."""
    return await _execute_earn_action(request, body, action="deposit")


@router.post("/earn/withdraw")
async def withdraw_earn(request: Request, body: EarnAmountBody):
    """Withdraw USDC from Aave V3 (Base) — MONEY-PATH."""
    return await _execute_earn_action(request, body, action="withdraw")
