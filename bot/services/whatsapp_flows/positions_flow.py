"""Unified Positions / PnL hub for WhatsApp.

Aggregates spot (with cost-basis PnL), perps, prediction markets, and open
orders into a single summary.  Lets the user pick a held token and sell 25,
50, or 100% of it into USDC via swap_engine — exactly the same money path as
the Telegram pos_sell callback.
"""

from __future__ import annotations

import logging
import secrets

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pure formatting helpers (no Telegram escaping needed for WhatsApp)
# ---------------------------------------------------------------------------


def _fmt_usd(v: float) -> str:
    sign = "-" if v < 0 else ""
    a = abs(v)
    if a >= 1000:
        return f"{sign}${a:,.0f}"
    return f"{sign}${a:,.2f}"


def _pnl_str(pnl: float, cost: float) -> str:
    icon = "+" if pnl >= 0 else "-"
    pct = (pnl / cost * 100.0) if cost > 0 else 0.0
    return f"{icon}{_fmt_usd(abs(pnl))} ({icon}{abs(pct):.1f}%)"


# ---------------------------------------------------------------------------
# Data aggregation
# ---------------------------------------------------------------------------


async def _aggregate_positions(user_db_id: int) -> tuple[str, list[dict]]:
    """Build the positions summary text and a list of sellable spot holdings.

    Returns (summary_text, held_tokens) where each held-token entry is:
        {"token": str, "chain": str, "qty": float, "chain_type": str | None}
    """
    from database.db import get_session
    from bot.models.positions import UserPosition
    from bot.models.predict import PredictionPosition
    from bot.services.price_service import price_service
    from bot.services.perps_service import perps_service
    from bot.services.orders import order_service
    from bot.config.chains import get_chain_by_name

    total_value = 0.0
    total_unrealized = 0.0
    realized_spot = 0.0
    sections: list[str] = []
    held_tokens: list[dict] = []

    # ---- Spot ----
    spot_lines: list[str] = []
    with get_session() as session:
        rows = session.query(UserPosition).filter(UserPosition.user_id == user_db_id).all()
        realized_spot = sum(float(r.realized_pnl_usd or 0.0) for r in rows)
        held = [
            (r.token, r.chain, float(r.qty or 0), float(r.cost_usd or 0))
            for r in rows
            if float(r.qty or 0) > 1e-9
        ]

    for token, chain, qty, cost in held[:12]:
        try:
            price = await price_service.get_price(token)
        except Exception:
            price = None
        if not price:
            continue
        value = qty * price
        unreal = value - cost
        total_value += value
        total_unrealized += unreal
        spot_lines.append(
            f"{'+' if unreal >= 0 else '-'} {token} {qty:.4g} ({_fmt_usd(value)})  {_pnl_str(unreal, cost)}"
        )
        cfg = get_chain_by_name(chain)
        chain_type = cfg.chain_type.value if cfg else None
        held_tokens.append({"token": token, "chain": chain, "qty": qty, "chain_type": chain_type})

    if spot_lines:
        sections.append("-- Spot --\n" + "\n".join(spot_lines))
    else:
        sections.append("-- Spot --\nNo tracked spot positions yet.")

    # ---- Perps ----
    perps_lines: list[str] = []
    try:
        positions = perps_service.get_positions(user_db_id)
    except Exception:
        positions = []
    for pos in positions or []:
        upnl = float(getattr(pos, "unrealized_pnl", 0) or 0)
        margin = float(getattr(pos, "margin", 0) or 0)
        total_value += margin + upnl
        total_unrealized += upnl
        icon = "+" if upnl >= 0 else "-"
        liq = float(getattr(pos, "liquidation_price", 0) or 0)
        liq_str = f"  liq ${liq:,.2f}" if liq else ""
        perps_lines.append(
            f"{icon} {pos.market} {str(pos.side).upper()} {int(getattr(pos, 'leverage', 1) or 1)}x  "
            f"{_pnl_str(upnl, margin)}{liq_str}"
        )
    if perps_lines:
        sections.append("-- Perps --\n" + "\n".join(perps_lines))

    # ---- Predictions ----
    pred_lines: list[str] = []
    with get_session() as session:
        preds = (
            session.query(PredictionPosition)
            .filter(
                PredictionPosition.user_id == user_db_id,
                PredictionPosition.total_shares > 0,
                PredictionPosition.is_resolved == False,  # noqa: E712
            )
            .order_by(PredictionPosition.created_at.desc())
            .limit(10)
            .all()
        )
        for p in preds:
            shares = float(p.total_shares or 0)
            cost = float(p.total_cost_usdc or 0)
            cur = float(p.current_price or 0)
            value = shares * cur
            pnl = value - cost
            total_value += value
            total_unrealized += pnl
            q = str(p.market_question)[:32]
            icon = "+" if pnl >= 0 else "-"
            pct = (pnl / cost * 100.0) if cost > 0 else 0.0
            pred_lines.append(f'{icon} "{q}" {p.outcome} {shares:.0f}sh  {icon}{abs(pct):.1f}%')
    if pred_lines:
        sections.append("-- Predictions --\n" + "\n".join(pred_lines))

    # ---- Open orders ----
    try:
        limit_orders = order_service.get_user_orders(user_db_id) or []
    except Exception:
        limit_orders = []
    try:
        dca_orders = [
            o
            for o in (order_service.get_user_dca_orders(user_db_id) or [])
            if str(getattr(o, "status", "")) == "active"
        ]
    except Exception:
        dca_orders = []
    n_orders = len(limit_orders) + len(dca_orders)
    if n_orders:
        bits = []
        if limit_orders:
            bits.append(f"{len(limit_orders)} limit")
        if dca_orders:
            bits.append(f"{len(dca_orders)} DCA")
        sections.append(f"-- Open Orders ({n_orders}) --\n" + " / ".join(bits))

    # ---- Header ----
    pnl_icon = "+" if total_unrealized >= 0 else "-"
    header = (
        f"*Your Positions*\n\n"
        f"Total Value: {_fmt_usd(total_value)}\n"
        f"Unrealized PnL: {pnl_icon}{_fmt_usd(abs(total_unrealized))}\n"
    )
    if abs(realized_spot) > 0.005:
        rsign = "+" if realized_spot >= 0 else "-"
        header += f"Realized (spot): {rsign}{_fmt_usd(abs(realized_spot))}\n"

    summary = header + "\n" + "\n\n".join(sections)
    return summary, held_tokens


# ---------------------------------------------------------------------------
# Flow class
# ---------------------------------------------------------------------------


class PositionsFlow(BaseWhatsAppFlow):
    """Unified Positions / PnL hub with per-token Sell % action."""

    flow_name = "positions"
    trigger_commands = ["positions", "pos", "pnl", "/pos"]
    steps = {
        "show_summary": "_step_show_summary",
        "select_token": "_step_select_token",
        "sell": "_step_sell",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        # One-time backfill of cost basis from swap history.
        from database.db import get_session
        from bot.models.user import User

        needs_backfill = False
        with get_session() as session:
            db_user = session.query(User).filter(User.id == user_db_id).first()
            needs_backfill = db_user is not None and db_user.positions_backfilled_at is None

        if needs_backfill:
            try:
                from bot.services.positions_service import backfill_user_positions

                await backfill_user_positions(user_db_id)
            except Exception as exc:
                logger.warning(f"Positions backfill failed for {user_db_id}: {exc}")

        # Build aggregated summary.
        try:
            summary, held_tokens = await _aggregate_positions(user_db_id)
        except Exception as exc:
            logger.error(f"PositionsFlow aggregate failed: {exc}", exc_info=True)
            return FlowResponse(
                text="*Your Positions*\n\nCould not load positions right now. Please try again.",
            )

        if not held_tokens:
            # Nothing to sell — just show the summary, no follow-up needed.
            await self._clear(user_id)
            return FlowResponse(
                text=summary,
                footer="Swap tokens to start tracking positions.",
            )

        # Store holdings in state so later steps can resolve token picks.
        # Keyed by a simple index "pos_pick_<i>".
        token_index = {f"pos_pick_{i}": h for i, h in enumerate(held_tokens)}
        await self._set_state(
            user_id,
            "show_summary",
            {
                "user_db_id": user_db_id,
                "token_index": token_index,
            },
        )

        # Send the full summary as a plain-text message with a single "Sell a
        # Token" button.  This keeps the summary text out of the 1024-char
        # interactive-list body that would be used by the next step.
        return FlowResponse(
            text=summary,
            buttons=[
                {"id": "pos_sell_token", "title": "Sell a Token"},
            ],
        )

    async def _step_show_summary(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        """User acknowledged the summary; show the token-pick list."""
        if text != "pos_sell_token":
            # Re-show the action button.
            return FlowResponse(
                text="Tap the button below to sell a token.",
                buttons=[{"id": "pos_sell_token", "title": "Sell a Token"}],
            )

        token_index: dict = state.data.get("token_index") or {}
        await self._update(user_id, "select_token")

        rows = [
            {
                "id": key,
                # WhatsApp list row title cap = 24 chars; put chain in description.
                "title": h["token"][:24],
                "description": f"{h['qty']:.4g} on {h['chain']}",
            }
            for key, h in token_index.items()
        ]
        return FlowResponse(
            text="Select a token to sell:",
            list_button_text="Choose Token",
            list_sections=[{"title": "Held Tokens", "rows": rows}],
        )

    async def _step_select_token(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        token_index: dict = state.data.get("token_index") or {}
        holding = token_index.get(text)

        if holding is None:
            # Rebuild list from stored index.
            rows = [
                {
                    "id": key,
                    "title": h["token"][:24],
                    "description": f"{h['qty']:.4g} on {h['chain']}",
                }
                for key, h in token_index.items()
            ]
            return FlowResponse(
                text="Please select a token to manage:",
                list_button_text="Choose Token",
                list_sections=[{"title": "Held Tokens", "rows": rows}],
            )

        token = holding["token"]
        chain = holding["chain"]
        await self._update(
            user_id,
            "sell",
            {
                "token": token,
                "chain": chain,
                "chain_type": holding.get("chain_type"),
            },
        )

        return FlowResponse(
            text=f"*Manage {token}* on {chain}\n\nSell a portion into USDC on the same chain.\nHow much?",
            buttons=[
                {"id": "pos_sell_25", "title": "Sell 25%"},
                {"id": "pos_sell_50", "title": "Sell 50%"},
                {"id": "pos_sell_100", "title": "Sell 100%"},
            ],
        )

    async def _step_sell(
        self,
        user_id: str,
        user_db_id: int,
        text: str,
        state: ConversationState,
    ) -> FlowResponse:
        pct_map = {"pos_sell_25": 25, "pos_sell_50": 50, "pos_sell_100": 100}
        pct = pct_map.get(text)
        if pct is None:
            return FlowResponse(
                text="Please choose a sell percentage:",
                buttons=[
                    {"id": "pos_sell_25", "title": "Sell 25%"},
                    {"id": "pos_sell_50", "title": "Sell 50%"},
                    {"id": "pos_sell_100", "title": "Sell 100%"},
                ],
            )

        token: str = state.data.get("token", "")
        chain: str = state.data.get("chain", "")
        chain_type: str | None = state.data.get("chain_type")

        if not token or not chain or not chain_type:
            await self._clear(user_id)
            return FlowResponse(
                text="Session data missing. Type *pos* to start over.",
            )

        if token.upper() == "USDC":
            await self._clear(user_id)
            return FlowResponse(text="Already USDC — nothing to sell.")

        from bot.services.wallet import WalletService
        from bot.services.swap_engine import SwapEngine
        from bot.utils.formatters import format_amount

        _wallet_service = WalletService()
        _swap_engine = SwapEngine()

        db_uid: int = state.data.get("user_db_id") or user_db_id

        wallet = _wallet_service.get_default_wallet(db_uid, chain_type)
        if not wallet:
            await self._clear(user_id)
            return FlowResponse(text=f"No wallet found for {chain}. Set one up first.")

        # Fetch balance.
        try:
            balances = await _wallet_service.get_balances_by_address(wallet.address, chain_type)
        except Exception as exc:
            logger.error(f"PositionsFlow balance fetch failed: {exc}", exc_info=True)
            await self._clear(user_id)
            return FlowResponse(text="Could not fetch balance. Please try again.")

        token_balance = 0.0
        for chain_balances in balances.values():
            if token in chain_balances:
                token_balance = float(chain_balances[token] or 0)
                break

        if token_balance <= 0:
            await self._clear(user_id)
            return FlowResponse(text=f"No {token} balance found on {chain}.")

        amount = round(token_balance * pct / 100, 6)
        if amount <= 0:
            await self._clear(user_id)
            return FlowResponse(text="Amount too small to sell.")

        # Get quote.
        try:
            quote = await _swap_engine.get_quote(
                from_chain=chain,
                from_token=token,
                to_chain=chain,
                to_token="USDC",
                amount=amount,
                from_address=wallet.address,
            )
        except Exception as exc:
            logger.error(f"PositionsFlow quote failed: {exc}", exc_info=True)
            await self._clear(user_id)
            return FlowResponse(text="Error getting quote. Please try again.")

        if not quote:
            await self._clear(user_id)
            return FlowResponse(text=f"No route found to sell {token} into USDC on {chain}.")

        # Execute swap.
        attempt_id = secrets.token_urlsafe(16)
        try:
            swap_tx = await _swap_engine.execute_swap(
                quote=quote,
                wallet_id=wallet.id,
                user_id=db_uid,
                idempotency_key=f"wa_possell:{db_uid}:{wallet.id}:{attempt_id}",
            )
        except Exception as exc:
            logger.error(f"PositionsFlow execute_swap failed: {exc}", exc_info=True)
            await self._clear(user_id)
            return FlowResponse(text="An unexpected error occurred. Please try again.")

        await self._clear(user_id)

        if swap_tx and getattr(swap_tx, "tx_hash", None):
            return FlowResponse(
                text=(
                    f"*Sell Submitted!*\n\n"
                    f"Sold {pct}% of {token} ({format_amount(amount, symbol=token)}) -> USDC\n"
                    f"Transaction: {swap_tx.tx_hash[:20]}...\n\n"
                    f"Type *pos* to refresh your positions."
                ),
            )

        return FlowResponse(
            text=(
                "Sell submitted but transaction hash is missing. "
                "Please check your history in a moment."
            ),
        )


# Self-register
_flow = PositionsFlow()
register_flow("positions", _flow)
