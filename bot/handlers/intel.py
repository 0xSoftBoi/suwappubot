"""Token Intel / Dev Tracking — /intel token report + /devwatch deployer watchlist.

Bubblemaps/Solscan-style read-only analytics built entirely from free data
sources (Blockscout, Solana RPC, DexScreener). No money-path here — this is
strictly informational + a watchlist table.
"""

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CommandHandler, CallbackQueryHandler, ContextTypes

from bot.config.chains import get_chain_by_name, resolve_chain_name
from bot.models.intel import DeployerWatch
from bot.models.user import User
from bot.services.token_intel import token_intel_service
from bot.services.token_intel.intel_service import TokenIntelReport
from bot.utils.telegram_safe import safe_md
from bot.utils.validators import detect_address_chain
from database.db import get_session

logger = logging.getLogger(__name__)

_FLAG_EMOJI = {
    "HIGH_TOP10": "🚩",
    "BUNDLED": "🚩",
    "SNIPED": "⚠️",
    "SERIAL_DEPLOYER": "🚩",
    "CLUSTERED": "⚠️",
}

_FLAG_LABEL = {
    "HIGH_TOP10": "Top 10 holders control a large share of supply",
    "BUNDLED": "Multiple wallets bought in the same block (bundled buy)",
    "SNIPED": "Multiple wallets bought within the first minute (sniped)",
    "SERIAL_DEPLOYER": "Deployer has multiple prior dead/rugged tokens",
    "CLUSTERED": "Top holders appear funded by the same wallet",
}


def _short(addr: str) -> str:
    if not addr:
        return "unknown"
    return f"{addr[:6]}…{addr[-4:]}" if len(addr) > 12 else addr


def _bar(pct: float, width: int = 10) -> str:
    pct = max(0.0, min(100.0, pct or 0.0))
    filled = round((pct / 100.0) * width)
    return "█" * filled + "░" * (width - filled)


def _explorer_address_link(address: str, chain: str) -> str:
    chain_cfg = get_chain_by_name(chain)
    if not chain_cfg or not address:
        return _short(address)
    path = "account" if chain_cfg.chain_type.value == "solana" else "address"
    url = f"{chain_cfg.explorer_url}/{path}/{address}"
    return f"[{_short(address)}]({url})"


def _resolve_chain(chain_family: str, chain_arg: str | None) -> str | None:
    """Resolve the chain to analyze on. Explicit arg wins; otherwise pick a
    sane default from the detected address family. Returns None if the
    address family isn't supported by /intel yet.
    """
    if chain_arg:
        resolved = resolve_chain_name(chain_arg)
        if resolved:
            return resolved
    if chain_family == "solana":
        return "solana"
    if chain_family == "evm":
        return "ethereum"
    return None


def _format_report(report: TokenIntelReport) -> str:
    name = safe_md(report.name) if report.name else "Unknown token"
    symbol = safe_md(report.symbol) if report.symbol else "?"

    lines = [f"🔎 *Token Intel — {name} ({symbol})*\n"]
    lines.append(f"Address: `{report.token_address}`")
    lines.append(f"Chain: {report.chain}")

    lines.append("")
    if report.deployer:
        lines.append(f"👤 Deployer: {_explorer_address_link(report.deployer, report.chain)}")
        if report.deployer_prior_deploys is not None:
            dead = report.deployer_dead_deploys
            dead_str = f", {dead} appear dead/rugged" if dead else ""
            lines.append(f"   History: {report.deployer_prior_deploys} prior deploy(s){dead_str}")
    else:
        lines.append("👤 Deployer: unavailable")

    lines.append("")
    if report.top10_pct is not None:
        lines.append(f"📊 Top 10 concentration: {report.top10_pct:.1f}%")
        lines.append(f"   {_bar(report.top10_pct)}")
    else:
        lines.append("📊 Top 10 concentration: unavailable")

    if report.top_holders:
        lines.append("")
        lines.append("*Top holders:*")
        for h in report.top_holders[:5]:
            pct = h.pct if h.pct is not None else 0.0
            pct_str = f"{pct:.2f}%" if h.pct is not None else "?"
            lines.append(f"`{_short(h.address)}` {_bar(pct, 6)} {pct_str}")

    lines.append("")
    if report.flags:
        lines.append("*Flags:*")
        for flag in report.flags:
            emoji = _FLAG_EMOJI.get(flag, "⚠️")
            label = _FLAG_LABEL.get(flag, flag)
            lines.append(f"{emoji} {label}")
    else:
        lines.append("✅ No risk flags detected from available data")

    if report.notes:
        lines.append("")
        lines.append(f"_Degraded fields: {', '.join(report.notes)}_")

    return "\n".join(lines)


def _report_keyboard(report: TokenIntelReport) -> InlineKeyboardMarkup:
    rows = []
    if report.deployer:
        rows.append(
            [
                InlineKeyboardButton(
                    "👁 Watch deployer",
                    callback_data=f"iw:{report.chain}:{report.deployer}",
                )
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(
                "🔄 Refresh",
                callback_data=f"ir:{report.chain}:{report.token_address}",
            )
        ]
    )
    return InlineKeyboardMarkup(rows)


async def _get_or_create_user_id(telegram_id: int) -> int | None:
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == telegram_id).first()
        return db_user.id if db_user else None


async def intel_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/intel <token_address> [chain] — deployer + holder concentration report."""
    args = context.args or []
    if not args:
        await update.message.reply_text(
            "Usage: `/intel <token_address> [chain]`\n\n" "Example: `/intel 0x1234...abcd base`",
            parse_mode="Markdown",
        )
        return

    address = args[0].strip()
    chain_arg = args[1].strip() if len(args) > 1 else None

    is_valid, chain_family = detect_address_chain(address)
    if not is_valid:
        await update.message.reply_text("❌ That doesn't look like a valid token address.")
        return

    chain = _resolve_chain(chain_family, chain_arg)
    if not chain:
        await update.message.reply_text(
            f"❌ /intel doesn't support `{chain_family}` addresses yet.", parse_mode="Markdown"
        )
        return

    status_msg = await update.message.reply_text("🔎 Analyzing token…")

    try:
        report = await token_intel_service.analyze(address, chain)
    except Exception as e:
        logger.error("token_intel /intel failed for %s/%s: %s", chain, address, e)
        await status_msg.edit_text("❌ Could not analyze that token right now. Try again shortly.")
        return

    await status_msg.edit_text(
        _format_report(report),
        parse_mode="Markdown",
        reply_markup=_report_keyboard(report),
        disable_web_page_preview=True,
    )


async def intel_refresh_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer("Refreshing…")

    try:
        _, chain, address = query.data.split(":", 2)
    except ValueError:
        return

    try:
        report = await token_intel_service.analyze(address, chain, force_refresh=True)
    except Exception as e:
        logger.error("token_intel refresh failed for %s/%s: %s", chain, address, e)
        await query.answer("❌ Refresh failed, try again shortly.", show_alert=True)
        return

    await query.edit_message_text(
        _format_report(report),
        parse_mode="Markdown",
        reply_markup=_report_keyboard(report),
        disable_web_page_preview=True,
    )


async def intel_watch_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Watch-deployer button from /intel — adds a DeployerWatch row for the user."""
    query = update.callback_query
    user = update.effective_user

    try:
        _, chain, deployer_address = query.data.split(":", 2)
    except ValueError:
        await query.answer("❌ Invalid request.", show_alert=True)
        return

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("❌ Please use /start first.", show_alert=True)
            return

        existing = (
            session.query(DeployerWatch)
            .filter(
                DeployerWatch.user_id == db_user.id,
                DeployerWatch.deployer_address == deployer_address,
                DeployerWatch.chain == chain,
            )
            .first()
        )
        if existing:
            await query.answer("👁 Already watching this deployer.", show_alert=True)
            return

        watch = DeployerWatch(
            user_id=db_user.id,
            deployer_address=deployer_address,
            chain=chain,
        )
        session.add(watch)
        session.commit()

    await query.answer(f"👁 Now watching {_short(deployer_address)}")


async def devwatch_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/devwatch — list watches. /devwatch add <address> [chain] [label]. /devwatch rm <n|address>."""
    user = update.effective_user
    args = context.args or []

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    if not args:
        await _devwatch_list(update, user_id)
        return

    sub = args[0].lower()
    if sub == "add":
        await _devwatch_add(update, user_id, args[1:])
    elif sub in ("rm", "remove", "del", "delete"):
        await _devwatch_remove(update, user_id, args[1:])
    else:
        await _devwatch_list(update, user_id)


async def _devwatch_list(update: Update, user_id: int) -> None:
    with get_session() as session:
        watches = (
            session.query(DeployerWatch)
            .filter(DeployerWatch.user_id == user_id)
            .order_by(DeployerWatch.id.asc())
            .all()
        )

        if not watches:
            await update.message.reply_text(
                "👁 *Dev Tracking*\n\n"
                "_No watched deployers yet._\n\n"
                "Add one: `/devwatch add <address> [chain] [label]`",
                parse_mode="Markdown",
            )
            return

        lines = ["👁 *Watched Deployers*\n"]
        for i, w in enumerate(watches, start=1):
            label = f" — {safe_md(w.label)}" if w.label else ""
            lines.append(f"{i}. `{_short(w.deployer_address)}` ({w.chain}){label}")
        lines.append("\nRemove: `/devwatch rm <number|address>`")

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def _devwatch_add(update: Update, user_id: int, rest: list[str]) -> None:
    if not rest:
        await update.message.reply_text(
            "Usage: `/devwatch add <address> [chain] [label]`", parse_mode="Markdown"
        )
        return

    address = rest[0].strip()
    is_valid, chain_family = detect_address_chain(address)
    if not is_valid:
        await update.message.reply_text("❌ That doesn't look like a valid deployer address.")
        return

    chain_arg = rest[1] if len(rest) > 1 else None
    chain = _resolve_chain(chain_family, chain_arg)
    if not chain:
        await update.message.reply_text(f"❌ Unsupported chain for `{chain_family}` address.")
        return

    label = " ".join(rest[2:]).strip() or None

    with get_session() as session:
        existing = (
            session.query(DeployerWatch)
            .filter(
                DeployerWatch.user_id == user_id,
                DeployerWatch.deployer_address == address,
                DeployerWatch.chain == chain,
            )
            .first()
        )
        if existing:
            await update.message.reply_text("👁 Already watching this deployer.")
            return

        watch = DeployerWatch(user_id=user_id, deployer_address=address, chain=chain, label=label)
        session.add(watch)
        session.commit()

    await update.message.reply_text(
        f"✅ Now watching `{_short(address)}` on {chain}.", parse_mode="Markdown"
    )


async def _devwatch_remove(update: Update, user_id: int, rest: list[str]) -> None:
    if not rest:
        await update.message.reply_text(
            "Usage: `/devwatch rm <number|address>`", parse_mode="Markdown"
        )
        return

    target = rest[0].strip()

    with get_session() as session:
        watches = (
            session.query(DeployerWatch)
            .filter(DeployerWatch.user_id == user_id)
            .order_by(DeployerWatch.id.asc())
            .all()
        )

        watch = None
        if target.isdigit():
            idx = int(target) - 1
            if 0 <= idx < len(watches):
                watch = watches[idx]
        else:
            for w in watches:
                if w.deployer_address.lower() == target.lower():
                    watch = w
                    break

        if not watch:
            await update.message.reply_text("❌ Watch not found.")
            return

        session.delete(watch)
        session.commit()

    await update.message.reply_text(
        f"🗑 Removed `{_short(target)}` from watchlist.", parse_mode="Markdown"
    )


intel_handler = CommandHandler("intel", intel_command)
devwatch_handler = CommandHandler("devwatch", devwatch_command)
intel_refresh_handler = CallbackQueryHandler(intel_refresh_callback, pattern=r"^ir:")
intel_watch_handler = CallbackQueryHandler(intel_watch_callback, pattern=r"^iw:")
