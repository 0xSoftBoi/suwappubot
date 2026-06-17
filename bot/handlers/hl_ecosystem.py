"""Telegram handlers for the wider HyperLiquid ecosystem.

Adds, on top of the existing perps trading flow:
  * TWAP orders          — /twap
  * HYPE staking         — /stake, /unstake, /stakemove
  * Vaults (HLP + user)  — /vault
  * Referral admin       — /hlref

All commands are argument-driven (no conversation state) and reuse the
HyperLiquid account the user already configured via ``/perps setup``.
"""

import logging

from telegram import Update
from telegram.ext import ContextTypes, CommandHandler

from bot.services.perps_service import perps_service
from bot.services.hyperliquid_client import hyperliquid_client
from bot.handlers.admin import is_admin

logger = logging.getLogger(__name__)


def _require_account(user_id: int):
    """Return the user's HL account, or None (caller shows the setup hint)."""
    return perps_service.get_account(user_id)


_NO_ACCOUNT = "⚠️ No HyperLiquid account configured.\n" "Set one up first with /perps → Setup."


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
            f"{side.upper()} {size} {market.upper()} over {minutes}m.",
            parse_mode="Markdown",
        )
    else:
        await loading.edit_text("❌ TWAP order failed. Check your balance/market and try again.")


# --------------------------------------------------------------------------- #
# Staking (HYPE delegation)                                                   #
# --------------------------------------------------------------------------- #


async def stake_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/stake — show staking summary, or `/stake <amount> <validator>` to delegate."""
    user_id = update.effective_user.id
    account = _require_account(user_id)
    if not account:
        await update.message.reply_text(_NO_ACCOUNT)
        return

    args = context.args or []
    if not args:
        summary = await hyperliquid_client.get_staking_summary(account.hl_address)
        delegated = float(summary.get("delegated", 0) or 0)
        undelegated = float(summary.get("undelegated", 0) or 0)
        pending = float(summary.get("totalPendingWithdrawal", 0) or 0)
        lines = [
            "\U0001f53a *HYPE Staking*\n",
            f"Delegated: {delegated:,.4f} HYPE",
            f"Staking balance (undelegated): {undelegated:,.4f} HYPE",
            f"Pending withdrawal: {pending:,.4f} HYPE",
            "",
            "Move HYPE spot→staking: `/stakemove <amount> in`",
            "Delegate: `/stake <amount> <validator_address>`",
            "Undelegate: `/unstake <amount> <validator_address>`",
        ]
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
        return

    if len(args) < 2:
        await update.message.reply_text(
            "Usage: `/stake <amount> <validator_address>`", parse_mode="Markdown"
        )
        return
    ok = await _do_delegate(update, user_id, args[0], args[1], is_undelegate=False)
    return ok


async def unstake_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/unstake <amount> <validator> — undelegate HYPE from a validator."""
    user_id = update.effective_user.id
    if not _require_account(user_id):
        await update.message.reply_text(_NO_ACCOUNT)
        return
    args = context.args or []
    if len(args) < 2:
        await update.message.reply_text(
            "Usage: `/unstake <amount> <validator_address>`", parse_mode="Markdown"
        )
        return
    await _do_delegate(update, user_id, args[0], args[1], is_undelegate=True)


async def _do_delegate(update, user_id, amount_s, validator, is_undelegate):
    try:
        amount = float(amount_s)
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Amount must be a positive number.")
        return
    if not (validator.startswith("0x") and len(validator) == 42):
        await update.message.reply_text("Validator must be a 0x address (42 chars).")
        return

    verb = "Undelegating" if is_undelegate else "Delegating"
    loading = await update.message.reply_text(f"\U0001f53a {verb} {amount} HYPE...")
    ok = await perps_service.stake(user_id, validator, amount, is_undelegate=is_undelegate)
    if ok:
        await loading.edit_text(
            f"✅ {verb[:-3]}ed {amount} HYPE "
            f"{'from' if is_undelegate else 'to'} `{validator[:10]}...`",
            parse_mode="Markdown",
        )
    else:
        await loading.edit_text(
            "❌ Failed. Ensure HYPE is in your staking balance "
            "(`/stakemove <amount> in`) and try again."
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
            "Usage: `/stakemove <amount> <in|out>`\n" "`in` = spot→staking, `out` = staking→spot",
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
    loading = await update.message.reply_text(f"\U0001f53a Moving {amount} HYPE ({direction})...")
    ok = await perps_service.move_staking_balance(user_id, amount, is_deposit)
    await loading.edit_text(
        f"✅ Moved {amount} HYPE ({direction})." if ok else "❌ Transfer failed."
    )


# --------------------------------------------------------------------------- #
# Vaults                                                                       #
# --------------------------------------------------------------------------- #


async def vault_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/vault — list vault holdings, or `/vault <deposit|withdraw> <usd> <vault>`."""
    user_id = update.effective_user.id
    account = _require_account(user_id)
    if not account:
        await update.message.reply_text(_NO_ACCOUNT)
        return

    args = context.args or []
    if not args:
        equities = await hyperliquid_client.get_user_vault_equities(account.hl_address)
        if not equities:
            await update.message.reply_text(
                "\U0001f3e6 *Vaults*\n\nYou have no vault positions.\n\n"
                "Deposit: `/vault deposit <usd> <vault_address>`\n"
                "Withdraw: `/vault withdraw <usd> <vault_address>`",
                parse_mode="Markdown",
            )
            return
        lines = ["\U0001f3e6 *Your Vault Positions*\n"]
        for e in equities[:10]:
            addr = e.get("vaultAddress", "?")
            equity = float(e.get("equity", 0) or 0)
            lines.append(f"`{addr[:10]}...` — ${equity:,.2f}")
        lines.append("\nManage: `/vault <deposit|withdraw> <usd> <vault_address>`")
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
        return

    if len(args) < 3 or args[0].lower() not in ("deposit", "withdraw"):
        await update.message.reply_text(
            "Usage: `/vault <deposit|withdraw> <usd> <vault_address>`", parse_mode="Markdown"
        )
        return
    action, usd_s, vault = args[0].lower(), args[1], args[2]
    try:
        usd = float(usd_s)
        if usd <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("USD amount must be a positive number.")
        return
    if not (vault.startswith("0x") and len(vault) == 42):
        await update.message.reply_text("Vault must be a 0x address (42 chars).")
        return

    is_deposit = action == "deposit"
    loading = await update.message.reply_text(f"\U0001f3e6 {action.capitalize()}ing ${usd:,.2f}...")
    ok = await perps_service.vault_transfer(user_id, vault, is_deposit, usd)
    await loading.edit_text(
        (
            f"✅ {action.capitalize()} of ${usd:,.2f} submitted to `{vault[:10]}...`"
            if ok
            else "❌ Vault transfer failed (check lockup/balance)."
        ),
        parse_mode="Markdown",
    )


# --------------------------------------------------------------------------- #
# Referral admin                                                               #
# --------------------------------------------------------------------------- #


async def hl_ref_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/hlref — admin: show Suwappu's HyperLiquid referral configuration & earnings."""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return

    from bot.config.settings import settings

    code = getattr(settings, "hl_referral_code", None)
    if not code:
        await update.message.reply_text(
            "⚙️ Set `HL_REFERRAL_CODE` to auto-attach Suwappu's referral "
            "code to users on their first perp trade.",
            parse_mode="Markdown",
        )
        return

    builder_address = getattr(settings, "hl_builder_address", None)
    lines = [
        "\U0001f91d *HyperLiquid Referral*\n",
        f"Active code: `{code}`",
        "Auto-attached on each user's first perp trade.",
    ]
    if builder_address:
        state = await hyperliquid_client.get_referral_state(builder_address)
        rewards = (state or {}).get("rewardHistory") or state.get("cumVlm")
        if rewards is not None:
            lines.append(f"\nBuilder referral state: `{str(rewards)[:120]}`")
    lines.append("\nClaim referral + builder rewards together with /hlclaim.")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


# Handlers
twap_handler = CommandHandler("twap", twap_command)
stake_handler = CommandHandler("stake", stake_command)
unstake_handler = CommandHandler("unstake", unstake_command)
stakemove_handler = CommandHandler("stakemove", stakemove_command)
vault_handler = CommandHandler("vault", vault_command)
hl_ref_handler = CommandHandler("hlref", hl_ref_command)
