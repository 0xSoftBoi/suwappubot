"""Telegram handlers for the wider HyperLiquid ecosystem.

Beyond perps + builder codes this adds, as first-class, stateful features:
  * TWAP orders          — /twap (persisted + monitored)
  * HYPE staking         — /stake (validator discovery, no address pasting)
  * Vaults (HLP + user)  — /vault (APR/TVL/PnL dashboard, tap-to-deposit)
  * Referral admin       — /hlref

Selection is button-driven: ``/stake`` and ``/vault`` render live dashboards
with inline choices; tapping one starts a short amount-entry conversation.
Power users can still pass args (``/stake 10 1`` or ``/vault deposit 100``).
All actions reuse the HyperLiquid account from ``/perps setup`` and are
recorded locally so they surface in the portfolio and the background monitor.
"""

import logging

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.services.perps_service import perps_service
from bot.services.hyperliquid_client import hyperliquid_client, HLP_VAULT_ADDRESS
from bot.handlers.admin import is_admin
from bot.utils.telegram_safe import safe_md

logger = logging.getLogger(__name__)

# Conversation states for amount entry after a button pick.
HL_STAKE_AMOUNT, HL_VAULT_AMOUNT = range(60, 62)

_NO_ACCOUNT = "⚠️ No HyperLiquid account configured.\nSet one up first with /perps → Setup."


def _require_account(user_id: int):
    return perps_service.get_account(user_id)


# --------------------------------------------------------------------------- #
# TWAP orders                                                                 #
# --------------------------------------------------------------------------- #


async def twap_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/twap <MARKET> <long|short> <size> <minutes> — slice an order over time."""
    user_id = update.effective_user.id
    if not _require_account(user_id):
        await update.message.reply_text(_NO_ACCOUNT)
        return

    args = context.args or []
    if len(args) < 4:
        await update.message.reply_text(
            "\U0001f552 *TWAP order*\n\n"
            "Usage: `/twap <MARKET> <long|short> <size> <minutes>`\n"
            "Example: `/twap BTC long 0.05 30`\n\n"
            "Splits the order evenly (with randomization) over the given minutes.",
            parse_mode="Markdown",
        )
        return

    market, side, size_s, minutes_s = args[0], args[1].lower(), args[2], args[3]
    if side not in ("long", "short"):
        await update.message.reply_text("Side must be `long` or `short`.", parse_mode="Markdown")
        return
    try:
        size = float(size_s)
        minutes = int(minutes_s)
        if size <= 0 or minutes <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Size and minutes must be positive numbers.")
        return

    loading = await update.message.reply_text("\U0001f552 Submitting TWAP order...")
    twap_id = await perps_service.place_twap(user_id, market.upper(), side, size, minutes)
    if twap_id:
        await loading.edit_text(
            f"✅ TWAP started (id `{twap_id}`)\n"
            f"{side.upper()} {size} {market.upper()} over {minutes}m.\n"
            f"You'll be notified when it completes.",
            parse_mode="Markdown",
        )
    else:
        await loading.edit_text("❌ TWAP order failed. Check your balance/market and try again.")


# --------------------------------------------------------------------------- #
# Staking — validator discovery + tap-to-delegate                             #
# --------------------------------------------------------------------------- #


async def stake_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/stake — staking dashboard with validator picker. `/stake <amt> <#|addr>` to act."""
    user_id = update.effective_user.id
    account = _require_account(user_id)
    if not account:
        await update.message.reply_text(_NO_ACCOUNT)
        return ConversationHandler.END

    args = context.args or []
    if len(args) >= 2:
        return await _stake_from_args(update, context, user_id, args)

    summary = await hyperliquid_client.get_staking_summary(account.hl_address)
    delegations = await hyperliquid_client.get_delegations(account.hl_address)
    validators = await hyperliquid_client.get_ranked_validators(limit=6)
    context.user_data["hl_validators"] = validators

    delegated = float(summary.get("delegated", 0) or 0)
    undelegated = float(summary.get("undelegated", 0) or 0)
    pending = float(summary.get("totalPendingWithdrawal", 0) or 0)

    lines = [
        "\U0001f53a *HYPE Staking*\n",
        f"Delegated: *{delegated:,.4f}* HYPE",
        f"Staking balance: {undelegated:,.4f} HYPE",
        f"Pending withdrawal: {pending:,.4f} HYPE",
    ]
    if delegations:
        lines.append("\n*Your delegations:*")
        for d in delegations[:5]:
            amt = float(d.get("amount", 0) or 0)
            lines.append(f"• `{d.get('validator','')[:8]}…` — {amt:,.4f} HYPE")
    lines.append("\n*Top validators by APR* — tap to delegate:")

    keyboard = []
    for i, v in enumerate(validators):
        keyboard.append(
            [
                InlineKeyboardButton(
                    f"{v['name'][:18]} • {v['apr_pct']:.2f}% APR • {v['commission_pct']:.0f}% fee",
                    callback_data=f"hlv:{i}",
                )
            ]
        )
    keyboard.append([InlineKeyboardButton("✖ Close", callback_data="hl_cancel")])

    await update.message.reply_text(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return ConversationHandler.END


async def _stake_from_args(update, context, user_id, args):
    """Power-user path: /stake <amount> <validator # or 0xaddress>."""
    try:
        amount = float(args[0])
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Amount must be a positive number.")
        return ConversationHandler.END

    target = args[1]
    validator, name = _resolve_validator(context, target)
    if not validator:
        await update.message.reply_text(
            "Unknown validator. Run /stake to see the list, then use its number, "
            "or pass a full 0x validator address."
        )
        return ConversationHandler.END

    await _do_delegate(update, user_id, amount, validator, name)
    return ConversationHandler.END


def _resolve_validator(context, target: str):
    """Resolve a validator from an index (into the cached list) or a raw address."""
    if target.startswith("0x") and len(target) == 42:
        return target, None
    cached = context.user_data.get("hl_validators") or []
    if target.isdigit():
        idx = int(target) - 1
        if 0 <= idx < len(cached):
            return cached[idx]["validator"], cached[idx]["name"]
    return None, None


async def stake_pick_validator(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback: user tapped a validator button — ask for the amount."""
    query = update.callback_query
    await query.answer()
    idx = int(query.data.split(":")[1])
    cached = context.user_data.get("hl_validators") or []
    if idx >= len(cached):
        await query.edit_message_text("Validator list expired — run /stake again.")
        return ConversationHandler.END

    v = cached[idx]
    context.user_data["hl_stake_validator"] = v["validator"]
    context.user_data["hl_stake_validator_name"] = v["name"]
    await query.edit_message_text(
        f"\U0001f53a Delegating to *{safe_md(v['name'])}* "
        f"({v['apr_pct']:.2f}% APR, {v['commission_pct']:.0f}% fee)\n\n"
        "Reply with the *amount of HYPE* to delegate (e.g. `10`).\n"
        "If your staking balance is short, it's topped up from spot automatically.\n\n"
        "/cancel to abort.",
        parse_mode="Markdown",
    )
    return HL_STAKE_AMOUNT


async def stake_amount_entry(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Conversation state: received the HYPE amount to delegate."""
    try:
        amount = float(update.message.text.strip())
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Please send a positive number, or /cancel.")
        return HL_STAKE_AMOUNT

    validator = context.user_data.get("hl_stake_validator")
    name = context.user_data.get("hl_stake_validator_name")
    if not validator:
        await update.message.reply_text("Session expired — run /stake again.")
        return ConversationHandler.END

    await _do_delegate(update, update.effective_user.id, amount, validator, name)
    context.user_data.pop("hl_stake_validator", None)
    context.user_data.pop("hl_stake_validator_name", None)
    return ConversationHandler.END


async def _do_delegate(update, user_id, amount, validator, name):
    loading = await update.message.reply_text(f"\U0001f53a Delegating {amount} HYPE…")
    ok = await perps_service.stake(
        user_id, validator, amount, is_undelegate=False, validator_name=name
    )
    if ok:
        label = safe_md(name) if name else f"`{validator[:10]}…`"
        await loading.edit_text(
            f"✅ Delegated *{amount}* HYPE to {label}.\nRewards auto-compound; "
            "track them with /stake.",
            parse_mode="Markdown",
        )
    else:
        await loading.edit_text(
            "❌ Delegation failed. Make sure you hold enough HYPE in spot/staking and retry."
        )


async def unstake_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/unstake <amount> <# or 0xaddress> — undelegate HYPE (1-day lockup applies)."""
    user_id = update.effective_user.id
    if not _require_account(user_id):
        await update.message.reply_text(_NO_ACCOUNT)
        return
    args = context.args or []
    if len(args) < 2:
        await update.message.reply_text(
            "Usage: `/unstake <amount> <validator # or 0xaddress>`\n"
            "Run /stake first to see validator numbers.",
            parse_mode="Markdown",
        )
        return
    try:
        amount = float(args[0])
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Amount must be a positive number.")
        return
    validator, name = _resolve_validator(context, args[1])
    if not validator:
        await update.message.reply_text(
            "Unknown validator — pass a number from /stake or a 0x address."
        )
        return

    loading = await update.message.reply_text(f"\U0001f53a Undelegating {amount} HYPE…")
    ok = await perps_service.stake(
        user_id, validator, amount, is_undelegate=True, validator_name=name
    )
    await loading.edit_text(
        f"✅ Undelegated {amount} HYPE. It unlocks to your staking balance in ~1 day."
        if ok
        else "❌ Undelegation failed."
    )


async def stakemove_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/stakemove <amount> <in|out> — move HYPE between spot and staking balance."""
    user_id = update.effective_user.id
    if not _require_account(user_id):
        await update.message.reply_text(_NO_ACCOUNT)
        return
    args = context.args or []
    if len(args) < 2 or args[1].lower() not in ("in", "out"):
        await update.message.reply_text(
            "Usage: `/stakemove <amount> <in|out>`\n`in` = spot→staking, `out` = staking→spot",
            parse_mode="Markdown",
        )
        return
    try:
        amount = float(args[0])
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Amount must be a positive number.")
        return

    is_deposit = args[1].lower() == "in"
    direction = "spot → staking" if is_deposit else "staking → spot"
    loading = await update.message.reply_text(f"\U0001f53a Moving {amount} HYPE ({direction})…")
    ok = await perps_service.move_staking_balance(user_id, amount, is_deposit)
    await loading.edit_text(
        f"✅ Moved {amount} HYPE ({direction})." if ok else "❌ Transfer failed."
    )


# --------------------------------------------------------------------------- #
# Vaults — HLP dashboard + tap-to-deposit                                     #
# --------------------------------------------------------------------------- #


async def vault_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/vault — vault dashboard (HLP + your positions). `/vault deposit 100 [addr]`."""
    user_id = update.effective_user.id
    account = _require_account(user_id)
    if not account:
        await update.message.reply_text(_NO_ACCOUNT)
        return ConversationHandler.END

    args = context.args or []
    if len(args) >= 2 and args[0].lower() in ("deposit", "withdraw"):
        return await _vault_from_args(update, context, user_id, args)

    snap = await hyperliquid_client.get_vault_snapshot(HLP_VAULT_ADDRESS, account.hl_address)
    equities = await hyperliquid_client.get_user_vault_equities(account.hl_address)

    lines = ["\U0001f3e6 *HyperLiquid Vaults*\n", "*HLP — Hyperliquidity Provider*"]
    if snap:
        lines.append(f"APR: {snap['apr_pct']:.2f}%  •  TVL: ${snap['tvl_usd']:,.0f}")
        u = snap.get("user")
        if u:
            lines.append(
                f"Your equity: ${u['equity_usd']:,.2f}  (PnL ${u['all_time_pnl_usd']:,.2f})"
            )
    if equities:
        lines.append("\n*Your vault positions:*")
        for e in equities[:8]:
            lines.append(
                f"• `{e.get('vaultAddress','')[:8]}…` — ${float(e.get('equity',0) or 0):,.2f}"
            )

    lines.append("\nDeposit earns yield from HLP market-making + fees (1-day lockup).")
    context.user_data["hl_vault_addr"] = HLP_VAULT_ADDRESS
    keyboard = [
        [
            InlineKeyboardButton("➕ Deposit HLP", callback_data="hlvault:deposit"),
            InlineKeyboardButton("➖ Withdraw HLP", callback_data="hlvault:withdraw"),
        ],
        [InlineKeyboardButton("✖ Close", callback_data="hl_cancel")],
    ]
    await update.message.reply_text(
        "\n".join(lines), reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown"
    )
    return ConversationHandler.END


async def _vault_from_args(update, context, user_id, args):
    action = args[0].lower()
    try:
        usd = float(args[1])
        if usd <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("USD amount must be a positive number.")
        return ConversationHandler.END
    vault = args[2] if len(args) >= 3 else HLP_VAULT_ADDRESS
    if not (vault.startswith("0x") and len(vault) == 42):
        await update.message.reply_text("Vault must be a 0x address (42 chars).")
        return ConversationHandler.END
    await _do_vault(update, user_id, action == "deposit", usd, vault)
    return ConversationHandler.END


async def vault_pick(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback: tapped Deposit/Withdraw — ask for USD amount."""
    query = update.callback_query
    await query.answer()
    action = query.data.split(":")[1]  # deposit | withdraw
    context.user_data["hl_vault_action"] = action
    context.user_data.setdefault("hl_vault_addr", HLP_VAULT_ADDRESS)
    await query.edit_message_text(
        f"\U0001f3e6 HLP {action}\n\nReply with the *USD amount* (e.g. `100`).\n/cancel to abort.",
        parse_mode="Markdown",
    )
    return HL_VAULT_AMOUNT


async def vault_amount_entry(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Conversation state: received the USD amount for the vault transfer."""
    try:
        usd = float(update.message.text.strip())
        if usd <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Please send a positive number, or /cancel.")
        return HL_VAULT_AMOUNT

    action = context.user_data.get("hl_vault_action")
    vault = context.user_data.get("hl_vault_addr", HLP_VAULT_ADDRESS)
    if not action:
        await update.message.reply_text("Session expired — run /vault again.")
        return ConversationHandler.END

    await _do_vault(update, update.effective_user.id, action == "deposit", usd, vault)
    context.user_data.pop("hl_vault_action", None)
    return ConversationHandler.END


async def _do_vault(update, user_id, is_deposit, usd, vault):
    verb = "Depositing" if is_deposit else "Withdrawing"
    loading = await update.message.reply_text(f"\U0001f3e6 {verb} ${usd:,.2f}…")
    ok = await perps_service.vault_transfer(user_id, vault, is_deposit, usd)
    if ok:
        note = " (1-day lockup before withdrawal)" if is_deposit else ""
        await loading.edit_text(
            f"✅ {verb[:-3]}ed ${usd:,.2f} {'into' if is_deposit else 'from'} the vault.{note}"
        )
    else:
        await loading.edit_text(
            "❌ Vault transfer failed (check deposits-allowed, lockup, or balance)."
        )


async def hl_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Close a dashboard / abort a flow from an inline button."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("Closed.")
    return ConversationHandler.END


async def hl_cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Cancelled.")
    return ConversationHandler.END


# --------------------------------------------------------------------------- #
# HyperCore spot trading                                                      #
# --------------------------------------------------------------------------- #


async def spot_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/spot — spot balances. `/spot buy HYPE 25` (USD) or `/spot sell HYPE 0.5` (size)."""
    user_id = update.effective_user.id
    account = _require_account(user_id)
    if not account:
        await update.message.reply_text(_NO_ACCOUNT)
        return

    args = context.args or []
    if not args:
        balances = await hyperliquid_client.get_spot_balances(account.hl_address)
        lines = ["\U0001fa99 *HyperCore Spot*\n"]
        if balances:
            for b in balances[:15]:
                held = f" ({b['hold']:.4f} on hold)" if b["hold"] > 0 else ""
                lines.append(f"• {b['total']:.6f} {safe_md(b['coin'])}{held}")
        else:
            lines.append("No spot balances.")
        lines.append(
            "\n*Trade:*\n"
            "`/spot buy HYPE 25` — buy $25 of HYPE\n"
            "`/spot sell HYPE 0.5` — sell 0.5 HYPE\n"
            "Use a symbol (HYPE, PURR) or an `@index` pair. Marketable IOC orders."
        )
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
        return

    if len(args) < 3 or args[0].lower() not in ("buy", "sell"):
        await update.message.reply_text(
            "Usage: `/spot buy <SYMBOL> <usd>` or `/spot sell <SYMBOL> <size>`",
            parse_mode="Markdown",
        )
        return

    is_buy = args[0].lower() == "buy"
    coin = args[1]
    try:
        amount = float(args[2])
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Amount must be a positive number.")
        return

    unit = "$" if is_buy else ""
    suffix = "" if is_buy else f" {coin.upper()}"
    loading = await update.message.reply_text(
        f"\U0001fa99 {'Buying' if is_buy else 'Selling'} {unit}{amount}{suffix}…"
    )
    # Buys spend a USD notional; sells are in base-token size.
    result = await perps_service.place_spot_order(
        user_id, coin, is_buy, amount, amount_is_usd=is_buy
    )
    if result and result.status == "filled":
        await loading.edit_text(
            f"✅ {'Bought' if is_buy else 'Sold'} {result.filled_size:.6f} {coin.upper()} "
            f"@ ${result.fill_price:,.4f}"
        )
    elif result:
        await loading.edit_text(
            f"✅ Order placed (resting, id `{result.order_id}`).", parse_mode="Markdown"
        )
    else:
        await loading.edit_text(
            "❌ Spot order failed. Check the symbol is supported (HYPE, PURR, or @index) "
            "and you hold enough balance."
        )


# --------------------------------------------------------------------------- #
# Referral admin                                                              #
# --------------------------------------------------------------------------- #


async def hl_ref_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/hlref — admin: show Suwappu's HyperLiquid referral configuration."""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return

    from bot.config.settings import settings

    code = getattr(settings, "hl_referral_code", None)
    if not code:
        await update.message.reply_text(
            "⚙️ Set `HL_REFERRAL_CODE` to auto-attach Suwappu's referral code to "
            "users on their first perp trade.",
            parse_mode="Markdown",
        )
        return

    lines = [
        "\U0001f91d *HyperLiquid Referral*\n",
        f"Active code: `{code}`",
        "Auto-attached on each user's first perp trade.",
        "\nClaim referral + builder rewards together with /hlclaim.",
    ]
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


# Handlers ------------------------------------------------------------------ #
twap_handler = CommandHandler("twap", twap_command)
stake_handler = CommandHandler("stake", stake_command)
unstake_handler = CommandHandler("unstake", unstake_command)
stakemove_handler = CommandHandler("stakemove", stakemove_command)
vault_handler = CommandHandler("vault", vault_command)
spot_handler = CommandHandler("spot", spot_command)
hl_ref_handler = CommandHandler("hlref", hl_ref_command)
# Close button on dashboards shown outside an active conversation.
hl_cancel_handler = CallbackQueryHandler(hl_cancel_callback, pattern=r"^hl_cancel$")

# Button-driven amount-entry flow for staking + vault deposits.
hl_ecosystem_conversation = ConversationHandler(
    entry_points=[
        CallbackQueryHandler(stake_pick_validator, pattern=r"^hlv:\d+$"),
        CallbackQueryHandler(vault_pick, pattern=r"^hlvault:(deposit|withdraw)$"),
    ],
    states={
        HL_STAKE_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, stake_amount_entry)],
        HL_VAULT_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, vault_amount_entry)],
    },
    fallbacks=[
        CommandHandler("cancel", hl_cancel_command),
        CallbackQueryHandler(hl_cancel_callback, pattern=r"^hl_cancel$"),
    ],
    per_message=False,
)
