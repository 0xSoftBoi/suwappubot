"""Live, stateful home hub.

Replaces the static WELCOME_MESSAGE with a LIVE snapshot of the user's working
state: portfolio USD + 24h PnL, open positions / alerts / pending orders counts,
and a state-driven contextual action row that surfaces the next best action
(earn on idle USDC, redeem a resolved prediction, or quick-trade).

Design rules (hard constraints):
  * Effect-free / read-only — this hub NEVER executes a swap or mutates state.
  * render-instant-then-edit — paint the fast local-DB snapshot immediately, then
    fetch the RPC-bound balances/savings in the background and edit the message
    with the full hub (mirrors start.py's _provision_wallets_and_update).
  * Every external fetch degrades gracefully — a failure shows "—" or omits a
    line, never crashes the hub. The hub renders even for a brand-new zero-state.
"""

from __future__ import annotations

import asyncio
import logging

from telegram import Message, Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes

from bot import __version__
from bot.models.user import User
from bot.models.predict import PredictionPosition
from database.db import get_session
from bot.services.wallet import WalletService
from bot.services.alerts import alert_service
from bot.services.orders import order_service
from bot.services.savings_service import savings_service

logger = logging.getLogger(__name__)

wallet_service = WalletService()


# ---------------------------------------------------------------------------
# small formatters (mirror positions.py conventions)
# ---------------------------------------------------------------------------
def _fmt_usd(v: float) -> str:
    sign = "-" if v < 0 else ""
    a = abs(v)
    if a >= 1000:
        return f"{sign}${a:,.0f}"
    return f"{sign}${a:,.2f}"


def _resolve_db_user_id(telegram_id: int) -> int | None:
    """Map a Telegram user id to the internal DB user id."""
    try:
        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == telegram_id).first()
            return db_user.id if db_user else None
    except Exception as e:
        logger.debug(f"home: could not resolve db user for {telegram_id}: {e}")
        return None


# ---------------------------------------------------------------------------
# fast local-DB snapshot (no RPC) — drives the instant first paint
# ---------------------------------------------------------------------------
def _fast_state(user_id: int) -> dict:
    """Collect counts + claimable predictions purely from local DB (no RPC).

    Every field degrades to a safe zero/None on failure so the hub always paints.
    """
    state = {
        "alerts": 0,
        "limit_orders": 0,
        "dca_orders": 0,
        "open_predictions": 0,
        "claimable_count": 0,
        "claimable_usd": 0.0,
    }

    try:
        state["alerts"] = len(alert_service.get_user_alerts(user_id, active_only=True) or [])
    except Exception as e:
        logger.debug(f"home: alerts count failed: {e}")

    try:
        state["limit_orders"] = len(order_service.get_user_orders(user_id) or [])
    except Exception as e:
        logger.debug(f"home: limit orders count failed: {e}")

    try:
        state["dca_orders"] = len(
            order_service.get_user_dca_orders(user_id, active_only=True) or []
        )
    except Exception as e:
        logger.debug(f"home: dca orders count failed: {e}")

    try:
        with get_session() as session:
            state["open_predictions"] = (
                session.query(PredictionPosition)
                .filter(
                    PredictionPosition.user_id == user_id,
                    PredictionPosition.total_shares > 0,
                    PredictionPosition.is_resolved == False,  # noqa: E712
                )
                .count()
            )
            claimable = (
                session.query(PredictionPosition)
                .filter(
                    PredictionPosition.user_id == user_id,
                    PredictionPosition.is_resolved == True,  # noqa: E712
                    PredictionPosition.resolved_payout > 0,
                )
                .all()
            )
            state["claimable_count"] = len(claimable)
            state["claimable_usd"] = sum(float(p.resolved_payout or 0) for p in claimable)
    except Exception as e:
        logger.debug(f"home: prediction state failed: {e}")

    return state


# ---------------------------------------------------------------------------
# 24h PnL — lightweight roll-up, degrades to None if unavailable
# ---------------------------------------------------------------------------
async def _pnl_24h(user_id: int) -> float | None:
    """Cheap best-effort 24h realized swap PnL. Returns None on any failure."""
    try:
        from bot.services.pnl import pnl_service

        data = await pnl_service.calculate_swap_pnl(user_id, days=1)
        if not data or data.get("swap_count", 0) == 0:
            return None
        return float(data.get("total_pnl_usd", 0.0))
    except Exception as e:
        logger.debug(f"home: 24h pnl failed: {e}")
        return None


# ---------------------------------------------------------------------------
# balances / savings — RPC-bound, run only on the second (edit) paint
# ---------------------------------------------------------------------------
async def _portfolio_usd(user_id: int) -> float | None:
    """Sum spot USD across the user's active wallets. None on failure/no wallets."""
    try:
        from bot.services.price_service import price_service

        wallets = wallet_service.get_user_wallets(user_id)
        if not wallets:
            return None

        # Fetch every wallet's balances concurrently (was a serial loop —
        # 3 wallets x ~600ms Alchemy = 1.8s on the hottest path in the bot).
        # A failed RPC on one wallet degrades to {} instead of zeroing the
        # whole portfolio (same shape as balance.py's fetch_wallet_balance).
        async def _fetch(w):
            try:
                return await wallet_service.get_balances_by_address(w.address, w.chain_type)
            except Exception as e:
                logger.debug(f"home: balance fetch failed for wallet {w.id}: {e}")
                return {}

        balance_results = await asyncio.gather(
            *[_fetch(w) for w in wallets], return_exceptions=True
        )

        all_balances: dict[str, dict[str, float]] = {}
        for balances in balance_results:
            if isinstance(balances, Exception) or not balances:
                continue
            for chain, tokens in balances.items():
                bucket = all_balances.setdefault(chain, {})
                for token, amount in tokens.items():
                    bucket[token] = bucket.get(token, 0.0) + float(amount or 0)

        all_tokens: set[str] = set()
        for tokens in all_balances.values():
            all_tokens.update(tokens.keys())
        if not all_tokens:
            return 0.0

        prices = await price_service.get_prices(list(all_tokens))
        total = 0.0
        for tokens in all_balances.values():
            for token, amount in tokens.items():
                total += float(amount or 0) * float(prices.get(token, 0) or 0)
        return total
    except Exception as e:
        logger.debug(f"home: portfolio usd failed: {e}")
        return None


async def _idle_usdc_and_apy(user_id: int) -> tuple[float, float | None]:
    """Idle (un-supplied) USDC on Base + current Aave APY.

    savings_service calls are SYNC blocking RPC, so wrap in asyncio.to_thread.
    Returns (idle_usdc, apy) with idle_usdc=0.0 and apy=None on any failure.
    """
    try:
        wallet = wallet_service.get_default_wallet(user_id, "evm")
        if not wallet:
            return 0.0, None
        idle = await asyncio.to_thread(savings_service.get_usdc_balance, wallet.address)
        idle_f = float(idle or 0)
    except Exception as e:
        logger.debug(f"home: idle usdc failed: {e}")
        return 0.0, None

    apy: float | None = None
    try:
        apy = await asyncio.to_thread(savings_service.get_apy)
    except Exception as e:
        logger.debug(f"home: apy failed: {e}")
        apy = None
    return idle_f, apy


# ---------------------------------------------------------------------------
# keyboard composition — main grid + a state-driven contextual row
# ---------------------------------------------------------------------------
def _contextual_row(
    idle_usdc: float,
    apy: float | None,
    claimable_count: int,
    claimable_usd: float,
    portfolio_usd: float | None = None,
) -> list[InlineKeyboardButton]:
    """Decide the single contextual action row from live state.

    Priority:
      1. claimable prediction exists -> Redeem (highest-value, time-sensitive).
      2. confirmed zero portfolio balance -> Deposit + Trending (no funds
         required to browse trending tokens while a deposit lands; offering
         "Swap" here is guaranteed to fail with "Insufficient funds").
      3. idle USDC > $50 -> Earn on idle cash (the discovery payoff).
      4. else -> default quick actions (Swap / Positions / Trending).
    """
    if claimable_count > 0 and claimable_usd > 0:
        return [
            InlineKeyboardButton(
                f"🎁 Redeem {_fmt_usd(claimable_usd)}", callback_data="pred_positions"
            )
        ]
    if portfolio_usd is not None and portfolio_usd <= 0:
        return [
            InlineKeyboardButton("📥 Deposit", callback_data="wallet_menu"),
            InlineKeyboardButton("🔥 Trending", callback_data="trending_open"),
        ]
    if idle_usdc > 50 and apy is not None:
        return [
            InlineKeyboardButton(
                f"🏦 Earn {apy:.1f}% on {_fmt_usd(idle_usdc)}", callback_data="save_menu"
            )
        ]
    # Default quick actions. "trending_open" IS registered (bot/main.py ~line
    # 502, CallbackQueryHandler(trending_open_callback, pattern="^trending_open$")).
    return [
        InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
        InlineKeyboardButton("💼 Positions", callback_data="positions_menu"),
        InlineKeyboardButton("🔥 Trending", callback_data="trending_open"),
    ]


def _home_keyboard(
    idle_usdc: float = 0.0,
    apy: float | None = None,
    claimable_count: int = 0,
    claimable_usd: float = 0.0,
    portfolio_usd: float | None = None,
) -> InlineKeyboardMarkup:
    """Compose the hub keyboard: refresh + contextual row + the main grid.

    The main grid is intentionally kept identical to start._build_main_keyboard()
    so existing muscle memory and every wired callback keep working.
    """
    rows: list[list[InlineKeyboardButton]] = [
        [InlineKeyboardButton(f"━━ 🌸 SUWAPPU v{__version__} ━━", callback_data="noop")],
        [
            InlineKeyboardButton("🔄 Refresh", callback_data="home_refresh"),
            InlineKeyboardButton("📥 Deposit", callback_data="wallet_menu"),
        ],
        _contextual_row(idle_usdc, apy, claimable_count, claimable_usd, portfolio_usd),
        [
            InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
            InlineKeyboardButton("⚡ Quick Swap", callback_data="quickswap_menu"),
        ],
        [
            InlineKeyboardButton("📈 Perps", callback_data="perps_open"),
            InlineKeyboardButton("🔮 Predictions", callback_data="predict_open"),
        ],
        [
            InlineKeyboardButton("🏦 Savings (Earn)", callback_data="save_menu"),
            InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
        ],
        [
            InlineKeyboardButton("👛 Wallets", callback_data="wallet_menu"),
            InlineKeyboardButton("💰 Balance", callback_data="balance"),
        ],
        [
            InlineKeyboardButton("💼 Positions", callback_data="positions_menu"),
            InlineKeyboardButton("📜 History", callback_data="history_menu"),
        ],
        [
            InlineKeyboardButton("📂 More...", callback_data="more_menu"),
            InlineKeyboardButton("⚙️ Settings", callback_data="settings_menu"),
        ],
    ]
    return InlineKeyboardMarkup(rows)


# ---------------------------------------------------------------------------
# text composition
# ---------------------------------------------------------------------------
def _compose_text(
    state: dict,
    portfolio_usd: float | None,
    pnl_24h: float | None,
    refreshing: bool,
) -> str:
    """Build the hub text. `refreshing=True` shows a balances-pending placeholder."""
    lines = ["🌸 *Suwappu — Home*\n"]

    # Balance + 24h PnL header
    if refreshing:
        lines.append("💰 *Balance:* _refreshing…_")
    elif portfolio_usd is None:
        lines.append("💰 *Balance:* —")
    else:
        lines.append(f"💰 *Balance:* {_fmt_usd(portfolio_usd)}")

    if pnl_24h is not None:
        emoji = "🟢" if pnl_24h >= 0 else "🔴"
        sign = "+" if pnl_24h >= 0 else "−"
        lines.append(f"📊 *24h PnL:* {emoji} {sign}{_fmt_usd(abs(pnl_24h))}")

    # Working-state summary line
    bits: list[str] = []
    n_positions = int(state.get("open_predictions", 0))
    if n_positions:
        bits.append(f"🔮 {n_positions} prediction{'s' if n_positions != 1 else ''}")
    n_orders = int(state.get("limit_orders", 0)) + int(state.get("dca_orders", 0))
    if n_orders:
        bits.append(f"⏳ {n_orders} order{'s' if n_orders != 1 else ''}")
    n_alerts = int(state.get("alerts", 0))
    if n_alerts:
        bits.append(f"🔔 {n_alerts} alert{'s' if n_alerts != 1 else ''}")
    if bits:
        lines.append("\n" + "  ·  ".join(bits))

    claimable_count = int(state.get("claimable_count", 0))
    if claimable_count:
        lines.append(
            f"\n🎁 *{claimable_count} resolved prediction"
            f"{'s' if claimable_count != 1 else ''}* "
            f"({_fmt_usd(float(state.get('claimable_usd', 0.0)))} to redeem)"
        )

    if not bits and not claimable_count and not refreshing and not portfolio_usd:
        lines.append("\n_Deposit funds to start trading — tap 📥 Deposit below._")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# public entry points
# ---------------------------------------------------------------------------
async def render_home(user_id: int, state: dict | None = None) -> tuple[str, InlineKeyboardMarkup]:
    """Compose the FULL live hub (text + keyboard) including RPC-bound balances.

    Safe to call directly when a blocking render is acceptable (e.g. a refresh
    where the user expects a spinner). For first paint, prefer the
    render-instant-then-edit flow in `send_home`.

    `state` may be an already-computed `_fast_state()` snapshot (e.g. the one
    `send_home` already fetched for the instant first paint) to avoid running
    the same ~4 blocking DB sessions twice per render cycle. Pass None to
    compute a fresh snapshot (default — used by direct/refresh callers).
    """
    if state is None:
        state = _fast_state(user_id)

    # Fetch the slow/RPC pieces concurrently; each already degrades gracefully.
    portfolio_usd, pnl, (idle_usdc, apy) = await asyncio.gather(
        _portfolio_usd(user_id),
        _pnl_24h(user_id),
        _idle_usdc_and_apy(user_id),
    )

    text = _compose_text(state, portfolio_usd, pnl, refreshing=False)
    keyboard = _home_keyboard(
        idle_usdc=idle_usdc,
        apy=apy,
        claimable_count=int(state.get("claimable_count", 0)),
        claimable_usd=float(state.get("claimable_usd", 0.0)),
        portfolio_usd=portfolio_usd,
    )
    return text, keyboard


async def _fill_home_in_background(
    user_id: int, message: Message, state: dict | None = None
) -> None:
    """Second paint: fetch full live state and edit the already-sent message.

    `state` reuses the fast-snapshot already computed by `send_home` for the
    first paint — see `render_home` for why this is safe to reuse rather than
    re-querying (the counts are local-DB-only and the gap between the two
    paints is the RPC round-trip, not user-perceptible drift).
    """
    try:
        text, keyboard = await render_home(user_id, state=state)
        await message.edit_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception:
        logger.exception(f"home: background fill failed for user {user_id}")


async def send_home(
    user_id: int,
    *,
    edit_message: Message | None = None,
    send_func=None,
) -> None:
    """render-instant-then-edit entry point.

    1. Paint the fast local-DB snapshot immediately (no RPC) with a
       "refreshing…" balance line and a static keyboard.
    2. Kick off the RPC-bound balances/savings/PnL fetch in the background and
       edit the same message with the full hub.

    Pass either `edit_message` (a Message to edit in place) OR `send_func`
    (an awaitable callable taking text/parse_mode/reply_markup that returns the
    sent Message), mirroring start.py's callback vs command split.
    """
    state = _fast_state(user_id)
    fast_text = _compose_text(state, portfolio_usd=None, pnl_24h=None, refreshing=True)
    fast_keyboard = _home_keyboard(
        claimable_count=int(state.get("claimable_count", 0)),
        claimable_usd=float(state.get("claimable_usd", 0.0)),
    )

    sent: Message | None = None
    if edit_message is not None:
        try:
            result = await edit_message.edit_text(
                fast_text, parse_mode="Markdown", reply_markup=fast_keyboard
            )
            sent = result if isinstance(result, Message) else edit_message
        except Exception:
            logger.debug("home: instant edit failed; falling back to full render")
            sent = edit_message
    elif send_func is not None:
        try:
            sent = await send_func(
                text=fast_text, parse_mode="Markdown", reply_markup=fast_keyboard
            )
        except Exception:
            logger.exception(f"home: instant send failed for user {user_id}")
            return

    if isinstance(sent, Message):
        asyncio.create_task(_fill_home_in_background(user_id, sent, state=state))


async def home_refresh_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Re-run render_home and edit the message in place (read-only)."""
    query = update.callback_query
    await query.answer()

    user_id = _resolve_db_user_id(update.effective_user.id)
    if user_id is None:
        await query.edit_message_text("❌ Please use /start first.")
        return

    await send_home(user_id, edit_message=query.message)
