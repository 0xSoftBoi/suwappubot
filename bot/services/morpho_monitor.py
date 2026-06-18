"""Health monitor for Morpho Blue borrow positions (cbBTC/USDC on Base).

Every 120s, polls each open row in morpho_positions (on-chain position + market
+ oracle price, batched as gathered to_thread calls with a small concurrency
cap), persists last_hf, and sends tiered Telegram alerts:

  HF < URGENT_HF (1.05) → urgent alert (re-armed only after recovery)
  HF < WARN_HF   (1.2)  → warning alert
  HF ≥ WARN_HF + hysteresis → tier reset (+ a "recovered" note if previously urgent)

Started from api/main.py lifespan, guarded by settings.morpho_enabled. Pattern
mirrors bot/services/btc_bridge_poller.py (per-position error isolation).
"""

import asyncio
import logging
import math
from typing import Optional

from bot.config.morpho_config import URGENT_HF, WARN_HF

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 120.0
MAX_CONCURRENT_READS = 5
# HF must climb back above WARN_HF + this margin before alerts re-arm
HYSTERESIS = 0.05
# Never auto-close a row younger than this: the open txs may still be landing
# on-chain, so an empty position read is expected, not "closed" (race guard).
MIN_AGE_BEFORE_AUTOCLOSE_SECONDS = 300
# Tier decisions that clear notified_tier (shared by _decide_tier/_save_hf)
_TIER_RESET = ("alert:recovered", "reset")


class MorphoMonitor:
    """Async loop alerting borrowers before liquidation."""

    def __init__(self, interval: float = POLL_INTERVAL_SECONDS):
        self.interval = interval
        self.running = False
        self.bot = None
        self._task: Optional[asyncio.Task] = None

    async def start(self, bot=None):
        if self.running:
            return
        self.bot = bot
        self.running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("✓ Morpho health monitor started (interval=%ss)", self.interval)

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Morpho health monitor stopped")

    async def _loop(self):
        while self.running:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # pragma: no cover - defensive outer guard
                logger.error("Morpho monitor cycle error: %s", str(e)[:300])
            await asyncio.sleep(self.interval)

    async def poll_once(self) -> int:
        """Poll every open position once. Returns number of positions polled."""
        rows = self._open_positions()
        if not rows:
            return 0
        sem = asyncio.Semaphore(MAX_CONCURRENT_READS)

        async def _check(row):
            async with sem:
                try:
                    await self._check_position(*row)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning(
                        "Morpho monitor: position %s check failed: %s", row[0], str(e)[:200]
                    )

        await asyncio.gather(*[_check(r) for r in rows])
        return len(rows)

    async def _check_position(
        self, position_id: int, telegram_id, wallet_address: Optional[str], opened_at=None
    ) -> None:
        if not wallet_address:
            return
        from bot.services.morpho_api import morpho_api

        pos = await asyncio.to_thread(morpho_api.get_position, wallet_address)
        hf = pos["health_factor"]

        if pos["debt_usdc_raw"] <= 0 and pos["collateral_raw"] <= 0:
            # Race guard: a just-opened row can read as empty while its open
            # txs are still confirming — only auto-close mature rows.
            if self._age_seconds(opened_at) >= MIN_AGE_BEFORE_AUTOCLOSE_SECONDS:
                self._mark_closed(position_id)
            return

        new_tier = self._decide_tier(position_id, hf)
        self._save_hf(position_id, hf, new_tier)
        if new_tier and new_tier.startswith("alert:"):
            await self._notify(telegram_id, new_tier.split(":", 1)[1], pos)

    def _decide_tier(self, position_id: int, hf: float) -> Optional[str]:
        """Returns 'alert:warn'/'alert:urgent'/'alert:recovered' when a message
        should be sent, the bare tier to persist otherwise, or None for no change."""
        prev = self._get_tier(position_id)
        if hf < URGENT_HF:
            return "alert:urgent" if prev != "urgent" else None
        if hf < WARN_HF:
            return "alert:warn" if prev not in ("warn", "urgent") else None
        if prev and hf >= WARN_HF + HYSTERESIS:
            return _TIER_RESET[0] if prev == "urgent" else _TIER_RESET[1]
        return None

    async def _notify(self, telegram_id, tier: str, pos: dict) -> None:
        if self.bot is None or telegram_id is None:
            return
        hf = pos["health_factor"]
        hf_text = "∞" if math.isinf(hf) else f"{hf:.2f}"
        liq = pos["liquidation_price"]
        price = pos["btc_price_usd"]
        if tier == "urgent":
            text = (
                f"🚨 URGENT: your Morpho BTC loan health factor is {hf_text} — "
                f"liquidation at ${liq:,.0f}/BTC (now ${price:,.0f}). "
                f"Repay USDC or add cbBTC collateral NOW via /borrow."
            )
        elif tier == "warn":
            text = (
                f"⚠️ Your Morpho BTC loan health factor dropped to {hf_text} "
                f"(liquidation at ${liq:,.0f}/BTC, now ${price:,.0f}). "
                f"Consider repaying or adding collateral via /borrow."
            )
        else:  # recovered
            text = f"✅ Your Morpho BTC loan recovered — health factor is back to {hf_text}."
        try:
            await self.bot.send_message(chat_id=telegram_id, text=text)
        except Exception as e:
            logger.warning("Morpho monitor: notify failed for %s: %s", telegram_id, str(e)[:200])

    # ── DB helpers ────────────────────────────────────────────────────────────

    @staticmethod
    def _age_seconds(opened_at) -> float:
        """Seconds since opened_at; +inf when unknown (old rows behave as before)."""
        from datetime import datetime, timezone

        if opened_at is None:
            return math.inf
        if opened_at.tzinfo is None:
            opened_at = opened_at.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - opened_at).total_seconds()

    @staticmethod
    def _open_positions() -> list:
        """[(position_id, telegram_id, wallet_address, opened_at), ...] for open positions."""
        from bot.models.morpho import MorphoPosition
        from bot.models.user import User
        from bot.models.wallet import Wallet
        from database.db import get_session

        with get_session() as session:
            rows = (
                session.query(
                    MorphoPosition.id, User.telegram_id, Wallet.address, MorphoPosition.opened_at
                )
                .join(User, User.id == MorphoPosition.user_id)
                .outerjoin(Wallet, Wallet.id == MorphoPosition.wallet_id)
                .filter(MorphoPosition.closed_at.is_(None))
                .order_by(MorphoPosition.id)
                .all()
            )
        return [tuple(r) for r in rows]

    @staticmethod
    def _get_tier(position_id: int) -> Optional[str]:
        from bot.models.morpho import MorphoPosition
        from database.db import get_session

        with get_session() as session:
            row = (
                session.query(MorphoPosition.notified_tier)
                .filter(MorphoPosition.id == position_id)
                .first()
            )
        return row[0] if row else None

    @staticmethod
    def _save_hf(position_id: int, hf: float, decision: Optional[str]) -> None:
        from decimal import Decimal

        from bot.models.morpho import MorphoPosition
        from database.db import get_session

        with get_session() as session:
            row = session.query(MorphoPosition).filter(MorphoPosition.id == position_id).first()
            if row is None:
                return
            row.last_hf = None if math.isinf(hf) else Decimal(str(round(hf, 6)))
            if decision in _TIER_RESET:
                row.notified_tier = None
            elif decision == "alert:urgent":
                row.notified_tier = "urgent"
            elif decision == "alert:warn":
                row.notified_tier = "warn"
            session.commit()

    @staticmethod
    def _mark_closed(position_id: int) -> None:
        from datetime import datetime, timezone

        from bot.models.morpho import MorphoPosition
        from database.db import get_session

        with get_session() as session:
            row = session.query(MorphoPosition).filter(MorphoPosition.id == position_id).first()
            if row is not None and row.closed_at is None:
                row.closed_at = datetime.now(timezone.utc)
                session.commit()


morpho_monitor = MorphoMonitor()
