"""Perpetual trading business logic service."""

import logging
from typing import Optional
from decimal import Decimal
from datetime import datetime, timezone

from bot.services.hyperliquid_client import hyperliquid_client, HLOrderResult
from bot.models.perps import PerpPosition, PerpOrder, HyperLiquidAccount
from database.db import get_session

logger = logging.getLogger(__name__)


class PerpsService:
    """Service for managing perpetual trading positions."""

    # Default limits
    MAX_LEVERAGE = 20  # Cap even if exchange allows more
    MIN_MARGIN_USD = 10.0
    FEE_PERCENTAGE = 0.02  # 2 bps

    def __init__(self):
        self._client = hyperliquid_client

    def get_account(self, user_id: int) -> Optional[HyperLiquidAccount]:
        """Get user's HyperLiquid account."""
        with get_session() as session:
            return session.query(HyperLiquidAccount).filter_by(
                user_id=user_id, is_active=True
            ).first()

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
        # Validate
        if leverage > self.MAX_LEVERAGE:
            raise ValueError(f"Maximum leverage is {self.MAX_LEVERAGE}x")
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

            session.expunge(position)

        # Place TP/SL orders if specified
        if tp_price:
            await self._place_tp_sl(user_id, account, market, side, size, "take_profit", tp_price, position_id)
        if sl_price:
            await self._place_tp_sl(user_id, account, market, side, size, "stop_loss", sl_price, position_id)

        logger.info(f"Opened {side} {market} position for user {user_id}: {size} @ {entry_price}")
        return position

    async def close_position(
        self,
        user_id: int,
        position_id: int,
        percent: float = 100.0,
    ) -> Optional[dict]:
        """Close a position (fully or partially)."""
        with get_session() as session:
            position = session.query(PerpPosition).filter_by(
                id=position_id, user_id=user_id, status="open"
            ).first()

            if not position:
                raise ValueError("Position not found or already closed")

            market = position.market
            side = position.side
            close_size = float(position.size) * (percent / 100.0)

        account = self.get_account(user_id)
        if not account:
            raise ValueError("HyperLiquid account not found")

        api_key, api_secret = self._decrypt_credentials(account)

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

        logger.info(f"Closed {percent}% of {side} {market} for user {user_id}. PnL: ${pnl:.2f}")

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
            position = session.query(PerpPosition).filter_by(
                id=position_id, user_id=user_id, status="open"
            ).first()

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
            positions = session.query(PerpPosition).filter_by(
                user_id=user_id, status=status
            ).order_by(PerpPosition.opened_at.desc()).all()
            for p in positions:
                session.expunge(p)
            return positions

    def get_position(self, user_id: int, position_id: int) -> Optional[PerpPosition]:
        """Get a specific position."""
        with get_session() as session:
            position = session.query(PerpPosition).filter_by(
                id=position_id, user_id=user_id
            ).first()
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
            local_positions = session.query(PerpPosition).filter_by(
                user_id=user_id, status="open"
            ).all()

            for local_pos in local_positions:
                # Find matching HL position
                hl_match = next(
                    (p for p in hl_positions if p["market"] == local_pos.market and p["side"] == local_pos.side),
                    None,
                )

                if hl_match:
                    local_pos.mark_price = Decimal(str(hl_match.get("entry_price", 0)))
                    local_pos.unrealized_pnl = Decimal(str(hl_match.get("unrealized_pnl", 0)))
                    local_pos.liquidation_price = Decimal(str(hl_match.get("liquidation_price", 0)))
                    local_pos.size = Decimal(str(hl_match.get("size", float(local_pos.size))))
                else:
                    # Position no longer exists on exchange — mark as closed/liquidated
                    local_pos.status = "liquidated" if local_pos.unrealized_pnl and local_pos.unrealized_pnl < 0 else "closed"
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

    def _decrypt_credentials(self, account: HyperLiquidAccount) -> tuple[str, str]:
        """Decrypt API credentials from account."""
        from bot.utils.encryption import decrypt_value

        api_key = decrypt_value(account.api_key_encrypted) if account.api_key_encrypted else ""
        api_secret = decrypt_value(account.api_secret_encrypted) if account.api_secret_encrypted else ""
        return api_key, api_secret


# Global instance
perps_service = PerpsService()
