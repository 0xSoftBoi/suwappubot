"""Unified Positions / PnL hub.

One screen that aggregates everything the user has working across the protocol —
spot holdings (with cost-basis PnL), perps, prediction markets, and open orders —
with a total portfolio PnL header. No competitor meme-bot shows perps +
predictions + spot together; this is our edge.
"""

import logging
import re

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.error import BadRequest
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from database.db import get_session
from bot.models.user import User
from bot.models.positions import UserPosition
from bot.models.predict import PredictionPosition
from bot.services.price_service import price_service
from bot.services.perps_service import perps_service
from bot.services.orders import order_service

logger = logging.getLogger(__name__)


def _safe(s) -> str:
    """Strip Telegram legacy-Markdown control chars from dynamic/external text
    (Polymarket questions, token symbols) so it can't break parse_mode rendering.
    Stripping (not escaping) keeps truncation safe — no orphaned control char."""
    return re.sub(r"[_*`\[\]]", "", str(s or ""))


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


async def _build_positions(user_id: int) -> str:
    """Aggregate spot + perps + predictions + orders into a single report."""
    total_value = 0.0
    total_unrealized = 0.0
    realized_spot = 0.0
    sections: list[str] = []

    # ---- Spot (cost-basis PnL from UserPosition) ----
    spot_lines: list[str] = []
    with get_session() as session:
        rows = session.query(UserPosition).filter(
            UserPosition.user_id == user_id,
        ).all()
        # Sum realized PnL across all tracked tokens (incl. fully-closed rows).
        realized_spot = sum(float(r.realized_pnl_usd or 0.0) for r in rows)
        held = [(r.token, r.chain, float(r.qty or 0), float(r.cost_usd or 0))
                for r in rows if float(r.qty or 0) > 1e-9]

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
        spot_lines.append(f"{_pnl_str(unreal, cost).split()[0]} {_safe(token)} {qty:.4g} ({_fmt_usd(value)})  {_pnl_str(unreal, cost)[2:]}")

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
        preds = session.query(PredictionPosition).filter(
            PredictionPosition.user_id == user_id,
            PredictionPosition.total_shares > 0,
            PredictionPosition.is_resolved == False,  # noqa: E712
        ).order_by(PredictionPosition.created_at.desc()).limit(10).all()
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
        dca_orders = [o for o in (order_service.get_user_dca_orders(user_id) or [])
                      if str(getattr(o, "status", "")) == "active"]
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

    return header + "\n" + "\n\n".join(sections)


def _positions_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🔄 Refresh", callback_data="positions_refresh")],
        [
            InlineKeyboardButton("📈 Perps", callback_data="perps_open"),
            InlineKeyboardButton("🔮 Predictions", callback_data="predict_open"),
        ],
        [
            InlineKeyboardButton("📈 Orders", callback_data="limit_orders_menu"),
            InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
        ],
        [InlineKeyboardButton("« Back to Main", callback_data="main_menu")],
    ])


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

    try:
        text = await _build_positions(user_id)
    except Exception as e:
        logger.error(f"Positions build failed: {e}", exc_info=True)
        text = "💼 *Your Positions*\n\n_Could not load positions right now. Please try again._"

    await _send(update, text, _positions_keyboard())


async def _send(update: Update, text: str, markup: InlineKeyboardMarkup) -> None:
    """Render the positions message, falling back to plain text if Markdown
    fails to parse (dynamic external content) — applied to both the command
    (reply) and button (edit) paths. 'Message is not modified' on refresh is
    benign and ignored; a parse failure retries WITHOUT parse_mode rather than
    silently no-op'ing."""
    cq = update.callback_query
    try:
        if cq:
            await cq.edit_message_text(text, parse_mode="Markdown", reply_markup=markup)
        else:
            await update.effective_message.reply_text(text, parse_mode="Markdown", reply_markup=markup)
    except BadRequest as e:
        if "not modified" in str(e).lower():
            return
        try:
            if cq:
                await cq.edit_message_text(text, reply_markup=markup)
            else:
                await update.effective_message.reply_text(text, reply_markup=markup)
        except Exception as e2:
            logger.warning(f"Positions send fallback failed: {e2}")


# Handlers
positions_command_handler = CommandHandler("pos", positions_command)
positions_menu_callback_handler = CallbackQueryHandler(positions_command, pattern="^positions_menu$")
positions_refresh_callback_handler = CallbackQueryHandler(positions_command, pattern="^positions_refresh$")
