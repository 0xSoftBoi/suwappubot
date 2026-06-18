"""Telegram handler: one-click cross-chain funding of a HyperLiquid account.

Lets a user top up their HyperCore account from any chain without leaving the
bot — the friction this kills is the #1 reason people don't trade HL in-bot.

  * USDC from Arbitrum/Base/Optimism/Polygon/Ethereum  -> HyperCore spot
    (Across Swap API; signed with the user's custodial EVM wallet).
  * Native BTC / ETH / SOL                              -> HyperCore spot
    (HyperUnit deposit address; user/bot sends the native asset to it).

Button-driven (no free-text state) to match the perps handler's UX.
"""

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from bot.config.settings import settings
from bot.services.across_api import ACROSS_TOKENS
from bot.services.cctp_hypercore import CCTP_V2_DOMAINS
from bot.services.cctp_relayer import cctp_relayer
from bot.services.hyperliquid_funding import (
    MIN_USDC_DEPOSIT,
    FundingError,
    hyperliquid_funding,
)
from bot.services.hyperunit_api import HYPERUNIT_ASSETS
from bot.services.perps_service import perps_service
from bot.services.wallet import WalletService

logger = logging.getLogger(__name__)

wallet_service = WalletService()

# Preset USDC deposit amounts (whole tokens).
USDC_AMOUNTS = [25, 50, 100, 250, 500, 1000]

# USDC source chains we support (intersection of Across USDC + common chains).
USDC_CHAINS = [
    c
    for c in ["arbitrum", "base", "optimism", "polygon", "ethereum"]
    if c in ACROSS_TOKENS.get("USDC", {})
]

# CCTP native-USDC source chains (intersection with CCTP V2 domains).
CCTP_CHAINS = [
    c for c in ["arbitrum", "base", "optimism", "polygon", "ethereum"] if c in CCTP_V2_DOMAINS
]


def _cctp_enabled() -> bool:
    return bool(getattr(settings, "cctp_relayer_enabled", False))


# Native assets supported by HyperUnit, with display labels.
NATIVE_LABELS = {"btc": "₿ BTC", "eth": "Ξ ETH", "sol": "◎ SOL"}


def _menu_keyboard() -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton("💵 Deposit USDC (any chain)", callback_data="fund_usdc")],
    ]
    if _cctp_enabled():
        rows.append([InlineKeyboardButton("🟢 USDC via CCTP (native)", callback_data="fund_cctp")])
    native_row = [
        InlineKeyboardButton(NATIVE_LABELS[a], callback_data=f"fund_native_{a}")
        for a in HYPERUNIT_ASSETS
        if a in NATIVE_LABELS
    ]
    if native_row:
        rows.append(native_row)
    rows.append([InlineKeyboardButton("🔙 Back", callback_data="perps_back")])
    return InlineKeyboardMarkup(rows)


async def _edit(update: Update, text: str, keyboard: InlineKeyboardMarkup):
    if update.callback_query is not None:
        await update.callback_query.edit_message_text(
            text, reply_markup=keyboard, parse_mode="Markdown", disable_web_page_preview=True
        )
    else:
        await update.message.reply_text(
            text, reply_markup=keyboard, parse_mode="Markdown", disable_web_page_preview=True
        )


async def fund_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/fund — open the HyperLiquid deposit menu."""
    account = perps_service.get_account(update.effective_user.id)
    if not account or not account.hl_address:
        await _edit(
            update,
            "💰 *Fund HyperLiquid*\n\n"
            "Connect your HyperLiquid account first (Perps → Setup) so we know "
            "where to send funds.",
            InlineKeyboardMarkup(
                [[InlineKeyboardButton("🔑 Setup Account", callback_data="perps_setup")]]
            ),
        )
        return
    bal = await hyperliquid_funding.get_hl_balance(update.effective_user.id)
    bal_line = (
        f"Balance: *${bal.get('perps_usd', 0):,.2f}* perp · "
        f"*${bal.get('spot_usd', 0):,.2f}* spot\n\n"
    )
    await _edit(
        update,
        "💰 *Fund HyperLiquid*\n\n"
        f"{bal_line}"
        "Top up your HyperCore account from any chain — funds arrive as a USDC "
        "spot balance (or native BTC/ETH/SOL via HyperUnit).\n\n"
        "Choose how you'd like to deposit:",
        _menu_keyboard(),
    )


async def fund_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Dispatch all `fund_*` callbacks."""
    query = update.callback_query
    await query.answer()
    data = query.data
    user_id = update.effective_user.id

    # Top-level menu.
    if data == "fund_menu":
        return await fund_command(update, context)

    # ---- Native (HyperUnit) ------------------------------------------- #
    if data.startswith("fund_native_"):
        asset = data.replace("fund_native_", "")
        return await _show_native(update, context, user_id, asset)

    # ---- USDC: chain selection ---------------------------------------- #
    if data == "fund_usdc":
        rows = [
            [InlineKeyboardButton(c.capitalize(), callback_data=f"fund_uchain_{c}")]
            for c in USDC_CHAINS
        ]
        rows.append([InlineKeyboardButton("🔙 Back", callback_data="fund_menu")])
        return await _edit(
            update,
            "💵 *Deposit USDC*\n\nWhich chain are your USDC funds on?",
            InlineKeyboardMarkup(rows),
        )

    # ---- USDC: amount selection --------------------------------------- #
    if data.startswith("fund_uchain_"):
        chain = data.replace("fund_uchain_", "")
        amt_buttons = [
            InlineKeyboardButton(f"${a}", callback_data=f"fund_uamt_{chain}_{a}")
            for a in USDC_AMOUNTS
        ]
        # 3 amounts per row.
        rows = [amt_buttons[i : i + 3] for i in range(0, len(amt_buttons), 3)]
        rows.append([InlineKeyboardButton("🔙 Back", callback_data="fund_usdc")])
        return await _edit(
            update,
            f"💵 *Deposit USDC from {chain.capitalize()}*\n\n"
            f"How much USDC? (min {MIN_USDC_DEPOSIT:g})",
            InlineKeyboardMarkup(rows),
        )

    # ---- USDC: quote + confirm ---------------------------------------- #
    if data.startswith("fund_uamt_"):
        _, _, chain, amt = data.split("_", 3)
        return await _show_usdc_quote(update, context, user_id, chain, float(amt))

    # ---- USDC: execute ------------------------------------------------ #
    if data == "fund_exec":
        return await _execute_usdc(update, context, user_id)

    # ---- USDC: move landed spot balance to perp ----------------------- #
    if data == "fund_toperp":
        return await _move_to_perp(update, context, user_id)

    # ---- Native: poll HyperUnit mint status --------------------------- #
    if data == "fund_natstat":
        return await _check_native_status(update, context, user_id)

    # ---- CCTP (native USDC) ------------------------------------------- #
    # Defensive: the CCTP buttons are hidden when disabled, but refuse stale
    # initiations too (status checks stay allowed so past deposits are viewable).
    if (
        data == "fund_cctp"
        or data.startswith("fund_cchain_")
        or data.startswith("fund_camt_")
        or data == "fund_cexec"
    ) and not _cctp_enabled():
        return await _edit(update, "CCTP deposits aren't enabled right now.", _menu_keyboard())

    if data == "fund_cctp":
        rows = [
            [InlineKeyboardButton(c.capitalize(), callback_data=f"fund_cchain_{c}")]
            for c in CCTP_CHAINS
        ]
        rows.append([InlineKeyboardButton("🔙 Back", callback_data="fund_menu")])
        return await _edit(
            update,
            "🟢 *Deposit native USDC (CCTP)*\n\nWhich chain are your USDC funds on?",
            InlineKeyboardMarkup(rows),
        )

    if data.startswith("fund_cchain_"):
        chain = data.replace("fund_cchain_", "")
        amt_buttons = [
            InlineKeyboardButton(f"${a}", callback_data=f"fund_camt_{chain}_{a}")
            for a in USDC_AMOUNTS
        ]
        rows = [amt_buttons[i : i + 3] for i in range(0, len(amt_buttons), 3)]
        rows.append([InlineKeyboardButton("🔙 Back", callback_data="fund_cctp")])
        return await _edit(
            update,
            f"🟢 *Native USDC from {chain.capitalize()}*\n\nHow much USDC? (min {MIN_USDC_DEPOSIT:g})",
            InlineKeyboardMarkup(rows),
        )

    if data.startswith("fund_camt_"):
        _, _, chain, amt = data.split("_", 3)
        return await _show_cctp_quote(update, context, user_id, chain, float(amt))

    if data == "fund_cexec":
        return await _execute_cctp(update, context, user_id)

    if data == "fund_cctpstat":
        return await _check_cctp_status(update, context, user_id)


async def _show_native(
    update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int, asset: str
):
    """Generate and display a HyperUnit deposit address for a native asset."""
    try:
        instr = await hyperliquid_funding.get_native_deposit_instructions(user_id, asset)
    except FundingError as e:
        return await _edit(update, f"⚠️ {e}", _menu_keyboard())
    except Exception as e:  # noqa: BLE001 — surface upstream/bridge errors to the user
        logger.warning("HyperUnit address gen failed (user %s, %s): %s", user_id, asset, e)
        return await _edit(
            update,
            "⚠️ Couldn't generate a deposit address right now. Try again shortly.",
            _menu_keyboard(),
        )

    # Stash the address so "Check status" stays within callback_data limits.
    context.user_data["fund_native_addr"] = instr.deposit_address
    context.user_data["fund_native_asset"] = instr.asset

    eta_min = max(1, instr.eta_seconds // 60)
    text = (
        f"{NATIVE_LABELS.get(instr.asset, instr.asset.upper())} *Deposit*\n\n"
        f"Send **{instr.asset.upper()}** on *{instr.src_chain}* to this address — "
        f"it credits your HyperCore spot balance automatically:\n\n"
        f"`{instr.deposit_address}`\n\n"
        f"• Minimum: *{instr.min_amount:g} {instr.asset.upper()}* "
        f"(less may be lost)\n"
        f"• Arrives in ~{eta_min} min after confirmation\n"
        f"• Credited to `{instr.hl_address}`\n\n"
        f"_Bridged by HyperUnit (2-of-3 MPC). Only send {instr.asset.upper()} on "
        f"{instr.src_chain}._"
    )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("🔄 Check deposit status", callback_data="fund_natstat")],
            [InlineKeyboardButton("🔙 Back", callback_data="fund_menu")],
        ]
    )
    await _edit(update, text, keyboard)


async def _show_usdc_quote(
    update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int, chain: str, amount: float
):
    """Quote a USDC deposit and present a confirmation screen."""
    wallet = wallet_service.get_default_wallet(user_id, "evm")
    if not wallet:
        return await _edit(
            update,
            "⚠️ You need an EVM wallet to deposit USDC. Create one in /wallet first.",
            _menu_keyboard(),
        )

    try:
        quote = await hyperliquid_funding.quote_usdc_deposit(
            user_id=user_id,
            from_chain=chain,
            amount_human=amount,
            depositor_address=wallet.address,
        )
    except FundingError as e:
        return await _edit(update, f"⚠️ {e}", _menu_keyboard())
    except Exception as e:  # noqa: BLE001
        logger.warning("USDC deposit quote failed (user %s): %s", user_id, e)
        return await _edit(
            update, "⚠️ Couldn't get a quote right now. Try again shortly.", _menu_keyboard()
        )

    # Stash everything execute needs (callbacks are stateless).
    context.user_data["fund_quote"] = quote
    context.user_data["fund_wallet"] = {"id": wallet.id, "address": wallet.address}

    eta = quote.estimated_fill_time
    fee = max(0.0, amount - quote.expected_output_human)
    text = (
        f"💵 *Confirm Deposit*\n\n"
        f"From: *{amount:g} USDC* on {chain.capitalize()}\n"
        f"To: your HyperCore account\n"
        f"`{quote.recipient}`\n\n"
        f"• You receive ~*{quote.expected_output_human:.2f} USDC* spot\n"
        f"• Bridge fee: ~*{fee:.2f} USDC*\n"
        f"• Arrives in ~{eta}s after the deposit confirms\n"
        f"• Signed from `{wallet.address}`\n\n"
        f"_Funds land as spot; tap Move to Perp after they arrive to trade._"
    )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("✅ Confirm & Deposit", callback_data="fund_exec")],
            [InlineKeyboardButton("🔙 Back", callback_data=f"fund_uchain_{chain}")],
        ]
    )
    await _edit(update, text, keyboard)


async def _execute_usdc(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int):
    """Broadcast the stored deposit quote."""
    quote = context.user_data.get("fund_quote")
    wallet_data = context.user_data.get("fund_wallet")
    if not quote or not wallet_data:
        return await _edit(
            update, "⚠️ That quote expired. Start the deposit again.", _menu_keyboard()
        )

    await _edit(
        update,
        "⏳ Submitting your deposit… this can take a moment.",
        InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Back", callback_data="fund_menu")]]),
    )

    try:
        tx_hash = await hyperliquid_funding.execute_usdc_deposit(wallet_data, quote)
    except Exception as e:  # noqa: BLE001 — show any execution error, don't crash the bot
        logger.warning("USDC deposit execution failed (user %s): %s", user_id, e)
        return await _edit(
            update,
            f"⚠️ Deposit failed: {e}\n\nNo funds were moved if you don't see a tx.",
            _menu_keyboard(),
        )

    # Remember the landed amount so "Move to Perp" can act once it credits.
    landed = round(quote.expected_output_human, 2)
    context.user_data["fund_landed_amount"] = landed
    context.user_data.pop("fund_quote", None)
    context.user_data.pop("fund_wallet", None)

    eta = quote.estimated_fill_time
    text = (
        "✅ *Deposit submitted!*\n\n"
        f"Tx: `{tx_hash}`\n\n"
        f"~*{landed:.2f} USDC* will land as spot on your HyperCore account in ~{eta}s. "
        "Once it arrives, move it to your perp wallet to start trading."
    )
    await _edit(
        update,
        text,
        InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("➡️ Move to Perp wallet", callback_data="fund_toperp")],
                [InlineKeyboardButton("🔙 Back", callback_data="perps_back")],
            ]
        ),
    )


async def _move_to_perp(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int):
    """Move the just-deposited USDC spot balance into the perp wallet."""
    amount = context.user_data.get("fund_landed_amount")
    if not amount:
        return await _edit(
            update,
            "⚠️ Nothing to move — make a deposit first.",
            _menu_keyboard(),
        )
    try:
        ok = await hyperliquid_funding.move_spot_to_perp(user_id, float(amount))
    except Exception as e:  # noqa: BLE001
        logger.warning("Spot->perp move failed (user %s): %s", user_id, e)
        ok = False

    if ok:
        context.user_data.pop("fund_landed_amount", None)
        text = (
            f"✅ Moved *{float(amount):.2f} USDC* to your perp wallet. "
            "You're ready to trade perps."
        )
    else:
        text = (
            "⚠️ Couldn't move funds yet — the deposit may still be landing. "
            "Wait a few seconds and try again."
        )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("🔁 Try again", callback_data="fund_toperp")],
            [InlineKeyboardButton("🔙 Back", callback_data="perps_back")],
        ]
    )
    await _edit(update, text, keyboard)


async def _check_native_status(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int):
    """Poll HyperUnit for the mint status of the user's last native deposit."""
    address = context.user_data.get("fund_native_addr")
    asset = (context.user_data.get("fund_native_asset") or "").upper()
    if not address:
        return await _edit(update, "⚠️ No pending deposit to check.", _menu_keyboard())
    try:
        op = await hyperliquid_funding.check_native_status(address)
    except Exception as e:  # noqa: BLE001
        logger.warning("HyperUnit status check failed (user %s): %s", user_id, e)
        return await _edit(
            update,
            "⚠️ Couldn't check status right now. Try again shortly.",
            InlineKeyboardMarkup(
                [[InlineKeyboardButton("🔄 Retry", callback_data="fund_natstat")]]
            ),
        )

    if op.is_done:
        tx = op.destination_tx_hash or "—"
        text = f"✅ Your {asset} deposit landed on HyperCore!\n\n" f"Credit tx: `{tx}`"
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("🔙 Back", callback_data="perps_back")]]
        )
    else:
        text = (
            f"⏳ {asset} deposit *{op.state}*.\n\n"
            "It'll credit your HyperCore spot balance once the source-chain "
            "transfer confirms. Check again in a bit."
        )
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("🔄 Check again", callback_data="fund_natstat")],
                [InlineKeyboardButton("🔙 Back", callback_data="fund_menu")],
            ]
        )
    await _edit(update, text, keyboard)


async def _show_cctp_quote(
    update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int, chain: str, amount: float
):
    """Quote a CCTP native-USDC deposit and present a confirmation screen."""
    wallet = wallet_service.get_default_wallet(user_id, "evm")
    if not wallet:
        return await _edit(
            update,
            "⚠️ You need an EVM wallet to deposit USDC. Create one in /wallet first.",
            _menu_keyboard(),
        )
    try:
        # Recipient is the custodial wallet so the relayer can complete the credit.
        quote = await hyperliquid_funding.quote_cctp_deposit(
            from_chain=chain,
            amount_human=amount,
            recipient_address=wallet.address,
        )
    except FundingError as e:
        return await _edit(update, f"⚠️ {e}", _menu_keyboard())
    except Exception as e:  # noqa: BLE001
        logger.warning("CCTP quote failed (user %s): %s", user_id, e)
        return await _edit(
            update, "⚠️ Couldn't get a CCTP quote right now. Try again shortly.", _menu_keyboard()
        )

    context.user_data["fund_cctp_quote"] = quote
    context.user_data["fund_cctp_wallet"] = {"id": wallet.id, "address": wallet.address}

    fee = quote.max_fee / 1e6
    text = (
        f"🟢 *Confirm Native USDC Deposit*\n\n"
        f"From: *{amount:g} USDC* on {chain.capitalize()}\n"
        f"To: your HyperCore account\n`{quote.recipient}`\n\n"
        f"• You receive ~*{quote.expected_output_human:.2f} USDC* spot\n"
        f"• CCTP fee: ~*{fee:.2f} USDC* (Fast)\n"
        f"• ~{quote.estimated_time}s + relayer completion on HyperEVM\n\n"
        f"_You sign the burn; Suwappu's relayer finishes the mint + HyperCore "
        f"credit (it pays HyperEVM gas)._"
    )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("✅ Confirm & Deposit", callback_data="fund_cexec")],
            [InlineKeyboardButton("🔙 Back", callback_data=f"fund_cchain_{chain}")],
        ]
    )
    await _edit(update, text, keyboard)


async def _execute_cctp(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int):
    """Sign + broadcast the CCTP burn, then hand off to the relayer."""
    quote = context.user_data.get("fund_cctp_quote")
    wallet_data = context.user_data.get("fund_cctp_wallet")
    if not quote or not wallet_data:
        return await _edit(
            update, "⚠️ That quote expired. Start the deposit again.", _menu_keyboard()
        )

    await _edit(
        update,
        "⏳ Submitting your burn… the relayer will complete the deposit shortly.",
        InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Back", callback_data="fund_menu")]]),
    )
    try:
        burn_hash = await hyperliquid_funding.execute_cctp_burn(wallet_data, quote)
        cctp_relayer.record_burn(
            user_id=user_id,
            recipient_address=quote.recipient,
            from_chain=quote.from_chain,
            burn_tx_hash=burn_hash,
            amount_raw=int(quote.input_amount),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("CCTP burn execution failed (user %s): %s", user_id, e)
        return await _edit(
            update,
            f"⚠️ Deposit failed: {e}\n\nNo funds were moved if you don't see a tx.",
            _menu_keyboard(),
        )
    finally:
        context.user_data.pop("fund_cctp_quote", None)
        context.user_data.pop("fund_cctp_wallet", None)

    text = (
        "✅ *Burn submitted!*\n\n"
        f"Tx: `{burn_hash}`\n\n"
        "Our relayer is finishing the mint + HyperCore credit (native USDC, ~1-2 min). "
        "You'll get a message when it lands as spot."
    )
    await _edit(
        update,
        text,
        InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("🔄 Check CCTP status", callback_data="fund_cctpstat")],
                [InlineKeyboardButton("🔙 Back", callback_data="perps_back")],
            ]
        ),
    )


_CCTP_STATUS_LABEL = {
    "burned": "⏳ Burned — awaiting Circle attestation",
    "attested": "⏳ Attested — minting on HyperEVM",
    "minted": "⏳ Minted — crediting HyperCore",
    "credited": "✅ Credited to HyperCore spot",
    "failed": "⚠️ Failed — our team will retry",
}


async def _check_cctp_status(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int):
    """Show the user their most recent CCTP deposit's progress."""
    dep = cctp_relayer.latest_for_user(user_id)
    if not dep:
        return await _edit(update, "No CCTP deposits yet.", _menu_keyboard())

    label = _CCTP_STATUS_LABEL.get(dep["status"], dep["status"])
    lines = [
        "🟢 *CCTP Deposit Status*\n",
        f"Amount: *${dep['amount_usd']:,.2f} USDC* from {dep['from_chain'].capitalize()}",
        f"Status: {label}",
    ]
    if dep["status"] == "credited":
        lines.append("\nMove it to your perp wallet to trade.")
    keyboard_rows = []
    if dep["status"] not in ("credited", "failed"):
        keyboard_rows.append(
            [InlineKeyboardButton("🔄 Check again", callback_data="fund_cctpstat")]
        )
    keyboard_rows.append([InlineKeyboardButton("🔙 Back", callback_data="fund_menu")])
    await _edit(update, "\n".join(lines), InlineKeyboardMarkup(keyboard_rows))


# Handlers to register in main.py.
fund_command_handler = CommandHandler("fund", fund_command)
fund_callback_handler = CallbackQueryHandler(fund_callback, pattern="^fund_")
