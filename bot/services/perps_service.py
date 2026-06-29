"""Perpetual trading business logic service."""

import logging
from typing import Optional
from decimal import Decimal
from datetime import datetime, timezone, timedelta

from bot.services.hyperliquid_client import hyperliquid_client, HLOrderResult
from bot.models.perps import PerpPosition, PerpOrder, HyperLiquidAccount
from database.db import get_session

logger = logging.getLogger(__name__)


class PerpsService:
    """Service for managing perpetual trading positions."""

    # Default limits
    # Per-market max leverage is fetched from HyperLiquid's meta endpoint at
    # order-time and clamped to that value. This fallback applies only when the
    # meta fetch fails (network error, unknown asset).
    FALLBACK_MAX_LEVERAGE = 100
    MIN_MARGIN_USD = 10.0
    FEE_PERCENTAGE = 0.02  # 2 bps

    def __init__(self):
        self._client = hyperliquid_client

    def _builder_config(self) -> tuple[Optional[str], int]:
        """Return ``(builder_address, fee_tenths_bps)`` from settings, or ``(None, 0)``."""
        from bot.config.settings import settings

        address = getattr(settings, "hl_builder_address", None)
        fee = int(getattr(settings, "hl_builder_fee_tenths_bps", 0) or 0)
        if not address or fee <= 0:
            return None, 0
        return address, fee

    async def ensure_builder_approved(self, account: HyperLiquidAccount) -> Optional[str]:
        """Ensure the user has approved Suwappu's builder fee; approve once if not.

        Returns the builder address to attach to orders, or None when no builder is
        configured or approval could not be established. Failure to approve never
        blocks trading — orders simply go out without a builder fee.
        """
        from bot.config.settings import settings

        builder_address, fee = self._builder_config()
        if not builder_address:
            return None

        try:
            approved = await self._client.get_max_builder_fee(account.hl_address, builder_address)
            if approved >= fee:
                return builder_address

            _, api_secret = self._decrypt_credentials(account)
            ok = await self._client.approve_builder_fee(
                api_secret, builder_address, settings.hl_builder_max_fee_rate
            )
            if ok:
                logger.info("Approved builder fee %s for user %s", builder_address, account.user_id)
                return builder_address
            logger.warning("Builder fee approval failed for user %s", account.user_id)
            return None
        except Exception as e:
            logger.warning("ensure_builder_approved error: %s", e)
            return None

    def get_account(self, user_id: int) -> Optional[HyperLiquidAccount]:
        """Get user's HyperLiquid account."""
        with get_session() as session:
            return (
                session.query(HyperLiquidAccount).filter_by(user_id=user_id, is_active=True).first()
            )

    def setup_account(
        self,
        user_id: int,
        hl_address: str,
        api_key_encrypted: str,
        api_secret_encrypted: str,
    ) -> HyperLiquidAccount:
        """Set up or update HyperLiquid account."""
        with get_session() as session:
            account = session.query(HyperLiquidAccount).filter_by(user_id=user_id).first()

            if account:
                account.hl_address = hl_address
                account.api_key_encrypted = api_key_encrypted
                account.api_secret_encrypted = api_secret_encrypted
                account.is_active = True
                account.updated_at = datetime.now(timezone.utc)
            else:
                account = HyperLiquidAccount(
                    user_id=user_id,
                    hl_address=hl_address,
                    api_key_encrypted=api_key_encrypted,
                    api_secret_encrypted=api_secret_encrypted,
                )
                session.add(account)

            session.flush()
            # Detach from session for return
            session.expunge(account)
            return account

    async def open_position(
        self,
        user_id: int,
        market: str,
        side: str,
        size: float,
        leverage: int = 1,
        tp_price: Optional[float] = None,
        sl_price: Optional[float] = None,
    ) -> Optional[PerpPosition]:
        """Open a new perpetual position."""
        # Resolve per-market max leverage from HyperLiquid's meta endpoint.
        # The HL asset name strips the "-USD" suffix (ETH-USD -> ETH).
        asset = market.split("-")[0] if "-" in market else market
        market_max = await self._client.get_market_max_leverage(asset, self.FALLBACK_MAX_LEVERAGE)
        if leverage > market_max:
            raise ValueError(f"Maximum leverage for {market} is {market_max}x (HyperLiquid limit)")
        if leverage < 1:
            raise ValueError("Minimum leverage is 1x")
        if side not in ("long", "short"):
            raise ValueError("Side must be 'long' or 'short'")

        # Get account
        account = self.get_account(user_id)
        if not account:
            raise ValueError("HyperLiquid account not set up. Use /perps setup first.")

        # Decrypt API credentials
        api_key, api_secret = self._decrypt_credentials(account)

        # Ensure the builder fee is approved so Suwappu earns on this order.
        builder_address = await self.ensure_builder_approved(account)
        _, builder_fee = self._builder_config()

        # Best-effort: attach Suwappu's referral code on the user's first trade.
        await self.ensure_referrer(account)

        # Place order
        result = await self._client.place_order(
            address=account.hl_address,
            api_key=api_key,
            api_secret=api_secret,
            market=market,
            side=side,
            size=size,
            leverage=leverage,
            order_type="market",
            tp_price=tp_price,
            sl_price=sl_price,
            builder_address=builder_address,
            builder_fee_tenths_bps=builder_fee if builder_address else None,
        )

        if not result:
            raise Exception("Failed to place order on HyperLiquid")

        # Get mark price for entry
        mark_price = await self._client.get_mark_price(market)
        entry_price = result.fill_price or mark_price or 0

        # Create position record
        with get_session() as session:
            position = PerpPosition(
                user_id=user_id,
                exchange="hyperliquid",
                market=market,
                side=side,
                size=Decimal(str(size)),
                entry_price=Decimal(str(entry_price)),
                mark_price=Decimal(str(mark_price or entry_price)),
                leverage=leverage,
                margin=Decimal(str(size * entry_price / leverage)) if entry_price else None,
                tp_price=Decimal(str(tp_price)) if tp_price else None,
                sl_price=Decimal(str(sl_price)) if sl_price else None,
                status="open",
            )
            session.add(position)

            # Create order record
            order = PerpOrder(
                user_id=user_id,
                exchange="hyperliquid",
                market=market,
                side=side,
                order_type="market",
                size=Decimal(str(size)),
                leverage=leverage,
                status="filled" if result.status == "filled" else "pending",
                hl_order_id=result.order_id,
                fill_price=Decimal(str(result.fill_price)) if result.fill_price else None,
                filled_at=datetime.now(timezone.utc) if result.status == "filled" else None,
            )
            session.add(order)

            session.flush()
            position_id = position.id
            order.position_id = position_id
            order_db_id = order.id  # capture before session closes

            session.expunge(position)

        # Place TP/SL orders if specified
        if tp_price:
            await self._place_tp_sl(
                user_id, account, market, side, size, "take_profit", tp_price, position_id
            )
        if sl_price:
            await self._place_tp_sl(
                user_id, account, market, side, size, "stop_loss", sl_price, position_id
            )

        logger.info(f"Opened {side} {market} position for user {user_id}: {size} @ {entry_price}")

        # Whole-product points: reward the perps trade on notional (fee-denominated
        # season accrual). Never let a points error break the on-chain position.
        try:
            notional_usd = float(size) * float(entry_price or 0)
            if notional_usd > 0:
                self._award_xp(
                    user_id,
                    "perps_trade",
                    int(notional_usd / 10),
                    f"Perps {side} {market} (${notional_usd:,.0f} notional)",
                    metadata={
                        "amount_usd": notional_usd,
                        "fee_usd": self._perps_fee_usd(notional_usd),
                    },
                )
        except Exception as e:
            logger.debug("perps_trade award skipped (open): %s", e)

        # Referral perps commission — best-effort, never blocks position open.
        try:
            notional_usd = float(size) * float(entry_price or 0)
            builder_fee_usd = self._perps_fee_usd(notional_usd)
            if builder_fee_usd and builder_fee_usd > 0 and order_db_id:
                from bot.services.referral_service import referral_service

                referral_service.credit_perps_commission(
                    referee_id=user_id,
                    perp_order_id=order_db_id,
                    builder_fee_usd=builder_fee_usd,
                    trade_notional_usd=notional_usd,
                    market=market,
                )
        except Exception as e:
            logger.debug("Perps referral commission skipped (open): %s", e)

        return position

    async def place_limit_order(
        self,
        user_id: int,
        market: str,
        side: str,
        size: float,
        limit_price: float,
        leverage: int = 1,
    ) -> Optional[PerpOrder]:
        """Place a resting GTC limit entry order on HyperLiquid.

        Unlike :meth:`open_position` (a market order that fills immediately and
        creates a position), a limit order RESTS until the market reaches
        ``limit_price``. No ``PerpPosition`` is created here — once HyperLiquid
        fills the order the position surfaces in the live positions poll
        (``get_open_positions``). We record a ``PerpOrder`` for history. TP/SL is
        intentionally NOT auto-placed for a limit entry: a reduce-only trigger
        before a position exists is an HL edge case, so TP/SL is set after fill.
        """
        # Resolve per-market max leverage from HyperLiquid's meta endpoint.
        asset = market.split("-")[0] if "-" in market else market
        market_max = await self._client.get_market_max_leverage(asset, self.FALLBACK_MAX_LEVERAGE)
        if leverage > market_max:
            raise ValueError(f"Maximum leverage for {market} is {market_max}x (HyperLiquid limit)")
        if leverage < 1:
            raise ValueError("Minimum leverage is 1x")
        if side not in ("long", "short"):
            raise ValueError("Side must be 'long' or 'short'")
        if not size or size <= 0:
            raise ValueError("Size must be greater than zero")
        if not limit_price or limit_price <= 0:
            raise ValueError("Limit price must be greater than zero")

        account = self.get_account(user_id)
        if not account:
            raise ValueError("HyperLiquid account not set up. Use /perps setup first.")

        api_key, api_secret = self._decrypt_credentials(account)

        # Builder fee + referral, same as the market path, so Suwappu earns on
        # the order when it fills.
        builder_address = await self.ensure_builder_approved(account)
        _, builder_fee = self._builder_config()
        await self.ensure_referrer(account)

        result = await self._client.place_order(
            address=account.hl_address,
            api_key=api_key,
            api_secret=api_secret,
            market=market,
            side=side,
            size=size,
            price=limit_price,
            leverage=leverage,
            order_type="limit",
            builder_address=builder_address,
            builder_fee_tenths_bps=builder_fee if builder_address else None,
        )

        if not result:
            raise Exception("Failed to place limit order on HyperLiquid")

        # A GTC limit usually rests ("open"); it may fill instantly if it crosses
        # the book (then the position shows up in the live poll).
        filled = result.status == "filled"
        with get_session() as session:
            order = PerpOrder(
                user_id=user_id,
                exchange="hyperliquid",
                market=market,
                side=side,
                order_type="limit",
                size=Decimal(str(size)),
                price=Decimal(str(limit_price)),
                leverage=leverage,
                status="filled" if filled else "open",
                hl_order_id=result.order_id,
                fill_price=Decimal(str(result.fill_price)) if result.fill_price else None,
                filled_at=datetime.now(timezone.utc) if filled else None,
            )
            session.add(order)
            session.flush()
            session.expunge(order)

        logger.info(
            f"Placed limit {side} {market} for user {user_id}: {size} @ {limit_price} "
            f"({'filled' if filled else 'resting'})"
        )
        return order

    async def get_open_orders(self, user_id: int) -> list[dict]:
        """Return the user's resting HyperLiquid orders (live, keyed by address)."""
        account = self.get_account(user_id)
        if not account or not account.hl_address:
            return []
        return await self._client.get_open_orders(account.hl_address)

    async def cancel_order(self, user_id: int, market: str, order_id: str) -> bool:
        """Cancel a resting HyperLiquid order for the user."""
        account = self.get_account(user_id)
        if not account:
            raise ValueError("HyperLiquid account not found")
        api_key, api_secret = self._decrypt_credentials(account)
        return await self._client.cancel_order(
            address=account.hl_address,
            api_key=api_key,
            api_secret=api_secret,
            market=market,
            order_id=order_id,
        )

    async def close_position(
        self,
        user_id: int,
        position_id: int,
        percent: float = 100.0,
    ) -> Optional[dict]:
        """Close a position (fully or partially)."""
        with get_session() as session:
            position = (
                session.query(PerpPosition)
                .filter_by(id=position_id, user_id=user_id, status="open")
                .first()
            )

            if not position:
                raise ValueError("Position not found or already closed")

            market = position.market
            side = position.side
            close_size = float(position.size) * (percent / 100.0)

        account = self.get_account(user_id)
        if not account:
            raise ValueError("HyperLiquid account not found")

        api_key, api_secret = self._decrypt_credentials(account)

        builder_address, builder_fee = self._builder_config()

        # Place close order (opposite side, reduce only)
        result = await self._client.place_order(
            address=account.hl_address,
            api_key=api_key,
            api_secret=api_secret,
            market=market,
            side=side,
            size=close_size,
            order_type="market",
            reduce_only=True,
            builder_address=builder_address,
            builder_fee_tenths_bps=builder_fee if builder_address else None,
        )

        if not result:
            raise Exception("Failed to close position on HyperLiquid")

        close_price = result.fill_price or await self._client.get_mark_price(market) or 0

        # Calculate PnL
        with get_session() as session:
            position = session.query(PerpPosition).get(position_id)
            entry = float(position.entry_price)

            if side == "long":
                pnl = (close_price - entry) * close_size
            else:
                pnl = (entry - close_price) * close_size

            if percent >= 100:
                position.status = "closed"
                position.closed_at = datetime.now(timezone.utc)
                position.closed_pnl = Decimal(str(pnl))
            else:
                position.size = Decimal(str(float(position.size) - close_size))

            position.mark_price = Decimal(str(close_price))

            # Create close order record
            order = PerpOrder(
                user_id=user_id,
                position_id=position_id,
                exchange="hyperliquid",
                market=market,
                side=side,
                order_type="market",
                size=Decimal(str(close_size)),
                leverage=position.leverage,
                status="filled",
                hl_order_id=result.order_id,
                fill_price=Decimal(str(close_price)),
                filled_at=datetime.now(timezone.utc),
            )
            session.add(order)
            session.flush()
            close_order_db_id = order.id  # capture before session closes

        logger.info(f"Closed {percent}% of {side} {market} for user {user_id}. PnL: ${pnl:.2f}")

        # Whole-product points: reward the closing trade on the closed notional
        # (fee-denominated). Closing is a fee-bearing on-chain order too, so it
        # earns like the open. Points failures never break the close.
        try:
            close_notional_usd = float(close_size) * float(close_price or 0)
            if close_notional_usd > 0:
                self._award_xp(
                    user_id,
                    "perps_trade",
                    int(close_notional_usd / 10),
                    f"Perps close {side} {market} (${close_notional_usd:,.0f})",
                    metadata={
                        "amount_usd": close_notional_usd,
                        "fee_usd": self._perps_fee_usd(close_notional_usd),
                    },
                )
        except Exception as e:
            logger.debug("perps_trade award skipped (close): %s", e)

        # Referral perps commission on close — best-effort, never blocks close.
        try:
            close_notional_usd = float(close_size) * float(close_price or 0)
            builder_fee_usd = self._perps_fee_usd(close_notional_usd)
            if builder_fee_usd and builder_fee_usd > 0 and close_order_db_id:
                from bot.services.referral_service import referral_service

                referral_service.credit_perps_commission(
                    referee_id=user_id,
                    perp_order_id=close_order_db_id,
                    builder_fee_usd=builder_fee_usd,
                    trade_notional_usd=close_notional_usd,
                    market=market,
                )
        except Exception as e:
            logger.debug("Perps referral commission skipped (close): %s", e)

        return {
            "market": market,
            "side": side,
            "close_size": close_size,
            "close_price": close_price,
            "pnl": pnl,
            "percent_closed": percent,
        }

    async def modify_tp_sl(
        self,
        user_id: int,
        position_id: int,
        tp_price: Optional[float] = None,
        sl_price: Optional[float] = None,
    ):
        """Modify take profit / stop loss for a position."""
        with get_session() as session:
            position = (
                session.query(PerpPosition)
                .filter_by(id=position_id, user_id=user_id, status="open")
                .first()
            )

            if not position:
                raise ValueError("Position not found")

            if tp_price is not None:
                position.tp_price = Decimal(str(tp_price))
            if sl_price is not None:
                position.sl_price = Decimal(str(sl_price))

        logger.info(f"Updated TP/SL for position {position_id}: TP={tp_price}, SL={sl_price}")

    def get_positions(self, user_id: int, status: str = "open") -> list[PerpPosition]:
        """Get user's positions."""
        with get_session() as session:
            positions = (
                session.query(PerpPosition)
                .filter_by(user_id=user_id, status=status)
                .order_by(PerpPosition.opened_at.desc())
                .all()
            )
            for p in positions:
                session.expunge(p)
            return positions

    def get_position(self, user_id: int, position_id: int) -> Optional[PerpPosition]:
        """Get a specific position."""
        with get_session() as session:
            position = (
                session.query(PerpPosition).filter_by(id=position_id, user_id=user_id).first()
            )
            if position:
                session.expunge(position)
            return position

    async def sync_positions(self, user_id: int):
        """Sync local positions with HyperLiquid state."""
        account = self.get_account(user_id)
        if not account:
            return

        hl_positions = await self._client.get_open_positions(account.hl_address)

        with get_session() as session:
            local_positions = (
                session.query(PerpPosition).filter_by(user_id=user_id, status="open").all()
            )

            for local_pos in local_positions:
                # Find matching HL position
                hl_match = next(
                    (
                        p
                        for p in hl_positions
                        if p["market"] == local_pos.market and p["side"] == local_pos.side
                    ),
                    None,
                )

                if hl_match:
                    local_pos.mark_price = Decimal(str(hl_match.get("entry_price", 0)))
                    local_pos.unrealized_pnl = Decimal(str(hl_match.get("unrealized_pnl", 0)))
                    local_pos.liquidation_price = Decimal(str(hl_match.get("liquidation_price", 0)))
                    local_pos.size = Decimal(str(hl_match.get("size", float(local_pos.size))))
                else:
                    # Position no longer exists on exchange — mark as closed/liquidated
                    local_pos.status = (
                        "liquidated"
                        if local_pos.unrealized_pnl and local_pos.unrealized_pnl < 0
                        else "closed"
                    )
                    local_pos.closed_at = datetime.now(timezone.utc)

    async def _place_tp_sl(
        self,
        user_id: int,
        account: HyperLiquidAccount,
        market: str,
        side: str,
        size: float,
        order_type: str,
        price: float,
        position_id: int,
    ):
        """Place a take profit or stop loss order."""
        try:
            api_key, api_secret = self._decrypt_credentials(account)
            result = await self._client.place_order(
                address=account.hl_address,
                api_key=api_key,
                api_secret=api_secret,
                market=market,
                side=side,
                size=size,
                price=price,
                order_type=order_type,
                reduce_only=True,
            )

            if result:
                with get_session() as session:
                    order = PerpOrder(
                        user_id=user_id,
                        position_id=position_id,
                        exchange="hyperliquid",
                        market=market,
                        side=side,
                        order_type=order_type,
                        size=Decimal(str(size)),
                        price=Decimal(str(price)),
                        status="pending",
                        hl_order_id=result.order_id,
                    )
                    session.add(order)
        except Exception as e:
            logger.error(f"Failed to place {order_type} order: {e}")

    async def ensure_referrer(self, account: HyperLiquidAccount) -> None:
        """Best-effort: attach Suwappu's referral code to the user once.

        Fires on first perp use. If the user already has a referrer, HyperLiquid
        rejects the action and we move on. Never blocks trading.
        """
        from bot.config.settings import settings

        code = getattr(settings, "hl_referral_code", None)
        if not code:
            return
        try:
            state = await self._client.get_referral_state(account.hl_address)
            if (state or {}).get("referredBy"):
                return  # already referred (by us or anyone) — nothing to do
            _, api_secret = self._decrypt_credentials(account)
            ok = await self._client.set_referrer(api_secret, code)
            if ok:
                logger.info("Set referrer %s for user %s", code, account.user_id)
        except Exception as e:
            logger.debug("ensure_referrer skipped for user %s: %s", account.user_id, e)

    @staticmethod
    def _award_xp(
        user_id: int,
        action: str,
        amount: int,
        description: str,
        metadata: Optional[dict] = None,
    ) -> None:
        """Best-effort XP award; never blocks the on-chain action.

        ``metadata`` (e.g. ``{"amount_usd": notional, "fee_usd": fee}``) is
        forwarded so the season accrual is fee-denominated for trading actions.
        """
        try:
            from bot.services.points_service import points_service

            points_service.award_points(
                user_id=user_id,
                action=action,
                amount=max(1, int(amount)),
                description=description,
                metadata=metadata,
            )
        except Exception as e:
            logger.debug("XP award skipped (%s): %s", action, e)

    def _perps_fee_usd(self, notional_usd: float) -> Optional[float]:
        """Estimate the Suwappu builder fee (USD) on a perps order of ``notional_usd``.

        HL builder fee is configured in tenths-of-a-bps; fee = notional * tenths/1e5.
        Returns None when no builder fee is configured (no fee-denominated accrual).
        """
        try:
            _, builder_fee_tenths_bps = self._builder_config()
            tenths = float(builder_fee_tenths_bps or 0)
            if tenths <= 0 or notional_usd <= 0:
                return None
            return float(notional_usd) * tenths / 100_000.0
        except Exception:
            return None

    async def place_twap(
        self,
        user_id: int,
        market: str,
        side: str,
        size: float,
        minutes: int,
        randomize: bool = True,
    ) -> Optional[str]:
        """Place a TWAP order, persist it for monitoring, and return the TWAP id."""
        account = self.get_account(user_id)
        if not account:
            return None
        api_key, api_secret = self._decrypt_credentials(account)
        builder_address, _ = self._builder_config()
        if builder_address:
            await self.ensure_builder_approved(account)

        twap_id = await self._client.place_twap_order(
            address=account.hl_address,
            api_key=api_key,
            api_secret=api_secret,
            market=market,
            side=side,
            size=size,
            minutes=minutes,
            randomize=randomize,
        )
        if not twap_id:
            return None

        try:
            from bot.models.hl_ecosystem import HLTwapOrder

            with get_session() as session:
                session.add(
                    HLTwapOrder(
                        user_id=user_id,
                        twap_id=str(twap_id),
                        market=market,
                        side=side,
                        size=Decimal(str(size)),
                        minutes=int(minutes),
                        status="running",
                    )
                )
        except Exception as e:
            logger.warning("Failed to persist TWAP order: %s", e)
        self._award_xp(user_id, "hl_twap", 5, f"TWAP {side} {size} {market}")
        return twap_id

    async def stake(
        self,
        user_id: int,
        validator: str,
        amount_hype: float,
        is_undelegate: bool = False,
        validator_name: Optional[str] = None,
    ) -> bool:
        """Delegate or undelegate HYPE.

        On delegate, automatically tops up the staking balance from spot (cDeposit)
        if it's short, so the user never has to manage the spot↔staking split by
        hand. Records the delegation locally for portfolio + monitoring.
        """
        account = self.get_account(user_id)
        if not account:
            return False
        _, api_secret = self._decrypt_credentials(account)

        if not is_undelegate:
            # Ensure enough sits in the staking balance before delegating.
            try:
                summary = await self._client.get_staking_summary(account.hl_address)
                undelegated = float(summary.get("undelegated", 0) or 0)
                shortfall = amount_hype - undelegated
                if shortfall > 1e-8:
                    moved = await self._client.staking_transfer(
                        api_secret, shortfall, is_deposit=True
                    )
                    if not moved:
                        logger.warning("cDeposit top-up failed for user %s", user_id)
                        return False
            except Exception as e:
                logger.warning("staking balance check failed: %s", e)

        ok = await self._client.delegate_stake(api_secret, validator, amount_hype, is_undelegate)
        if ok:
            self._record_stake(user_id, validator, validator_name, amount_hype, is_undelegate)
            if not is_undelegate:
                self._award_xp(user_id, "hl_stake", 10, f"Staked {amount_hype} HYPE")
        return ok

    def _record_stake(self, user_id, validator, validator_name, amount_hype, is_undelegate):
        """Upsert the local delegation record (best-effort)."""
        try:
            from bot.models.hl_ecosystem import HLStakeRecord

            with get_session() as session:
                rec = (
                    session.query(HLStakeRecord)
                    .filter_by(user_id=user_id, validator=validator)
                    .first()
                )
                if not rec:
                    rec = HLStakeRecord(
                        user_id=user_id, validator=validator, amount_hype=Decimal("0")
                    )
                    session.add(rec)
                if validator_name:
                    rec.validator_name = validator_name
                delta = Decimal(str(amount_hype)) * (
                    Decimal("-1") if is_undelegate else Decimal("1")
                )
                rec.amount_hype = max(Decimal("0"), (rec.amount_hype or Decimal("0")) + delta)
                if is_undelegate:
                    # 1-day unstaking lockup before the HYPE returns to spot.
                    rec.locked_until = datetime.now(timezone.utc) + timedelta(days=1)
                rec.status = "undelegated" if rec.amount_hype == 0 else "delegated"
        except Exception as e:
            logger.warning("Failed to record stake: %s", e)

    async def move_staking_balance(
        self, user_id: int, amount_hype: float, is_deposit: bool
    ) -> bool:
        """Move HYPE between spot and staking balances (cDeposit/cWithdraw)."""
        account = self.get_account(user_id)
        if not account:
            return False
        _, api_secret = self._decrypt_credentials(account)
        return await self._client.staking_transfer(api_secret, amount_hype, is_deposit)

    async def vault_transfer(
        self, user_id: int, vault_address: str, is_deposit: bool, usd: float
    ) -> bool:
        """Deposit into / withdraw from a vault, recording the position locally."""
        account = self.get_account(user_id)
        if not account:
            return False
        _, api_secret = self._decrypt_credentials(account)
        ok = await self._client.vault_transfer(api_secret, vault_address, is_deposit, usd)
        if ok:
            try:
                from bot.models.hl_ecosystem import HLVaultPosition

                with get_session() as session:
                    pos = (
                        session.query(HLVaultPosition)
                        .filter_by(user_id=user_id, vault_address=vault_address.lower())
                        .first()
                    )
                    if not pos:
                        pos = HLVaultPosition(
                            user_id=user_id,
                            vault_address=vault_address.lower(),
                            deposited_usd=Decimal("0"),
                        )
                        session.add(pos)
                    delta = Decimal(str(usd)) * (Decimal("1") if is_deposit else Decimal("-1"))
                    pos.deposited_usd = (pos.deposited_usd or Decimal("0")) + delta
                    pos.is_open = pos.deposited_usd > 0 or is_deposit
            except Exception as e:
                logger.warning("Failed to record vault position: %s", e)
            if is_deposit:
                self._award_xp(user_id, "hl_vault", int(usd / 10), f"Vault deposit ${usd}")
        return ok

    async def transfer_usd(self, user_id: int, amount: float, to_perp: bool) -> bool:
        """Move USDC between the user's spot and perp wallets (usdClassTransfer)."""
        account = self.get_account(user_id)
        if not account:
            return False
        _, api_secret = self._decrypt_credentials(account)
        return await self._client.usd_class_transfer(api_secret, amount, to_perp)

    async def cancel_twap(self, user_id: int, record_id: int) -> bool:
        """Cancel a running TWAP (by local record id) on HyperLiquid."""
        account = self.get_account(user_id)
        if not account:
            return False
        from bot.models.hl_ecosystem import HLTwapOrder

        with get_session() as session:
            rec = session.query(HLTwapOrder).filter_by(id=record_id, user_id=user_id).first()
            if not rec or rec.status != "running" or not rec.twap_id:
                return False
            market, twap_id = rec.market, int(rec.twap_id)

        api_key, api_secret = self._decrypt_credentials(account)
        ok = await self._client.cancel_twap(
            account.hl_address, api_key, api_secret, market, twap_id
        )
        if ok:
            with get_session() as session:
                rec = session.query(HLTwapOrder).filter_by(id=record_id).first()
                if rec:
                    rec.status = "cancelled"
                    rec.finished_at = datetime.now(timezone.utc)
        return ok

    async def get_holdings_usd(self, user_id: int) -> dict:
        """Return the user's HyperLiquid holdings in USD for the portfolio view.

        ``{perps_usd, staking_usd, vault_usd, total_usd}``. Returns zeros (not an
        error) when the user has no HL account.
        """
        zero = {
            "perps_usd": 0.0,
            "spot_usd": 0.0,
            "staking_usd": 0.0,
            "vault_usd": 0.0,
            "total_usd": 0.0,
        }
        account = self.get_account(user_id)
        if not account or not account.hl_address:
            return zero
        try:
            addr = account.hl_address
            perps_usd = await self._client.get_account_value(addr)
            spot_usd = await self._client.get_spot_value_usd(addr)

            summary = await self._client.get_staking_summary(addr)
            staked_hype = float(summary.get("delegated", 0) or 0) + float(
                summary.get("undelegated", 0) or 0
            )
            staking_usd = 0.0
            if staked_hype > 0:
                staking_usd = staked_hype * await self._client.get_hype_price()

            equities = await self._client.get_user_vault_equities(addr)
            vault_usd = sum(float(e.get("equity", 0) or 0) for e in equities)

            total = perps_usd + spot_usd + staking_usd + vault_usd
            return {
                "perps_usd": perps_usd,
                "spot_usd": spot_usd,
                "staking_usd": staking_usd,
                "vault_usd": vault_usd,
                "total_usd": total,
            }
        except Exception as e:
            logger.warning("get_holdings_usd failed for user %s: %s", user_id, e)
            return zero

    async def place_spot_order(
        self,
        user_id: int,
        coin: str,
        is_buy: bool,
        amount: float,
        amount_is_usd: bool = False,
    ) -> Optional[HLOrderResult]:
        """Place a marketable spot order. For buys, ``amount_is_usd`` lets the user
        spend a USD notional (converted to size via the live mid)."""
        account = self.get_account(user_id)
        if not account:
            return None
        api_key, api_secret = self._decrypt_credentials(account)

        asset = await self._client.resolve_spot_asset(coin)
        if not asset:
            return None

        size = amount
        if amount_is_usd:
            mid = await self._client.get_spot_mid(asset["name"])
            if mid <= 0:
                return None
            size = amount / mid

        builder_address = await self.ensure_builder_approved(account)
        _, builder_fee = self._builder_config()
        await self.ensure_referrer(account)

        result = await self._client.place_spot_order(
            address=account.hl_address,
            api_key=api_key,
            api_secret=api_secret,
            coin=coin,
            is_buy=is_buy,
            size=size,
            builder_address=builder_address,
            builder_fee_tenths_bps=builder_fee if builder_address else None,
        )
        if result:
            self._award_xp(user_id, "hl_spot", 5, f"Spot {'buy' if is_buy else 'sell'} {coin}")
        return result

    def _decrypt_credentials(self, account: HyperLiquidAccount) -> tuple[str, str]:
        """Decrypt API credentials from account."""
        from bot.utils.encryption import decrypt_private_key
        from bot.config.settings import settings

        key = settings.encryption_key
        api_key = (
            decrypt_private_key(account.api_key_encrypted, key) if account.api_key_encrypted else ""
        )
        api_secret = (
            decrypt_private_key(account.api_secret_encrypted, key)
            if account.api_secret_encrypted
            else ""
        )
        return api_key, api_secret


# Global instance
perps_service = PerpsService()
