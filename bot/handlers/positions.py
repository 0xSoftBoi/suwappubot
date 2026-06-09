"""Unified Positions / PnL hub.

One screen that aggregates everything the user has working across the protocol —
spot holdings (with cost-basis PnL), perps, prediction markets, and open orders —
with a total portfolio PnL header. No competitor meme-bot shows perps +
predictions + spot together; this is our edge.
"""

from __future__ import annotations

import logging
import secrets

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from database.db import get_session
from bot.models.user import User
from bot.models.positions import UserPosition
from bot.models.predict import PredictionPosition
from bot.services.price_service import price_service
from bot.services.perps_service import perps_service
from bot.services.orders import order_service
from bot.services.wallet import WalletService
from bot.services.swap_engine import SwapEngine
from bot.config.chains import get_chain_by_name
from bot.utils.formatters import format_amount
from bot.utils.telegram_safe import safe_md, send_md_safe

logger = logging.getLogger(__name__)

wallet_service = WalletService()
swap_engine = SwapEngine()

# Local alias kept so the rest of this module reads unchanged after the
# refactor to the shared helper. Behaviour is identical to the old _safe().
_safe = safe_md


def _fmt_usd(v: float) -> str:
    sign = "-" if v < 0 else ""
    a = abs(v)
    if a >= 1000:
        return f"{sign}${a:,.0f}"
    return f"{sign}${a:,.2f}"


def _pnl_str(pnl: float, cost: float) -> str:
    emoji = "🟢" if pnl >= 0 else "🔴"
    pct = (pnl / cost * 100.0) if cost > 0 else 0.0
    sign = "+" if pnl >= 0 else "−"
    return f"{emoji} {sign}{_fmt_usd(abs(pnl))} ({sign}{abs(pct):.1f}%)"


async def _build_positions(user_id: int) -> tuple[str, list[tuple[str, str]]]:
    """Aggregate spot + perps + predictions + orders into a single report.

    Returns the rendered text plus the list of held spot ``(token, chain)``
    tuples so the caller can render a "Manage <TOKEN>" button per holding.
    """
    total_value = 0.0
    total_unrealized = 0.0
    realized_spot = 0.0
    sections: list[str] = []
    managed_spot: list[tuple[str, str]] = []

    # ---- Spot (cost-basis PnL from UserPosition) ----
    spot_lines: list[str] = []
    with get_session() as session:
        rows = (
            session.query(UserPosition)
            .filter(
                UserPosition.user_id == user_id,
            )
            .all()
        )
        # Sum realized PnL across all tracked tokens (incl. fully-closed rows).
        realized_spot = sum(float(r.realized_pnl_usd or 0.0) for r in rows)
        held = [
            (r.token, r.chain, float(r.qty or 0), float(r.cost_usd or 0))
            for r in rows
            if float(r.qty or 0) > 1e-9
        ]

    for token, chain, qty, cost in held:
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
            f"{_pnl_str(unreal, cost).split()[0]} {_safe(token)} {qty:.4g} ({_fmt_usd(value)})  {_pnl_str(unreal, cost)[2:]}"
        )
        managed_spot.append((token, chain))

    if spot_lines:
        sections.append("— 💱 *Spot* —\n" + "\n".join(spot_lines[:12]))
    else:
        sections.append("— 💱 *Spot* —\n_No tracked spot positions yet — PnL builds as you swap._")

    # ---- Perps ----
    perps_lines: list[str] = []
    try:
        positions = perps_service.get_positions(user_id)
    except Exception:
        positions = []
    for pos in positions or []:
        upnl = float(getattr(pos, "unrealized_pnl", 0) or 0)
        margin = float(getattr(pos, "margin", 0) or 0)
        total_value += margin + upnl
        total_unrealized += upnl
        emoji = "🟢" if upnl >= 0 else "🔴"
        liq = float(getattr(pos, "liquidation_price", 0) or 0)
        liq_str = f" · liq ${liq:,.2f}" if liq else ""
        perps_lines.append(
            f"{emoji} {_safe(pos.market)} {_safe(str(pos.side)).upper()} {int(getattr(pos, 'leverage', 1) or 1)}x  "
            f"{_pnl_str(upnl, margin)[2:]}{liq_str}"
        )
    if perps_lines:
        sections.append("— 📈 *Perps* —\n" + "\n".join(perps_lines))

    # ---- Predictions ----
    pred_lines: list[str] = []
    with get_session() as session:
        preds = (
            session.query(PredictionPosition)
            .filter(
                PredictionPosition.user_id == user_id,
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
            q = _safe(p.market_question)[:32]
            emoji = "🟢" if pnl >= 0 else "🔴"
            pct = (pnl / cost * 100.0) if cost > 0 else 0.0
            sign = "+" if pnl >= 0 else "−"
            pred_lines.append(f'{emoji} "{q}" {p.outcome} {shares:.0f}sh  {sign}{abs(pct):.1f}%')
    if pred_lines:
        sections.append("— 🔮 *Predictions* —\n" + "\n".join(pred_lines))

    # ---- Open orders ----
    try:
        limit_orders = order_service.get_user_orders(user_id)
    except Exception:
        limit_orders = []
    try:
        dca_orders = [
            o
            for o in (order_service.get_user_dca_orders(user_id) or [])
            if str(getattr(o, "status", "")) == "active"
        ]
    except Exception:
        dca_orders = []
    n_orders = len(limit_orders or []) + len(dca_orders or [])
    if n_orders:
        bits = []
        if limit_orders:
            bits.append(f"{len(limit_orders)} limit")
        if dca_orders:
            bits.append(f"{len(dca_orders)} DCA")
        sections.append(f"— ⏳ *Open Orders* ({n_orders}) —\n" + " · ".join(bits))

    # ---- Header ----
    header = "💼 *Your Positions*\n\n"
    header += f"*Total Value:* {_fmt_usd(total_value)}\n"
    pnl_emoji = "🟢" if total_unrealized >= 0 else "🔴"
    psign = "+" if total_unrealized >= 0 else "−"
    header += f"*Unrealized PnL:* {pnl_emoji} {psign}{_fmt_usd(abs(total_unrealized))}\n"
    if abs(realized_spot) > 0.005:
        rsign = "+" if realized_spot >= 0 else "−"
        header += f"*Realized (spot):* {rsign}{_fmt_usd(abs(realized_spot))}\n"

    return header + "\n" + "\n\n".join(sections), managed_spot[:12]


def _positions_keyboard(
    context: ContextTypes.DEFAULT_TYPE = None, managed_spot: list[tuple[str, str]] | None = None
) -> InlineKeyboardMarkup:
    """Build the positions keyboard.

    A "Manage <TOKEN>" button is added per held spot position. Because a
    token+chain pair can exceed Telegram's 64-byte callback_data limit, the
    pair is stored in ``context.user_data["pos_manage"]`` under a short opaque
    key and only that key rides in the callback_data (``pos_manage_<key>``).
    """
    rows: list[list[InlineKeyboardButton]] = []

    if context is not None and managed_spot:
        ctx_map: dict[str, tuple[str, str]] = {}
        manage_row: list[InlineKeyboardButton] = []
        for token, chain in managed_spot:
            key = secrets.token_urlsafe(6)
            ctx_map[key] = (token, chain)
            manage_row.append(
                InlineKeyboardButton(
                    f"💱 Manage {safe_md(token)[:8]}", callback_data=f"pos_manage_{key}"
                )
            )
            if len(manage_row) == 2:
                rows.append(manage_row)
                manage_row = []
        if manage_row:
            rows.append(manage_row)
        context.user_data["pos_manage"] = ctx_map

    rows.append([InlineKeyboardButton("🔄 Refresh", callback_data="positions_refresh")])
    rows.extend(
        [
            [
                InlineKeyboardButton("📈 Perps", callback_data="perps_open"),
                InlineKeyboardButton("🔮 Predictions", callback_data="predict_open"),
            ],
            [
                InlineKeyboardButton("📈 Orders", callback_data="limit_orders_menu"),
                InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
            ],
            [InlineKeyboardButton("« Back to Main", callback_data="main_menu")],
        ]
    )
    return InlineKeyboardMarkup(rows)


async def positions_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show the unified Positions hub. Works as /pos command or the menu button."""
    if update.callback_query:
        await update.callback_query.answer()

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.effective_message.reply_text("❌ Please use /start first.")
            return
        user_id = db_user.id
        needs_backfill = db_user.positions_backfilled_at is None

    # One-time: seed spot cost-basis from swap history so existing holdings show
    # immediately instead of building up from the next swap. Best-effort.
    if needs_backfill:
        try:
            from bot.services.positions_service import backfill_user_positions

            await backfill_user_positions(user_id)
        except Exception as e:
            logger.warning(f"Positions backfill failed for {user_id}: {e}")

    managed_spot: list[tuple[str, str]] = []
    try:
        text, managed_spot = await _build_positions(user_id)
    except Exception as e:
        logger.error(f"Positions build failed: {e}", exc_info=True)
        text = "💼 *Your Positions*\n\n_Could not load positions right now. Please try again._"

    await send_md_safe(update, text, _positions_keyboard(context, managed_spot))


# ---------------------------------------------------------------------------
# Per-position Sell % quick actions
# ---------------------------------------------------------------------------
# Money path: every sell below routes token -> USDC on the SAME chain through
# swap_engine.get_quote + swap_engine.execute_swap (the guarded path), reusing
# the exact pattern from quickswap_confirm. No custom transaction is built.

_SELL_PCTS = (25, 50, 100)


def _resolve_chain_type(chain: str) -> str | None:
    cfg = get_chain_by_name(chain)
    return cfg.chain_type.value if cfg else None


async def pos_manage_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Drill-down for a single spot holding: offer Sell 25/50/100% -> USDC."""
    query = update.callback_query
    await query.answer()

    key = query.data[len("pos_manage_") :]
    ctx_map = context.user_data.get("pos_manage") or {}
    pair = ctx_map.get(key)
    if not pair:
        await query.answer("Session expired — reopen Positions.", show_alert=True)
        return
    token, chain = pair

    buttons = [
        InlineKeyboardButton(f"Sell {p}%", callback_data=f"pos_sell_{key}_{p}") for p in _SELL_PCTS
    ]
    keyboard = InlineKeyboardMarkup(
        [
            buttons,
            [InlineKeyboardButton("« Back", callback_data="positions_refresh")],
        ]
    )
    text = (
        f"💱 *Manage {safe_md(token)}* on {safe_md(chain)}\n\n"
        f"Sell a portion of your {safe_md(token)} into USDC on the same chain.\n"
        f"Pick an amount:"
    )
    await send_md_safe(update, text, keyboard)


async def pos_sell_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Execute a token -> USDC sell for the chosen % via the guarded swap path."""
    query = update.callback_query
    await query.answer()

    raw = query.data[len("pos_sell_") :]
    key, _, pct_str = raw.rpartition("_")
    try:
        pct = int(pct_str)
    except (TypeError, ValueError):
        await query.answer("Invalid selection.", show_alert=True)
        return

    ctx_map = context.user_data.get("pos_manage") or {}
    pair = ctx_map.get(key)
    if not pair:
        await query.answer("Session expired — reopen Positions.", show_alert=True)
        return
    token, chain = pair

    if token.upper() == "USDC":
        await query.answer("Already USDC — nothing to sell.", show_alert=True)
        return

    chain_type = _resolve_chain_type(chain)
    if not chain_type:
        await send_md_safe(update, f"❌ Unsupported chain: {safe_md(chain)}")
        return

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await send_md_safe(update, "❌ Please use /start first.")
            return
        user_id = db_user.id

    wallet = wallet_service.get_default_wallet(user_id, chain_type)
    if not wallet:
        await send_md_safe(update, f"❌ No wallet found for {safe_md(chain)}.")
        return

    await send_md_safe(update, f"🔄 Fetching balance for {safe_md(token)}...")

    # Balance for the token on this chain (same pattern as swap_pct_callback).
    try:
        balances = await wallet_service.get_balances_by_address(wallet.address, chain_type)
    except Exception as e:
        logger.error(f"pos_sell balance fetch failed: {e}", exc_info=True)
        await send_md_safe(update, "❌ Could not fetch balance. Please try again.")
        return

    token_balance = 0.0
    for chain_balances in balances.values():
        if token in chain_balances:
            token_balance = float(chain_balances[token] or 0)
            break

    if token_balance <= 0:
        await send_md_safe(update, f"❌ No {safe_md(token)} balance found on {safe_md(chain)}.")
        return

    amount = round(token_balance * pct / 100, 6)
    if amount <= 0:
        await send_md_safe(update, "❌ Amount too small to sell.")
        return

    await send_md_safe(update, f"🔄 Getting quote to sell {pct}% of {safe_md(token)}...")

    try:
        quote = await swap_engine.get_quote(
            from_chain=chain,
            from_token=token,
            to_chain=chain,
            to_token="USDC",
            amount=amount,
            from_address=wallet.address,
        )
    except Exception as e:
        logger.error(f"pos_sell quote failed: {e}", exc_info=True)
        await send_md_safe(update, "❌ Error getting quote. Please try again.")
        return

    if not quote:
        await send_md_safe(update, f"❌ No route found to sell {safe_md(token)} into USDC.")
        return

    await send_md_safe(
        update,
        f"⏳ Selling {pct}% = *{format_amount(amount, symbol=token)}* → USDC...",
    )

    attempt_id = secrets.token_urlsafe(16)
    try:
        swap_tx = await swap_engine.execute_swap(
            quote=quote,
            wallet_id=wallet.id,
            user_id=user_id,
            idempotency_key=f"tg_possell:{user_id}:{wallet.id}:{attempt_id}",
        )
    except Exception as e:
        logger.error(f"pos_sell execute failed: {e}", exc_info=True)
        await send_md_safe(update, "❌ An unexpected error occurred. Please try again.")
        return

    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("📜 History", callback_data="history")],
            [InlineKeyboardButton("« Positions", callback_data="positions_refresh")],
        ]
    )
    if swap_tx and getattr(swap_tx, "tx_hash", None):
        await send_md_safe(
            update,
            f"✅ *Sell Submitted!*\n\n"
            f"Sold {pct}% of {safe_md(token)} → USDC\n"
            f"Transaction: `{swap_tx.tx_hash[:20]}...`\n\n"
            f"Check status with /hx",
            keyboard,
        )
    else:
        await send_md_safe(
            update,
            "❌ Sell submitted but missing transaction hash. Please check /hx in a moment.",
            keyboard,
        )


# Handlers
positions_command_handler = CommandHandler("pos", positions_command)
positions_menu_callback_handler = CallbackQueryHandler(
    positions_command, pattern="^positions_menu$"
)
positions_refresh_callback_handler = CallbackQueryHandler(
    positions_command, pattern="^positions_refresh$"
)
pos_manage_callback_handler = CallbackQueryHandler(pos_manage_callback, pattern="^pos_manage_")
pos_sell_callback_handler = CallbackQueryHandler(pos_sell_callback, pattern="^pos_sell_")
