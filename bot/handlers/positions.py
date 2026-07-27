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
from bot.utils.formatters import format_amount, format_usd
from bot.utils.telegram_safe import safe_md, send_md_safe
from bot.utils.cache import quote_cache

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

    # Batch all held-token prices into ONE get_prices() call instead of a
    # get_price() call per token inside this loop — each call serialized
    # behind a 1-req/sec CoinGecko rate limiter, so N held tokens meant N
    # seconds of pure rate-limit wait before /pos could render. A token that's
    # missing from the batched response still resolves to None (get_prices
    # sets it explicitly), so the "skip if no price" behavior below — and
    # every displayed number — is unchanged.
    try:
        prices = await price_service.get_prices([t for t, _, _, _ in held]) if held else {}
    except Exception:
        prices = {}

    for token, chain, qty, cost in held:
        price = prices.get(token.upper())
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

        # Resolved winners aren't auto-redeemed for EOAs — keep their claimable
        # value (1:1 pUSD) in the portfolio instead of dropping them post-resolution.
        claimable = (
            session.query(PredictionPosition)
            .filter(
                PredictionPosition.user_id == user_id,
                PredictionPosition.is_resolved == True,  # noqa: E712
                PredictionPosition.resolved_payout > 0,
            )
            .all()
        )
        if claimable:
            claimable_total = sum(float(p.resolved_payout or 0) for p in claimable)
            total_value += claimable_total
            pred_lines.append(
                f"🏆 {len(claimable)} resolved · {_fmt_usd(claimable_total)} claimable"
            )
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

    # Optimistic interim edit — building positions does multi-second
    # balance/price fetches; the final send_md_safe edit replaces this fully.
    if update.callback_query:
        try:
            await update.callback_query.edit_message_text("⏳ Loading positions…")
        except Exception:
            pass

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
#
# Flow is PREVIEW -> CONFIRM, mirroring quickswap.py / swap.py. A single tap on
# "Sell X%" used to run get_quote() then execute_swap() back-to-back with only
# progress messages in between — the user never saw the output amount, price
# impact, fee, or minimum received before their tokens were sold. This is ONE
# tap from /pos, so it now stops at a preview card with an explicit
# Confirm/Cancel gate before anything executes.
#
# The quote is NOT stashed in context.user_data — PicklePersistence
# periodically re-serializes user_data, and quote blobs there are a known
# problem. Instead the quote (plus the exact amount/wallet/user it was
# fetched for) rides in the existing `quote_cache` (bot/utils/cache.py, TTL
# matched to the quote's own declared validity) under a short, deterministic
# key built from the SAME opaque `key` already used for the pos_manage
# lookup, combined with the pct. Only that key + pct — both already present
# in the "Sell X%" button's callback_data — ride in the new confirm button's
# callback_data; no new random id is needed, and the pct is never re-parsed
# from a string on the confirm leg (see pos_sell_confirm_callback).

_SELL_PCTS = (25, 50, 100)

# Namespaced so this can never collide with swap.py's own quote_cache keys
# ("quote:...", "prewarm:...").
_POS_SELL_CACHE_PREFIX = "possell_quote:"


def _pos_sell_cache_key(key: str, pct: int) -> str:
    return f"{_POS_SELL_CACHE_PREFIX}{key}:{pct}"


# Upper bound on the confirm window. Must stay under the 30s freshness limit
# execute_swap enforces via quote_validator, since this TTL starts after the
# quote's own timestamp.
_POS_SELL_MAX_QUOTE_TTL = 25

# How long a consumed entry is remembered so a duplicate tap is recognised as
# "already submitted" rather than "expired". Comfortably longer than a swap
# takes to broadcast.
_POS_SELL_TOMBSTONE_TTL = 180


def _to_human_min_out(quote) -> float | None:
    """Convert the quote's enforced minimum output into human units.

    ``to_amount_min`` and ``to_amount`` are both raw base-unit strings for the
    SAME token, so scaling by their ratio avoids needing the token's decimals
    and can't disagree with how the provider computed the minimum. Returns
    None if the provider gave us nothing usable — never raises, because a
    display helper must not be able to block a sell.
    """
    try:
        raw_min = int(quote.to_amount_min)
        raw_out = int(quote.to_amount)
        if raw_min <= 0 or raw_out <= 0:
            return None
        return quote.to_amount_human * (raw_min / raw_out)
    except (TypeError, ValueError, AttributeError):
        return None


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
    """Entry point for 'Sell X%' — parses the selection then renders a
    preview card. No execution happens here (see pos_sell_confirm_callback).
    """
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

    await _render_pos_sell_preview(update, context, key=key, token=token, chain=chain, pct=pct)


async def _render_pos_sell_preview(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    key: str,
    token: str,
    chain: str,
    pct: int,
) -> None:
    """Fetch balance + quote for a token -> USDC sell and render a preview
    card with an explicit Confirm/Cancel gate. Caches the quote — plus the
    exact amount/wallet/user it was fetched for — so confirm executes against
    the SAME numbers the user saw, never a re-derived guess.

    Called both from the initial "Sell X%" tap and from the confirm handler
    when the cached quote has expired (re-quote-and-re-preview path).
    """
    query = update.callback_query

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
            # Without user_id the engine can't look up the caller's tier and
            # falls back to the default fee — so a PRO/PREMIUM user selling
            # from /pos was quoted (and charged) the flat rate.
            user_id=user_id,
        )
    except Exception as e:
        logger.error(f"pos_sell quote failed: {e}", exc_info=True)
        await send_md_safe(update, "❌ Error getting quote. Please try again.")
        return

    if not quote:
        await send_md_safe(update, f"❌ No route found to sell {safe_md(token)} into USDC.")
        return

    # Cache the quote (+ everything execution needs) under a deterministic key
    # so confirm can look it up from just `key` + `pct` — both already carried
    # in the button's callback_data, so no extra random id is needed.
    #
    # The TTL must stay STRICTLY INSIDE what execute_swap will accept:
    # quote_validator.validate_quote_freshness rejects a quote older than 30s
    # measured from quote.timestamp, and this cache TTL starts later than that
    # timestamp. A window wider than the validator's just guarantees a
    # confirm that gets rejected downstream, so cap well under 30s.
    ttl = max(10, min(int(getattr(quote, "expires_in", 25) or 25), _POS_SELL_MAX_QUOTE_TTL))
    attempt_id = secrets.token_urlsafe(16)
    await quote_cache.set(
        _pos_sell_cache_key(key, pct),
        {
            "token": token,
            "chain": chain,
            "pct": pct,
            "amount": amount,
            "quote": quote,
            "wallet_id": wallet.id,
            "user_id": user_id,
            "attempt_id": attempt_id,
        },
        ttl=ttl,
    )

    rate = (
        quote.exchange_rate
        if quote.exchange_rate
        else (quote.to_amount_human / amount if amount > 0 else 0)
    )
    # Same fallback swap.py's confirm screen uses — pos_sell never overrides
    # slippage on get_quote(), so this is the actual 0.5% default in effect,
    # not an invented number.
    slippage_pct = quote.raw_quote.get("slippage") or 0.5
    # Prefer the quote's OWN to_amount_min — that is the minimum the on-chain
    # transaction actually enforces, and providers derive it differently per
    # route. Recomputing it from the displayed slippage would put a number on
    # a "Minimum Received" line that the chain will not honour. Fall back to
    # the derived value only when the provider didn't supply one.
    min_received = _to_human_min_out(quote)
    if min_received is None:
        min_received = quote.to_amount_human * (1 - slippage_pct / 100)

    text = (
        f"💱 *Confirm Sell*\n\n"
        f"📤 *From:* {format_amount(amount, symbol=token)} ({safe_md(chain)})\n"
        f"📥 *To:* ~{format_amount(quote.to_amount_human, symbol='USDC')} ({safe_md(chain)})\n\n"
        f"💱 *Rate:* 1 {safe_md(token)} ≈ {rate:.6f} USDC\n"
        f"📊 *Price Impact:* {quote.price_impact:.2f}%\n"
        f"🛡️ *Minimum Received:* ~{format_amount(min_received, symbol='USDC')}\n"
        f"📉 *Max Slippage:* {slippage_pct}%\n"
        f"⛽ *Gas:* {format_usd(quote.gas_cost_usd)}\n"
    )
    if quote.fee_cost_usd and quote.fee_cost_usd > 0:
        text += f"🌉 *Bridge/Provider Fee:* {format_usd(quote.fee_cost_usd)}\n"
    text += (
        f"\n💵 *Total Fees:* {format_usd(quote.total_cost_usd)}\n\n"
        f"⚠️ Review carefully — this executes an on-chain sell and cannot be undone."
    )

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("✅ Confirm Sell", callback_data=f"possx_{key}_{pct}"),
                InlineKeyboardButton("❌ Cancel", callback_data="positions_refresh"),
            ],
        ]
    )
    await send_md_safe(update, text, keyboard)


async def pos_sell_confirm_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Execute a previously-previewed token -> USDC sell via the guarded swap
    path. Only reachable from the Confirm button rendered by
    `_render_pos_sell_preview`.
    """
    query = update.callback_query
    await query.answer()

    raw = query.data[len("possx_") :]
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

    user = update.effective_user
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await send_md_safe(update, "❌ Please use /start first.")
            return
        user_id = db_user.id

    cache_key = _pos_sell_cache_key(key, pct)
    blob = await quote_cache.get(cache_key)

    # A consumed entry leaves a TOMBSTONE rather than vanishing, because
    # "already submitted" and "quote expired" are otherwise indistinguishable
    # — and re-previewing an already-submitted sell is how a double-tap turns
    # into a SECOND on-chain sell: tap 1 consumes and starts a multi-second
    # execute_swap, tap 2 misses, re-quotes off the not-yet-settled balance,
    # and offers a fresh Confirm button with a NEW attempt_id (so the
    # idempotency key differs and does not stop it).
    if blob and blob.get("consumed"):
        await query.answer("Already submitted — check 📜 History.", show_alert=True)
        return

    # Missing/expired entry, or a mismatched user (defense in depth — the key
    # is only ever handed to the user who generated it): never execute against
    # stale or unverified numbers. Re-quote and re-preview so the user
    # re-confirms fresh numbers rather than seeing a dead end.
    if not blob or blob.get("user_id") != user_id:
        await send_md_safe(update, "⏳ Quote expired — refreshing with a new one...")
        await _render_pos_sell_preview(update, context, key=key, token=token, chain=chain, pct=pct)
        return

    # Claim-and-consume. There is no await between the get() above and this
    # write, so two concurrent confirms cannot both observe the live blob.
    await quote_cache.set(cache_key, {"consumed": True}, ttl=_POS_SELL_TOMBSTONE_TTL)

    quote = blob["quote"]
    amount = blob["amount"]
    wallet_id = blob["wallet_id"]
    attempt_id = blob["attempt_id"]

    await send_md_safe(
        update,
        f"⏳ Selling {pct}% = *{format_amount(amount, symbol=token)}* → USDC...",
    )

    try:
        swap_tx = await swap_engine.execute_swap(
            quote=quote,
            wallet_id=wallet_id,
            user_id=user_id,
            idempotency_key=f"tg_possell:{user_id}:{wallet_id}:{attempt_id}",
        )
    except Exception as e:
        logger.error(f"pos_sell execute failed: {e}", exc_info=True)
        # A quote that went stale between preview and confirm is expected, not
        # exceptional — the engine re-checks freshness independently of our
        # cache TTL. Route it back to a fresh preview instead of a dead-end
        # error, since we already consumed the tombstone and the user would
        # otherwise have no way forward.
        if "expired" in str(e).lower():
            await quote_cache.delete(cache_key)
            await send_md_safe(update, "⏳ Quote expired — refreshing with a new one...")
            await _render_pos_sell_preview(
                update, context, key=key, token=token, chain=chain, pct=pct
            )
            return
        # The tombstone is deliberately left in place: the transaction may have
        # been broadcast before the error, so re-tapping THIS button must not
        # fire a second sell. Reopening Positions mints a fresh key (and so a
        # fresh cache entry), which is the safe way to retry — point there
        # rather than saying "try again" about a button that is now inert.
        await send_md_safe(
            update,
            "❌ The sell could not be completed. Check 📜 History to confirm "
            "nothing went through, then reopen Positions to try again.",
            InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("📜 History", callback_data="history")],
                    [InlineKeyboardButton("« Positions", callback_data="positions_refresh")],
                ]
            ),
        )
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
pos_sell_confirm_callback_handler = CallbackQueryHandler(
    pos_sell_confirm_callback, pattern="^possx_"
)
