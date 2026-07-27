"""Real-time HyperLiquid WebSocket alert feed -> Telegram.

Unlike :mod:`bot.services.hl_ecosystem_monitor` (a 120s poll loop), this service
holds a persistent WebSocket to ``wss://api.hyperliquid.xyz/ws`` (no auth for
public feeds) and pushes alerts the instant HyperLiquid emits them:

* ``userFills``  — per-tracked-address trade fills.
* ``userEvents`` — per-tracked-address liquidations + funding payments.
* ``trades``     — per-coin tape; emits a "whale" alert when a single trade's
  notional exceeds ``settings.hl_whale_alert_threshold_usd``.

It mirrors the :class:`HLEcosystemMonitor` lifecycle: a ``start(bot=...)`` /
``stop()`` pair, a ``service:hl_ws_alerts:heartbeat`` Redis key, and the same
``_notify_user`` Telegram-delivery helper. Everything is gated behind feature
flags that default OFF, so wiring it into the lifespan is a no-op until enabled.

The WebSocket subscription/parsing layer is intentionally separated from the
network layer (``_run`` owns the socket; ``_handle_message`` / ``_format_*`` are
pure-ish and unit-testable with mocked frames).
"""

import asyncio
import json
import logging
import time
from typing import Dict, List, Optional

from bot.config.settings import settings
from bot.models.perps import HyperLiquidAccount
from database.db import get_session

logger = logging.getLogger(__name__)

WS_URL = "wss://api.hyperliquid.xyz/ws"

# Reconnect backoff (seconds): exponential, capped.
_BACKOFF_BASE = 2.0
_BACKOFF_MAX = 60.0

# How often we re-resolve the tracked-user set and (re)subscribe.
_REFRESH_INTERVAL = 300  # 5 minutes

_HEARTBEAT_KEY = "service:hl_ws_alerts:heartbeat"
_HEARTBEAT_TTL = 300


class HLWebSocketAlerts:
    """Persistent HyperLiquid WS feed that pushes real-time alerts to Telegram."""

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._bot = None
        # Lower-cased hl_address -> user_id, for routing per-user events.
        self._addr_to_user: Dict[str, int] = {}

    async def start(self, bot=None):
        if self._running:
            return
        # No-op unless at least one feature is enabled.
        if not (
            getattr(settings, "hl_ws_alerts_enabled", False)
            or getattr(settings, "hl_whale_alerts_enabled", False)
        ):
            logger.info("HL WS alerts disabled (feature flags off); not starting")
            return
        self._bot = bot
        self._running = True
        self._task = asyncio.create_task(self._run())
        logger.info("HyperLiquid WS alerts started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("HyperLiquid WS alerts stopped")

    # ------------------------------------------------------------------ #
    # User discovery
    # ------------------------------------------------------------------ #
    def _load_tracked_users(self) -> Dict[str, int]:
        """Map lower-cased hl_address -> user_id for all active HL accounts.

        Mirrors HLEcosystemMonitor's ``HyperLiquidAccount(is_active=True)``
        discovery; an address is only tracked if it's non-empty.
        """
        mapping: Dict[str, int] = {}
        try:
            with get_session() as session:
                rows = (
                    session.query(HyperLiquidAccount.user_id, HyperLiquidAccount.hl_address)
                    .filter(HyperLiquidAccount.is_active.is_(True))
                    .filter(HyperLiquidAccount.hl_address.isnot(None))
                    .all()
                )
            for user_id, addr in rows:
                if addr:
                    mapping[addr.strip().lower()] = user_id
        except Exception as e:
            logger.error(f"HL WS alerts: failed to load tracked users: {e}")
        return mapping

    def _whale_coins(self) -> List[str]:
        raw = getattr(settings, "hl_whale_alert_coins", "") or ""
        return [c.strip().upper() for c in raw.split(",") if c.strip()]

    def _subscriptions(self) -> List[dict]:
        """Build the subscription payloads for the current tracked set + flags."""
        subs: List[dict] = []
        if getattr(settings, "hl_ws_alerts_enabled", False):
            for addr in self._addr_to_user:
                subs.append({"type": "userFills", "user": addr})
                subs.append({"type": "userEvents", "user": addr})
        if getattr(settings, "hl_whale_alerts_enabled", False):
            for coin in self._whale_coins():
                subs.append({"type": "trades", "coin": coin})
        return subs

    # ------------------------------------------------------------------ #
    # Network loop
    # ------------------------------------------------------------------ #
    async def _run(self):
        import websockets

        attempt = 0
        while self._running:
            try:
                self._addr_to_user = self._load_tracked_users()
                subs = self._subscriptions()
                if not subs:
                    # Nothing to watch yet (no HL users + whales off). Heartbeat
                    # and idle; re-check on the refresh cadence.
                    await self._heartbeat()
                    await asyncio.sleep(_REFRESH_INTERVAL)
                    continue

                async with websockets.connect(
                    WS_URL, ping_interval=20, ping_timeout=20, close_timeout=5
                ) as ws:
                    attempt = 0  # successful connect resets backoff
                    for sub in subs:
                        await ws.send(json.dumps({"method": "subscribe", "subscription": sub}))
                    logger.info("HL WS alerts: subscribed to %d feeds", len(subs))
                    await self._heartbeat()
                    last_refresh = time.time()

                    while self._running:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=30)
                        except asyncio.TimeoutError:
                            # No frame for 30s: heartbeat, maybe refresh subs.
                            await self._heartbeat()
                            if time.time() - last_refresh > _REFRESH_INTERVAL:
                                break  # reconnect to re-resolve subscriptions
                            continue
                        await self._heartbeat()
                        await self._handle_message(raw)
                        if time.time() - last_refresh > _REFRESH_INTERVAL:
                            break
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"HL WS alerts connection error: {e}")
            if not self._running:
                break
            attempt += 1
            delay = min(_BACKOFF_BASE * (2 ** (attempt - 1)), _BACKOFF_MAX)
            await asyncio.sleep(delay)

    async def _heartbeat(self):
        try:
            from bot.utils.redis_cache import redis_cache

            await redis_cache.set(_HEARTBEAT_KEY, time.time(), ttl_seconds=_HEARTBEAT_TTL)
        except Exception as e:
            logger.debug("HL WS alerts heartbeat failed: %s", e)

    # ------------------------------------------------------------------ #
    # Message handling (unit-testable; no socket required)
    # ------------------------------------------------------------------ #
    async def _handle_message(self, raw):
        """Parse a single WS frame and dispatch any alerts it implies."""
        try:
            msg = json.loads(raw) if isinstance(raw, (str, bytes, bytearray)) else raw
        except (json.JSONDecodeError, TypeError):
            logger.debug("HL WS alerts: unparseable frame")
            return
        if not isinstance(msg, dict):
            return

        channel = msg.get("channel")
        data = msg.get("data")

        if channel == "subscriptionResponse" or channel == "pong":
            return
        if channel == "userFills":
            await self._on_user_fills(data)
        elif channel == "userEvents":
            await self._on_user_events(data)
        elif channel == "trades":
            await self._on_trades(data)

    def _user_for(self, data: dict) -> Optional[int]:
        """Resolve the tracked user_id from a per-address payload's ``user`` field."""
        if not isinstance(data, dict):
            return None
        addr = (data.get("user") or "").strip().lower()
        return self._addr_to_user.get(addr) if addr else None

    async def _on_user_fills(self, data):
        if not getattr(settings, "hl_ws_alerts_enabled", False):
            return
        user_id = self._user_for(data)
        if user_id is None:
            return
        # HyperLiquid replays a snapshot on subscribe; skip it.
        if isinstance(data, dict) and data.get("isSnapshot"):
            return
        fills = (data or {}).get("fills") or []
        for fill in fills:
            text = self._format_fill(fill)
            if text:
                await self._notify_user(user_id, text)

    async def _on_user_events(self, data):
        if not getattr(settings, "hl_ws_alerts_enabled", False):
            return
        user_id = self._user_for(data)
        if user_id is None:
            return
        if not isinstance(data, dict):
            return
        for liq in (
            data.get("liquidation", [])
            if isinstance(data.get("liquidation"), list)
            else ([data["liquidation"]] if data.get("liquidation") else [])
        ):
            text = self._format_liquidation(liq)
            if text:
                await self._notify_user(user_id, text)
        fundings = data.get("funding")
        if isinstance(fundings, dict):
            fundings = [fundings]
        for fnd in fundings or []:
            text = self._format_funding(fnd)
            if text:
                await self._notify_user(user_id, text)

    async def _on_trades(self, data):
        if not getattr(settings, "hl_whale_alerts_enabled", False):
            return
        threshold = float(getattr(settings, "hl_whale_alert_threshold_usd", 1_000_000.0) or 0)
        if threshold <= 0:
            return
        trades = data if isinstance(data, list) else [data]
        for trade in trades:
            text = self._format_whale(trade, threshold)
            if text:
                await self._notify_channel(text)

    # ------------------------------------------------------------------ #
    # Formatters (pure functions of the payload)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _safe_float(v) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    @classmethod
    def _format_fill(cls, fill: dict) -> Optional[str]:
        if not isinstance(fill, dict):
            return None
        coin = fill.get("coin", "?")
        side = "BUY" if (fill.get("side") == "B") else "SELL"
        sz = cls._safe_float(fill.get("sz"))
        px = cls._safe_float(fill.get("px"))
        if sz <= 0 or px <= 0:
            return None
        notional = sz * px
        emoji = "\U0001f7e2" if side == "BUY" else "\U0001f534"
        pnl = cls._safe_float(fill.get("closedPnl"))
        pnl_str = ""
        if pnl:
            pnl_str = f"\nPnL: ${pnl:,.2f}"
        return (
            f"{emoji} *Fill* — {side} {sz:g} {coin} @ ${px:,.4f}\n"
            f"Notional: ${notional:,.2f}{pnl_str}"
        )

    @classmethod
    def _format_liquidation(cls, liq: dict) -> Optional[str]:
        if not isinstance(liq, dict):
            return None
        coin = liq.get("coin") or liq.get("liquidatedCoin") or "?"
        sz = cls._safe_float(liq.get("sz") or liq.get("liquidatedNtlPos"))
        return (
            f"⚠️ *LIQUIDATION* — your {coin} position was liquidated"
            + (f" ({sz:g})" if sz else "")
            + ".\nCheck `/perps` for your remaining margin."
        )

    @classmethod
    def _format_funding(cls, fnd: dict) -> Optional[str]:
        if not isinstance(fnd, dict):
            return None
        coin = fnd.get("coin", "?")
        usdc = cls._safe_float(fnd.get("usdc"))
        if usdc == 0:
            return None
        direction = "received" if usdc > 0 else "paid"
        emoji = "\U0001f4b0" if usdc > 0 else "\U0001f4b8"
        return f"{emoji} *Funding* — {coin}: {direction} ${abs(usdc):,.4f}."

    @classmethod
    def _format_whale(cls, trade: dict, threshold: float) -> Optional[str]:
        if not isinstance(trade, dict):
            return None
        coin = trade.get("coin", "?")
        sz = cls._safe_float(trade.get("sz"))
        px = cls._safe_float(trade.get("px"))
        if sz <= 0 or px <= 0:
            return None
        notional = sz * px
        if notional < threshold:
            return None
        side = trade.get("side")
        side_str = "BUY" if side == "B" else ("SELL" if side == "A" else "")
        emoji = "\U0001f40b"
        return (
            f"{emoji} *Whale trade* — {side_str} {sz:g} {coin} @ ${px:,.2f}\n"
            f"Notional: ${notional:,.0f}"
        ).strip()

    # ------------------------------------------------------------------ #
    # Delivery
    # ------------------------------------------------------------------ #
    async def _notify_user(self, user_id: int, message: str):
        if not self._bot:
            return
        try:
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).get(user_id)
                telegram_id = user.telegram_id if user else None
            if telegram_id:
                await self._bot.send_message(
                    chat_id=telegram_id, text=message, parse_mode="Markdown"
                )
        except Exception as e:
            logger.error(f"HL WS alerts: failed to notify user {user_id}: {e}")

    async def _notify_channel(self, message: str):
        """Whale alerts go to every active HL user (broadcast-style market signal)."""
        if not self._bot:
            return
        for user_id in set(self._addr_to_user.values()):
            await self._notify_user(user_id, message)


# Global instance (mirrors hl_ecosystem_monitor).
hl_ws_alerts = HLWebSocketAlerts()
