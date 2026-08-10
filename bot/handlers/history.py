"""Transaction history handlers."""

import logging
from typing import Optional
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler
from datetime import datetime

from bot.models.user import User
from bot.models.swap import SwapTransaction, SwapStatus
from bot.utils.formatters import format_amount, format_usd, format_tx_link, format_chain_name
from database.db import get_session
from bot.utils.tos_utils import enforce_tos
from bot.services.pnl import pnl_service

logger = logging.getLogger(__name__)

SWAPS_PER_PAGE = 5


@enforce_tos
async def history_command(
    update: Update, context: ContextTypes.DEFAULT_TYPE, page: int = 0
) -> None:
    """Handle /history command - show recent swap history with pagination."""
    user = update.effective_user

    # Determine reply method based on whether this is a callback or command
    if update.callback_query:
        # Instant-ack: stop the button spinner before any DB work
        await update.callback_query.answer()
        reply_func = update.callback_query.edit_message_text
    else:
        reply_func = update.message.reply_text

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await reply_func("❌ Please use /start first to set up your account.")
            return

        # Get total count
        total_swaps = (
            session.query(SwapTransaction).filter(SwapTransaction.user_id == db_user.id).count()
        )

        if total_swaps == 0:
            await reply_func(
                "📜 *Transaction History*\n\n" "No swaps yet. Use /s to make your first swap!",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("🔄 Start Swap", callback_data="swap_start")]]
                ),
            )
            return

        # Get paginated swaps
        swaps = (
            session.query(SwapTransaction)
            .filter(SwapTransaction.user_id == db_user.id)
            .order_by(SwapTransaction.created_at.desc())
            .offset(page * SWAPS_PER_PAGE)
            .limit(SWAPS_PER_PAGE)
            .all()
        )

        # Build history message
        lines = ["📜 *Transaction History*\n"]

        for swap in swaps:
            status_emoji = _get_status_emoji(swap.status)
            date_str = swap.created_at.strftime("%m/%d %H:%M")

            from_display = f"{swap.from_token}"
            to_display = f"{swap.to_token}"

            # Amount — use correct decimals for the token
            try:
                from bot.config.tokens import get_token_decimals

                decimals = get_token_decimals(swap.from_token, swap.from_chain) or 18
                from_amount = float(swap.from_amount) / (10**decimals) if swap.from_amount else 0
                amount_str = format_amount(from_amount)
            except Exception:
                amount_str = "?"

            line = f"{status_emoji} `{date_str}` " f"{amount_str} {from_display} → {to_display}"

            if swap.tx_hash:
                line += f"\n   └ {format_tx_link(swap.tx_hash, swap.from_chain)}"

            lines.append(line)
            lines.append("")

        total_pages = max(1, (total_swaps + SWAPS_PER_PAGE - 1) // SWAPS_PER_PAGE)
        lines.append(f"_Page {page + 1}/{total_pages} • {total_swaps} total swaps_")

        keyboard = []

        # Navigation buttons
        nav_buttons = []
        if page > 0:
            nav_buttons.append(
                InlineKeyboardButton("« Prev", callback_data=f"history_page_{page - 1}")
            )
        if (page + 1) * SWAPS_PER_PAGE < total_swaps:
            nav_buttons.append(
                InlineKeyboardButton("Next »", callback_data=f"history_page_{page + 1}")
            )
        if nav_buttons:
            keyboard.append(nav_buttons)

        # Share PnL buttons for the completed swaps on this page (up to 4), two
        # per row. Each routes to the read-only pnl_share_ callback, which renders
        # the branded card with the sharer's referral link + QR baked in. Capped
        # at 4 to keep the keyboard compact; the newest completed swaps come first
        # because `swaps` is already ordered created_at DESC.
        recent_completed = [s for s in swaps if s.status == SwapStatus.COMPLETED.value][:4]
        for i in range(0, len(recent_completed), 2):
            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"🖼️ Share {s.to_token}", callback_data=f"pnl_share_{s.id}"
                    )
                    for s in recent_completed[i : i + 2]
                ]
            )

        # Execution receipts for the completed swaps on this page. The scorer
        # has been marking these in production since phase 2 with nothing
        # reading them back — this is the surface that closes that loop.
        for i in range(0, len(recent_completed), 2):
            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"🧾 Receipt {s.to_token}", callback_data=f"exec_receipt_{s.id}"
                    )
                    for s in recent_completed[i : i + 2]
                ]
            )

        keyboard.append(
            [
                InlineKeyboardButton("🔄 New Swap", callback_data="swap_start"),
                InlineKeyboardButton("📊 Stats", callback_data="history_stats"),
            ]
        )
        keyboard.append([InlineKeyboardButton("« Back", callback_data="main_menu")])

        await reply_func(
            "\n".join(lines),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
            disable_web_page_preview=True,
        )


async def history_page_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle history pagination callbacks."""
    query = update.callback_query
    await query.answer()
    try:
        page = int(query.data.replace("history_page_", ""))
    except ValueError:
        page = 0
    await history_command(update, context, page=page)


async def history_stats_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show detailed swap statistics."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return

        from sqlalchemy import func, case as sa_case

        # Aggregate all stats in a single SQL query — avoids loading all rows into RAM
        row = (
            session.query(
                func.count(SwapTransaction.id).label("total"),
                func.sum(
                    sa_case((SwapTransaction.status == SwapStatus.COMPLETED.value, 1), else_=0)
                ).label("completed"),
                func.sum(
                    sa_case((SwapTransaction.status == SwapStatus.FAILED.value, 1), else_=0)
                ).label("failed"),
                func.coalesce(
                    func.sum(
                        sa_case(
                            (
                                SwapTransaction.status == SwapStatus.COMPLETED.value,
                                SwapTransaction.from_amount_usd,
                            ),
                            else_=None,
                        )
                    ),
                    0,
                ).label("volume"),
                func.coalesce(func.sum(SwapTransaction.gas_fee), 0).label("gas"),
                func.coalesce(func.sum(SwapTransaction.bridge_fee), 0).label("bridge"),
            )
            .filter(SwapTransaction.user_id == db_user.id)
            .one()
        )

        total_swaps = row.total or 0

        if not total_swaps:
            await query.edit_message_text(
                "📊 *Swap Statistics*\n\nNo swaps yet!", parse_mode="Markdown"
            )
            return

        completed = row.completed or 0
        failed = row.failed or 0
        pending = total_swaps - completed - failed
        total_volume = float(row.volume or 0)
        total_gas = float(row.gas or 0)
        total_bridge = float(row.bridge or 0)

        # Top pairs via SQL aggregation
        top_pairs_raw = (
            session.query(
                SwapTransaction.from_token,
                SwapTransaction.to_token,
                func.count(SwapTransaction.id).label("cnt"),
            )
            .filter(SwapTransaction.user_id == db_user.id)
            .group_by(
                SwapTransaction.from_token,
                SwapTransaction.to_token,
            )
            .order_by(func.count(SwapTransaction.id).desc())
            .limit(3)
            .all()
        )

        top_pairs = [(f"{r.from_token}→{r.to_token}", r.cnt) for r in top_pairs_raw]

        text = (
            f"📊 *Your Swap Statistics*\n\n"
            f"*Total Swaps:* {total_swaps}\n"
            f"  ✅ Completed: {completed}\n"
            f"  ❌ Failed: {failed}\n"
            f"  ⏳ Pending: {pending}\n\n"
            f"*Volume:* {format_usd(total_volume)}\n"
            f"*Fees Paid:*\n"
            f"  ⛽ Gas: {format_usd(total_gas)}\n"
            f"  🌉 Bridge: {format_usd(total_bridge)}\n\n"
            f"*Top Pairs:*\n"
        )

        for pair, count in top_pairs:
            text += f"  • {pair}: {count} swaps\n"

        keyboard = [
            [InlineKeyboardButton("📜 History", callback_data="history")],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]

        await query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )


def _get_status_emoji(status: str) -> str:
    """Get emoji for swap status."""
    return {
        SwapStatus.PENDING.value: "⏳",
        SwapStatus.EXECUTING.value: "🔄",
        SwapStatus.SUBMITTED.value: "📤",
        SwapStatus.CONFIRMING.value: "⏳",
        SwapStatus.COMPLETED.value: "✅",
        SwapStatus.FAILED.value: "❌",
        SwapStatus.CANCELLED.value: "🚫",
    }.get(status, "❓")


async def share_pnl_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Generate and show PNL sharing card."""
    query = update.callback_query
    await query.answer()

    try:
        swap_id = int(query.data.replace("pnl_share_", ""))
    except ValueError:
        await query.message.reply_text("❌ Invalid swap reference.")
        return
    data = await pnl_service.get_swap_pnl_data(swap_id)

    if not data:
        await query.message.reply_text(
            "❌ Could not calculate PNL. Token might be too new or price data unavailable."
        )
        return

    roi = data["roi_percent"]
    roi_emoji = "🚀" if roi > 10 else ("📈" if roi > 0 else "📉")
    color_bar = "🟢" * 5 if roi > 0 else "🔴" * 5

    card_text = (
        f"{roi_emoji} *SUWAPPU PNL CARD*\n"
        f"{color_bar}\n\n"
        f"Token: *{data['token']}*\n"
        f"ROI: *{roi:+.2f}%*\n"
        f"Profit: *{format_usd(data['profit_usd'])}*\n\n"
        f"Entry: ${data['entry_price']:.6f}\n"
        f"Current: ${data['current_price']:.6f}\n\n"
        f"🤖 *Swapped via Suwappu Bot*"
    )

    tweet_url = (
        "https://twitter.com/intent/tweet?text=Just%20made%20"
        f"{roi:.1f}%25%20profit%20using%20SuwappuBot!%20%23Suwappu%20%23Solana"
    )
    keyboard = [
        [InlineKeyboardButton("🐦 Share on X (Twitter)", url=tweet_url)],
        [InlineKeyboardButton("« Back to History", callback_data="history")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    # Best-effort: render an image card so the shared post looks good. Any
    # failure (font issues, PIL edge cases, etc.) falls back to the original
    # text card so the share flow never breaks.
    try:
        ref_code = None
        user = update.effective_user
        if user:
            try:
                from bot.services.referral_service import referral_service

                with get_session() as session:
                    db_user = session.query(User).filter(User.telegram_id == user.id).first()
                    if db_user:
                        ref_code = referral_service.get_or_create_code(db_user.id).code
            except Exception:
                logger.debug("share_pnl_callback: ref code lookup failed", exc_info=True)

        from bot.utils.pnl_card_image import render_pnl_card

        image_buf = render_pnl_card(
            token=data["token"],
            roi_pct=roi,
            pnl_usd=data["profit_usd"],
            entry=data["entry_price"],
            exit_price=data["current_price"],
            ref_code=ref_code,
        )
        image_buf.name = "pnl_card.png"

        # Send the image as a new photo message with the same caption +
        # buttons the text card used. We intentionally do not delete/edit the
        # original message — edit_message_text cannot be turned into a photo
        # message in-place, and reply_photo is the safe, permission-agnostic
        # way to post a new message in any chat type.
        await query.message.reply_photo(
            photo=image_buf,
            caption=card_text,
            parse_mode="Markdown",
            reply_markup=reply_markup,
        )
        return
    except Exception:
        logger.warning(
            "share_pnl_callback: image card render/send failed, falling back", exc_info=True
        )

    await query.edit_message_text(card_text, parse_mode="Markdown", reply_markup=reply_markup)


def _fmt_bps(value: Optional[float]) -> str:
    """Signed bps, so a gain never reads like a loss."""
    if value is None:
        return "—"
    return f"{value:+.0f} bps"


@enforce_tos
async def execution_receipt_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show the per-fill execution receipt for one swap.

    EXECUTION INTELLIGENCE (phase 4). The scorer has been marking every
    completed swap since phase 2 and nothing ever showed a user their own
    numbers. This is that surface.

    The cost/market split from ExecutionReceipt is preserved verbatim here:
    what the trade cost to cross (quoted spread + impact + fees) is rendered
    apart from what the market did afterwards (markout). Merging them into one
    "execution score" would let a routing regression hide behind a volatile day.

    Note the cost line makes no claim about fill accuracy — the realized output
    amount is not recorded yet, so that is not measurable. See the
    ExecutionReceipt module docstring before relabelling anything here.
    """
    query = update.callback_query
    await query.answer()

    swap_id = int(query.data.rsplit("_", 1)[1])

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == update.effective_user.id).first()
        user_id = db_user.id if db_user else None

    if user_id is None:
        await query.edit_message_text("❌ Please use /start first to set up your account.")
        return

    from bot.services.execution_receipt import execution_receipt

    try:
        receipt = execution_receipt.build(user_id=user_id, swap_id=swap_id)
    except Exception:
        logger.warning("execution_receipt_callback: build failed", exc_info=True)
        receipt = None
        error = True
    else:
        error = False

    back = InlineKeyboardMarkup(
        [[InlineKeyboardButton("« Back to history", callback_data="history")]]
    )

    if error:
        await query.edit_message_text(
            "⚠️ Couldn't load that receipt right now. Try again in a moment.",
            reply_markup=back,
        )
        return

    # None covers both "not yours" and "does not exist" — same message, so the
    # keyboard cannot be used to probe for other people's swap ids.
    if receipt is None:
        await query.edit_message_text("❌ Swap not found.", reply_markup=back)
        return

    lines = [
        "🧾 *Execution Receipt*",
        "",
        f"`{receipt['from_token']} → {receipt['to_token']}`",
    ]

    if not receipt["scored"]:
        lines += [
            "",
            "_Not scored yet._ Marks land a few minutes after a swap completes —",
            "check back shortly.",
        ]
        await query.edit_message_text("\n".join(lines), parse_mode="Markdown", reply_markup=back)
        return

    verdict = receipt["verdict"]

    lines += [
        "",
        "*What this trade cost*",
        f"Quoted cost: `{_fmt_bps(receipt['quoted_cost_bps'])}`",
    ]
    if verdict.get("cost"):
        lines.append(f"_{verdict['cost']}_")

    # Only rendered when a settled amount was actually observed — absence must
    # not read as "no shortfall".
    if receipt.get("fill_vs_quote_bps") is not None:
        lines += [
            "",
            "*Did we deliver the quote*",
            f"Quote vs fill: `{_fmt_bps(receipt['fill_vs_quote_bps'])}`",
        ]
        if verdict.get("fill"):
            lines.append(f"_{verdict['fill']}_")

    if verdict.get("market"):
        lines += ["", "*What the market did*", f"_{verdict['market']}_"]

    marks = [m for m in receipt["marks"] if m["markout_bps"] is not None]
    if marks:
        drift = "  ".join(f"{m['horizon']}: `{_fmt_bps(m['markout_bps'])}`" for m in marks)
        lines += ["", f"Price drift after fill — {drift}"]

    bench = receipt.get("benchmark")
    if bench and not bench.get("suppressed") and bench.get("has_user_data"):
        lines += [
            "",
            "*Versus everyone trading this pair*",
            f"You rank in the top {100 - bench['percentile']:.0f}% "
            f"({bench['cohort']['cohort_users']} traders)",
        ]
        if bench.get("remedy"):
            lines.append(f"_{bench['remedy']}_")
    elif bench and bench.get("suppressed"):
        # Say why, rather than implying the user has no peers.
        lines += ["", "_Too few traders on this pair to compare without identifying them._"]

    cf = receipt.get("counterfactual")
    if cf and cf["delta_usd"] > 0:
        lines += [
            "",
            f"_{cf['routes_considered']} routes were quoted. {cf['best_alternative_provider']} "
            f"quoted ${cf['delta_usd']:.2f} better than {cf['selected_provider']} — modeled from "
            f"quotes, not an observed fill._",
        ]

    lines += ["", "\n".join(f"⚠️ _{c}_" for c in receipt["caveats"])]

    await query.edit_message_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=back,
        disable_web_page_preview=True,
    )


# Individual callbacks
history_callback = CallbackQueryHandler(history_command, pattern="^history$")
history_menu_callback = CallbackQueryHandler(history_command, pattern="^history_menu$")
history_page_handler = CallbackQueryHandler(history_page_callback, pattern="^history_page_")
share_pnl_handler = CallbackQueryHandler(share_pnl_callback, pattern=r"^pnl_share_\d+$")
execution_receipt_handler = CallbackQueryHandler(
    execution_receipt_callback, pattern=r"^exec_receipt_\d+$"
)

# Create handlers
history_handler = CommandHandler("hx", history_command)
