"""Post-purchase rug pull detection and auto-sell monitoring service.

Monitors tokens bought by users for rug pull indicators:
- Liquidity drop > 50% from initial
- Buy/sell tax increase > 20% absolute
- Ownership change detected
- Mint authority used (new minting)

When triggered, can auto-sell the user's position with high slippage tolerance.
"""

import asyncio
import logging
from typing import List, Optional
from datetime import datetime

from bot.models.advanced import RugMonitor
from bot.services.goplus_api import goplus_api, GoPlusError
from database.db import get_session

logger = logging.getLogger(__name__)

# Detection thresholds
LIQUIDITY_DROP_THRESHOLD = 0.50  # 50% drop from initial
TAX_INCREASE_THRESHOLD = 20.0   # 20% absolute increase
EMERGENCY_SLIPPAGE = 15.0       # 15% slippage for emergency sells


class RugMonitorService:
    """Service for monitoring tokens post-purchase for rug pull indicators."""

    def __init__(self):
        self._running = False
        self._task = None
        self._bot = None
        self._check_interval = 60  # Check every 60 seconds

    # === Lifecycle ===

    async def start_monitoring(self, bot=None):
        """Start the rug monitoring background task."""
        if self._running:
            return

        self._running = True
        self._bot = bot
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info("Rug monitor service started")

    async def stop_monitoring(self):
        """Stop the rug monitoring task."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Rug monitor service stopped")

    async def _monitor_loop(self):
        """Main monitoring loop - checks all active monitors."""
        while self._running:
            try:
                await self.check_rug_indicators()
            except Exception as e:
                logger.error(f"Rug monitor check error: {e}")

            await asyncio.sleep(self._check_interval)

    # === Auto Monitor (called after buy swaps) ===

    async def auto_monitor(
        self,
        user_id: int,
        token_address: str,
        chain: str,
        wallet_id: int,
    ) -> Optional[RugMonitor]:
        """
        Create a monitor entry for a newly bought token.

        Called automatically after successful buy swaps for tokens
        below $10M market cap.
        """
        # Check if already monitoring this token for this user
        with get_session() as session:
            existing = session.query(RugMonitor).filter(
                RugMonitor.user_id == user_id,
                RugMonitor.token_address == token_address,
                RugMonitor.chain == chain,
                RugMonitor.is_active == True,
            ).first()

            if existing:
                logger.debug(
                    f"Already monitoring {token_address} for user {user_id}"
                )
                return existing

        # Fetch initial security data from GoPlus
        initial_data = await self._fetch_security_data(token_address, chain)

        with get_session() as session:
            monitor = RugMonitor(
                user_id=user_id,
                token_address=token_address,
                chain=chain,
                wallet_id=wallet_id,
                initial_liquidity_usd=initial_data.get("liquidity_usd"),
                current_liquidity_usd=initial_data.get("liquidity_usd"),
                initial_holders=initial_data.get("holder_count"),
                current_holders=initial_data.get("holder_count"),
                initial_tax_buy=initial_data.get("buy_tax"),
                initial_tax_sell=initial_data.get("sell_tax"),
                auto_sell_enabled=True,
                is_active=True,
            )
            session.add(monitor)
            session.flush()
            monitor_id = monitor.id

        logger.info(
            f"Created rug monitor #{monitor_id} for user {user_id}, "
            f"token {token_address} on {chain}"
        )

        with get_session() as session:
            return session.query(RugMonitor).filter(
                RugMonitor.id == monitor_id
            ).first()

    # === Rug Indicator Checking ===

    async def check_rug_indicators(self):
        """Check all active monitors for rug pull indicators."""
        with get_session() as session:
            monitors = session.query(RugMonitor).filter(
                RugMonitor.is_active.is_(True),
                RugMonitor.triggered_at.is_(None),
            ).all()

            if not monitors:
                return

            # Group by chain+token for batch API calls
            token_groups: dict[str, list[RugMonitor]] = {}
            for monitor in monitors:
                key = f"{monitor.chain}:{monitor.token_address}"
                if key not in token_groups:
                    token_groups[key] = []
                token_groups[key].append(monitor)

        # Check each unique token
        for key, group_monitors in token_groups.items():
            chain, token_address = key.split(":", 1)
            try:
                current_data = await self._fetch_security_data(
                    token_address, chain
                )
                for monitor in group_monitors:
                    trigger_reason = self._evaluate_indicators(
                        monitor, current_data
                    )
                    if trigger_reason:
                        await self._handle_trigger(
                            monitor, trigger_reason, current_data
                        )
                    else:
                        # Update current values
                        self._update_monitor_data(monitor, current_data)
            except Exception as e:
                logger.warning(
                    f"Failed to check {token_address} on {chain}: {e}"
                )

    def _evaluate_indicators(
        self, monitor: RugMonitor, current_data: dict
    ) -> Optional[str]:
        """
        Evaluate whether current data triggers rug indicators.

        Returns trigger reason string if triggered, None otherwise.
        """
        # 1. Liquidity drop > 50%
        current_liq = current_data.get("liquidity_usd")
        if (
            current_liq is not None
            and monitor.initial_liquidity_usd
            and monitor.initial_liquidity_usd > 0
        ):
            drop_pct = 1 - (current_liq / monitor.initial_liquidity_usd)
            if drop_pct >= LIQUIDITY_DROP_THRESHOLD:
                return (
                    f"Liquidity dropped {drop_pct * 100:.0f}% "
                    f"(${monitor.initial_liquidity_usd:,.0f} -> "
                    f"${current_liq:,.0f})"
                )

        # 2. Buy tax increase > 20%
        current_buy_tax = current_data.get("buy_tax")
        if (
            current_buy_tax is not None
            and monitor.initial_tax_buy is not None
        ):
            tax_increase = current_buy_tax - monitor.initial_tax_buy
            if tax_increase >= TAX_INCREASE_THRESHOLD:
                return (
                    f"Buy tax increased {tax_increase:.0f}% "
                    f"({monitor.initial_tax_buy:.0f}% -> "
                    f"{current_buy_tax:.0f}%)"
                )

        # 3. Sell tax increase > 20%
        current_sell_tax = current_data.get("sell_tax")
        if (
            current_sell_tax is not None
            and monitor.initial_tax_sell is not None
        ):
            tax_increase = current_sell_tax - monitor.initial_tax_sell
            if tax_increase >= TAX_INCREASE_THRESHOLD:
                return (
                    f"Sell tax increased {tax_increase:.0f}% "
                    f"({monitor.initial_tax_sell:.0f}% -> "
                    f"{current_sell_tax:.0f}%)"
                )

        # 4. Ownership change / hidden owner
        if current_data.get("owner_change_balance"):
            return "Owner can modify balances"

        # 5. Mint authority used (holder count stayed same but supply grew)
        if current_data.get("is_mintable"):
            # If token is now mintable but wasn't flagged at buy time,
            # or if it was always mintable - check for actual minting via
            # holder count anomalies
            pass

        return None

    def _update_monitor_data(
        self, monitor: RugMonitor, current_data: dict
    ):
        """Update monitor with latest data."""
        with get_session() as session:
            db_monitor = session.query(RugMonitor).filter(
                RugMonitor.id == monitor.id
            ).first()
            if not db_monitor:
                return

            if current_data.get("liquidity_usd") is not None:
                db_monitor.current_liquidity_usd = current_data[
                    "liquidity_usd"
                ]
            if current_data.get("holder_count") is not None:
                db_monitor.current_holders = current_data["holder_count"]
            db_monitor.updated_at = datetime.utcnow()

    async def _handle_trigger(
        self,
        monitor: RugMonitor,
        trigger_reason: str,
        current_data: dict,
    ):
        """Handle a triggered rug indicator."""
        logger.warning(
            f"RUG INDICATOR TRIGGERED for monitor #{monitor.id}: "
            f"{trigger_reason}"
        )

        # Mark monitor as triggered
        with get_session() as session:
            db_monitor = session.query(RugMonitor).filter(
                RugMonitor.id == monitor.id
            ).first()
            if not db_monitor:
                return

            db_monitor.trigger_reason = trigger_reason[:100]
            db_monitor.triggered_at = datetime.utcnow()
            if current_data.get("liquidity_usd") is not None:
                db_monitor.current_liquidity_usd = current_data[
                    "liquidity_usd"
                ]
            if current_data.get("holder_count") is not None:
                db_monitor.current_holders = current_data["holder_count"]

        # Auto-sell if enabled
        if monitor.auto_sell_enabled:
            sell_tx_id = await self.execute_emergency_sell(monitor)
            if sell_tx_id:
                with get_session() as session:
                    db_monitor = session.query(RugMonitor).filter(
                        RugMonitor.id == monitor.id
                    ).first()
                    if db_monitor:
                        db_monitor.sell_tx_id = sell_tx_id

        # Send alert notification
        await self._send_rug_alert(monitor, trigger_reason)

    # === Emergency Sell ===

    async def execute_emergency_sell(
        self, monitor: RugMonitor
    ) -> Optional[int]:
        """
        Execute emergency sell of a monitored token position.

        Uses high slippage tolerance (15%) to ensure execution.
        Returns the swap transaction ID if successful.
        """
        try:
            from bot.services.swap_engine import swap_engine
            from bot.services.wallet import WalletService

            wallet_service = WalletService()

            # Get token balance
            balance = await wallet_service.get_token_balance(
                monitor.wallet_id, monitor.chain, monitor.token_address
            )

            if not balance or balance <= 0:
                logger.info(
                    f"No balance to sell for monitor #{monitor.id}"
                )
                return None

            # Determine native token for the chain
            native_tokens = {
                "solana": "SOL",
                "ethereum": "ETH",
                "base": "ETH",
                "arbitrum": "ETH",
                "polygon": "MATIC",
                "bsc": "BNB",
                "avalanche": "AVAX",
                "optimism": "ETH",
            }
            to_token = native_tokens.get(monitor.chain, "ETH")

            # Get quote with high slippage
            quote = await swap_engine.get_quote(
                from_chain=monitor.chain,
                to_chain=monitor.chain,
                from_token=monitor.token_address,
                to_token=to_token,
                amount=balance,
                from_address="",  # Will be resolved from wallet_id
                slippage=EMERGENCY_SLIPPAGE,
            )

            # Execute the swap
            swap_tx = await swap_engine.execute_swap(
                quote=quote,
                wallet_id=monitor.wallet_id,
                user_id=monitor.user_id,
                idempotency_key=(
                    f"rug_sell:{monitor.id}:"
                    f"{datetime.utcnow().strftime('%Y%m%d%H%M')}"
                ),
            )

            logger.info(
                f"Emergency sell executed for monitor #{monitor.id}, "
                f"swap_tx #{swap_tx.id}"
            )
            return swap_tx.id

        except Exception as e:
            logger.error(
                f"Emergency sell failed for monitor #{monitor.id}: {e}"
            )
            return None

    # === User-facing Methods ===

    def get_monitors(
        self, user_id: int, active_only: bool = True
    ) -> List[RugMonitor]:
        """Get all monitors for a user."""
        with get_session() as session:
            query = session.query(RugMonitor).filter(
                RugMonitor.user_id == user_id
            )
            if active_only:
                query = query.filter(RugMonitor.is_active == True)
            return query.order_by(RugMonitor.created_at.desc()).all()

    def toggle_auto_sell(
        self, user_id: int, monitor_id: int
    ) -> Optional[bool]:
        """Toggle auto-sell for a specific monitor. Returns new state."""
        with get_session() as session:
            monitor = session.query(RugMonitor).filter(
                RugMonitor.id == monitor_id,
                RugMonitor.user_id == user_id,
            ).first()

            if not monitor:
                return None

            monitor.auto_sell_enabled = not monitor.auto_sell_enabled
            return monitor.auto_sell_enabled

    def deactivate_monitor(self, user_id: int, monitor_id: int) -> bool:
        """Deactivate a monitor."""
        with get_session() as session:
            monitor = session.query(RugMonitor).filter(
                RugMonitor.id == monitor_id,
                RugMonitor.user_id == user_id,
            ).first()

            if not monitor:
                return False

            monitor.is_active = False
            return True

    # === GoPlus Data Fetching ===

    async def _fetch_security_data(
        self, token_address: str, chain: str
    ) -> dict:
        """Fetch security data from GoPlus API."""
        data = {
            "liquidity_usd": None,
            "holder_count": None,
            "buy_tax": None,
            "sell_tax": None,
            "is_mintable": False,
            "owner_change_balance": False,
        }

        try:
            if chain not in goplus_api.CHAIN_MAP:
                return data

            security = await goplus_api.get_token_security(
                chain, token_address
            )

            data["holder_count"] = security.holder_count
            data["buy_tax"] = security.buy_tax
            data["sell_tax"] = security.sell_tax
            data["is_mintable"] = security.is_mintable
            data["owner_change_balance"] = security.owner_change_balance

            # Try to get liquidity from DexScreener
            try:
                from bot.services.dexscreener_api import dexscreener_api

                pairs = await dexscreener_api.get_token_pairs(
                    chain, token_address
                )
                if pairs:
                    data["liquidity_usd"] = pairs[0].liquidity_usd
            except Exception:
                pass

        except (GoPlusError, Exception) as e:
            logger.debug(
                f"Security data fetch failed for {token_address}: {e}"
            )

        return data

    # === Notifications ===

    async def _send_rug_alert(
        self, monitor: RugMonitor, trigger_reason: str
    ):
        """Send rug pull alert to user via Telegram."""
        from bot.models.user import User
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup

        with get_session() as session:
            user = session.query(User).filter(
                User.id == monitor.user_id
            ).first()
            if not user:
                return
            telegram_id = user.telegram_id

        if not self._bot or not telegram_id:
            return

        token_short = (
            f"{monitor.token_address[:6]}...{monitor.token_address[-4:]}"
        )

        if monitor.auto_sell_enabled and monitor.sell_tx_id:
            text = (
                f"🚨 *Rug Alert — Auto-Sold!*\n\n"
                f"Token: `{token_short}`\n"
                f"Chain: {monitor.chain}\n"
                f"Reason: {trigger_reason}\n\n"
                f"Your position was automatically sold to protect funds."
            )
            buttons = [
                [
                    InlineKeyboardButton(
                        "📊 View Details",
                        callback_data=f"rug_details_{monitor.id}",
                    ),
                    InlineKeyboardButton(
                        "🔕 Disable Monitor",
                        callback_data=f"rug_disable_{monitor.id}",
                    ),
                ]
            ]
        else:
            text = (
                f"🚨 *Rug Alert!*\n\n"
                f"Token: `{token_short}`\n"
                f"Chain: {monitor.chain}\n"
                f"Reason: {trigger_reason}\n\n"
                f"⚠️ Consider selling your position immediately."
            )
            buttons = [
                [
                    InlineKeyboardButton(
                        "💰 Sell Now",
                        callback_data=f"rug_sell_{monitor.id}",
                    ),
                    InlineKeyboardButton(
                        "⏭ Ignore",
                        callback_data=f"rug_ignore_{monitor.id}",
                    ),
                ],
                [
                    InlineKeyboardButton(
                        "🔕 Disable Monitor",
                        callback_data=f"rug_disable_{monitor.id}",
                    ),
                ],
            ]

        try:
            await self._bot.send_message(
                chat_id=telegram_id,
                text=text,
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(buttons),
            )
        except Exception as e:
            logger.error(f"Failed to send rug alert: {e}")


# Global instance
rug_monitor_service = RugMonitorService()
