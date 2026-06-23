"""Paste-to-trade and freeform intent routing.

The single most-expected interaction in this category — paste a token contract
address with no command and get a token card + safety check + Buy buttons — was
absent. This adds it, plus:

  * a deterministic keyword router so freeform text isn't silently dropped, and
  * the /check command, which surfaces the (previously silent) token-safety
    engine as a first-class front door.

WIRING (see bot/main.py add_handlers): on_freeform_text is registered in the
DEFAULT group (0) AFTER every ConversationHandler. PTB runs at most one handler
per group, and a ConversationHandler only "matches" a text update when a
conversation is already active — so plain text falls through to this handler
ONLY when nothing else is handling it. (Registering in a later group would
double-fire during active conversations.)

The Buy buttons hand off to swap.paste_buy_entry, which seeds the normal swap
context and runs the existing quote → confirm → 2FA → spending-limit path. No
new surface executes a swap directly.
"""

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from bot.config.chains import get_chain_by_name
from bot.services.alchemy_client import get_alchemy_client, is_alchemy_configured
from bot.services.sniping.pump_fun_api import pump_fun_api
from bot.services.token_security.token_analyzer import token_analyzer
from bot.utils.validators import detect_address_chain

logger = logging.getLogger(__name__)

# EVM chains probed (priority order) when a 0x address is pasted — the first
# chain whose metadata resolves wins. Must match alchemy_client._get_base_url.
EVM_PROBE_CHAINS = ["base", "ethereum", "arbitrum", "optimism", "polygon", "bsc"]

# Preset buy amounts, denominated in each chain's NATIVE token.
PRESET_AMOUNTS = {
    "SOL": [0.1, 0.5, 1.0, 5.0],
    "ETH": [0.01, 0.05, 0.1, 0.5],
    "BNB": [0.05, 0.1, 0.5, 1.0],
    "POL": [10, 50, 100, 500],
    "MATIC": [10, 50, 100, 500],
    "TRX": [100, 500, 1000, 5000],
}
DEFAULT_PRESETS = [0.01, 0.05, 0.1, 0.5]


def _short(addr: str) -> str:
    return f"{addr[:6]}…{addr[-4:]}" if len(addr) > 12 else addr


def build_buy_keyboard(native_symbol: str) -> InlineKeyboardMarkup:
    """Reusable Buy keyboard for a pending ``paste_token``.

    Used by both the paste-to-trade card and the /trending token view so the
    Buy experience is identical everywhere. The buttons carry only
    ``pbuy_<amount>`` / ``pbuy_custom`` so the swap ConversationHandler's
    ``^pbuy_`` entry_point (swap.paste_buy_entry) drives execution — no surface
    executes a swap directly. Callers MUST have already stashed
    ``context.user_data["paste_token"]`` before showing this keyboard.
    """
    presets = PRESET_AMOUNTS.get(native_symbol, DEFAULT_PRESETS)
    rows, row = [], []
    for i, amt in enumerate(presets):
        row.append(InlineKeyboardButton(f"{amt} {native_symbol}", callback_data=f"pbuy_{amt}"))
        if (i + 1) % 2 == 0:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([InlineKeyboardButton("✏️ Custom amount", callback_data="pbuy_custom")])
    rows.append([InlineKeyboardButton("❌ Cancel", callback_data="paste_cancel")])
    return InlineKeyboardMarkup(rows)


async def get_token_info(address: str, chain_family: str) -> dict:
    """Resolve {chain, address, symbol, name, decimals} for a pasted address.

    chain_family comes from detect_address_chain ("evm"|"solana"|"tron"|
    "starknet"). For EVM a specific chain must be chosen (the swap flow needs a
    real chain, not the generic family), so we probe a prioritized list and use
    the first that returns metadata. Always returns a usable dict — falls back
    to identity-only info so the card still renders and the user can proceed.
    """
    if chain_family == "solana":
        tok = None
        try:
            tok = await pump_fun_api.get_token(address)
        except Exception as e:
            logger.debug(f"pump.fun lookup failed for {address}: {e}")
        return {
            "chain": "solana",
            "address": address,
            "symbol": getattr(tok, "symbol", None) or "Token",
            "name": getattr(tok, "name", None) or "Solana token",
            "decimals": 9,
        }

    if chain_family == "evm":
        if is_alchemy_configured():
            client = get_alchemy_client()
            for chain in EVM_PROBE_CHAINS:
                try:
                    meta = await client.get_token_metadata(address, chain)
                except Exception as e:
                    logger.debug(f"alchemy metadata failed {address}@{chain}: {e}")
                    meta = None
                if meta and meta.symbol and meta.symbol != "???":
                    return {
                        "chain": chain,
                        "address": address,
                        "symbol": meta.symbol,
                        "name": meta.name,
                        "decimals": meta.decimals,
                    }
        # Unknown EVM token / Alchemy not configured — default to ethereum.
        return {
            "chain": "ethereum",
            "address": address,
            "symbol": "Token",
            "name": "EVM token",
            "decimals": 18,
        }

    # tron / starknet: identity only in v1 (no metadata provider wired yet).
    chain = "tron" if chain_family == "tron" else "starknet"
    return {
        "chain": chain,
        "address": address,
        "symbol": "Token",
        "name": f"{chain_family} token",
        "decimals": 6 if chain == "tron" else 18,
    }


async def _render_token_card(
    update: Update, context: ContextTypes.DEFAULT_TYPE, address: str, chain_family: str
) -> None:
    """Render the token card + Buy buttons and stash the pending token.

    Stashes context.user_data["paste_token"] so swap.paste_buy_entry can read
    the (chain, address, symbol) without exceeding Telegram's 64-byte
    callback_data limit (Buy buttons carry only "pbuy_<amount>").
    """
    info = await get_token_info(address, chain_family)
    context.user_data["paste_token"] = info

    chain_config = get_chain_by_name(info["chain"])
    native = chain_config.native_token if chain_config else "ETH"
    chain_label = chain_config.display_name if chain_config else info["chain"]
    chain_emoji = chain_config.logo_emoji if chain_config else ""

    # Safety check — meaningful on Solana (authority/honeypot are SVM concepts);
    # degrade honestly elsewhere rather than imply a check we didn't run.
    if info["chain"] == "solana":
        try:
            is_safe, warnings = await token_analyzer.quick_check(address)
            if is_safe and not warnings:
                safety = "🛡️ Safety: no immediate red flags"
            elif warnings:
                safety = "⚠️ Safety: " + "; ".join(warnings)
            else:
                safety = "⚠️ Safety: use caution"
        except Exception:
            safety = "🛡️ Safety: check unavailable"
    else:
        safety = "🛡️ Safety: limited on this chain — verify the contract yourself"

    text = (
        f"*{info['symbol']}* — {info.get('name', '')}\n"
        f"{chain_emoji} {chain_label}  `{_short(address)}`\n\n"
        f"{safety}\n\n"
        f"Buy with {native}:"
    )

    await update.message.reply_text(
        text, parse_mode="Markdown", reply_markup=build_buy_keyboard(native)
    )


async def on_freeform_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Catch raw text with no command: paste-to-trade, else a keyword router."""
    if not update.message or not update.message.text:
        return
    text = update.message.text.strip()
    if not text:
        return

    # First whitespace-delimited token is the address candidate.
    first = text.split()[0]
    is_addr, family = detect_address_chain(first)
    if is_addr:
        await _render_token_card(update, context, first, family)
        return

    await _route_intent(update, context, text.lower())


async def _route_intent(update: Update, context: ContextTypes.DEFAULT_TYPE, lowered: str) -> None:
    """Deterministic keyword → action router (no LLM). Never silently drops."""
    buttons = []
    if any(k in lowered for k in ("buy", "sell", "swap", "trade")):
        buttons.append(InlineKeyboardButton("💱 Swap", callback_data="swap_start"))
    if any(k in lowered for k in ("check", "safe", "honeypot", "rug", "scam")):
        buttons.append(InlineKeyboardButton("🛡️ Check a token", callback_data="paste_check_hint"))
    if any(k in lowered for k in ("price", "balance", "portfolio", "holding", "worth")):
        buttons.append(InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"))
    if any(k in lowered for k in ("alert", "notify")):
        buttons.append(InlineKeyboardButton("🔔 Alerts", callback_data="alerts_menu"))
    if any(k in lowered for k in ("trend", "hot", "launch", "new pair")):
        buttons.append(InlineKeyboardButton("🔥 Trending", callback_data="trending_open"))

    if not buttons:
        buttons = [
            InlineKeyboardButton("💱 Swap", callback_data="swap_start"),
            InlineKeyboardButton("📂 Menu", callback_data="main_menu"),
        ]

    rows = [buttons[i : i + 2] for i in range(0, len(buttons), 2)]
    await update.message.reply_text(
        "I didn't catch a command there. Paste a token address to trade it, "
        "or tap one of these:",
        reply_markup=InlineKeyboardMarkup(rows),
    )


async def paste_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    context.user_data.pop("paste_token", None)
    await query.edit_message_text("Cancelled.")


async def paste_check_hint_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "🛡️ *Check a token*\n\nSend `/check <address>` or just paste the token "
        "contract address — I'll run a safety check and show Buy options.",
        parse_mode="Markdown",
    )


async def check_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/check <address> — front door to the token-safety engine."""
    if not context.args:
        await update.message.reply_text(
            "Usage: `/check <token address>`\n\nOr just paste the address.",
            parse_mode="Markdown",
        )
        return
    addr = context.args[0].strip()
    is_addr, family = detect_address_chain(addr)
    if not is_addr:
        await update.message.reply_text("❌ That doesn't look like a valid token address.")
        return
    await _render_token_card(update, context, addr, family)
