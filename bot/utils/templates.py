"""Pre-built message templates for faster responses."""

from typing import Optional

# Common messages (avoid repeated string building)
LOADING_BALANCE = "⏳ Fetching balances..."

NO_WALLETS = "👛 You don't have any wallets yet.\n\nAdd a wallet to get started!"
START_FIRST = "❌ Please use /start first to set up your account."

# Pre-built keyboard configs (avoid repeated object creation)
from telegram import CopyTextButton, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import InlineKeyboardButtonLimit

# ============================================
# Canonical button label vocabulary
# ============================================
# The bot accumulated six different "Back" glyphs, two "Cancel" spellings, and
# 14+ different "Confirm" labels across handlers (each file picked its own
# ad-hoc string). These constants give new/refactored code ONE spelling to
# import instead of inventing another variant. The winner in each case is
# whichever spelling was already most common in the codebase (verified via
# `grep -rhoE 'InlineKeyboardButton\(\s*"[^"]*Back[^"]*"' bot/ --include="*.py"
# | sort | uniq -c`, same pattern for Cancel/Confirm/"Main Menu"), so adopting
# these constants elsewhere is a near-zero visual diff rather than yet another
# new look:
#   « Back        - 96 existing call sites (next: bare "Back" x32, "🔙 Back" x17)
#   « Main Menu   - 20 existing call sites (next: "🏠 Main Menu" x2)
#   ❌ Cancel     - 56 existing call sites (next: bare "Cancel" x44)
#   🚀 Confirm    - 6 existing call sites (most-common of 14+ one-off spellings)
# Other agents/handlers are expected to migrate onto these over time — this
# module only defines them and applies them to the keyboards it directly owns.
BACK = "« Back"
HOME = "« Main Menu"
CANCEL = "❌ Cancel"
CONFIRM = "🚀 Confirm"


# ============================================
# One-tap copy buttons (Bot API 7.11+ CopyTextButton)
# ============================================
# Telegram caps the payload of a copy_text button at 256 characters (see
# telegram.constants.InlineKeyboardButtonLimit.MAX_COPY_TEXT). We guard rather
# than truncate: silently shipping a truncated wallet address, referral code,
# or Lightning invoice would let a user "successfully" tap-copy a corrupted
# value with no visible error. Returning None instead means callers must
# explicitly check before adding the button to a keyboard row — some BOLT11
# Lightning invoices (which can exceed 256 chars once routing hints are
# encoded) legitimately have no copy button, and that's the correct behavior,
# not a bug.
MAX_COPY_TEXT_LEN = InlineKeyboardButtonLimit.MAX_COPY_TEXT  # 256


def copy_button(label: str, value: str) -> Optional[InlineKeyboardButton]:
    """Build a one-tap "copy to clipboard" inline button.

    Args:
        label: Button text shown to the user (e.g. "📋 Copy Address").
        value: The exact text copied to the clipboard on tap. Must be
            1-256 characters (Telegram's CopyTextButton limit).

    Returns:
        An InlineKeyboardButton wired to a CopyTextButton, or None if `value`
        is empty or exceeds Telegram's 256-character limit. Callers MUST
        check for None before appending the button to a keyboard row.
    """
    if not value or len(value) > MAX_COPY_TEXT_LEN:
        return None
    return InlineKeyboardButton(label, copy_text=CopyTextButton(text=value))


WALLET_ADD_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")],
    ]
)


TOS_KEYBOARD = InlineKeyboardMarkup(
    [
        [
            InlineKeyboardButton("✅ I Accept", callback_data="tos_accept"),
            InlineKeyboardButton("❌ Decline", callback_data="tos_decline"),
        ]
    ]
)


WELCOME_MESSAGE = r"""
🌸 *suwappu* — fast cross-chain swaps with a native C\+\+ core\!

🔄 *Welcome to Suwappu Bot*

Cross-chain swaps made simple.

🎁 *Referral Blitz*: earn 30% of fees from friends + instant bonuses.
Use /ref to grab your link.

*Choose Your Mode:*

🔐 *Self\-Custody* \(Your Keys\)
You control your private keys
Pay your own gas fees

🏦 *Custodial* \(We Manage\)
No gas fees \- we pay for you
Instant deposits & withdrawals

━━━━━━━━━━━━━━━━━━━━

*Supported Chains:*
🔷 ETH • 🟣 POL • 🟡 BSC
🔵 ARB • 🔴 OP • 🔵 Base • 🟢 SOL

Powered by Li\.Fi, Jupiter & LayerZero
"""


def _get_display_fee_pct() -> str:
    """Return the FREE-tier swap fee rate as a display string (e.g. "1").

    Sourced from bot.services.fee_service.TIER_FEE_RATES — the single source
    of truth for swap fees (see bot/config/settings.py's swap_fee_percentage
    field docs and bot/services/tos_service.py's TOS_TEXT, both of which
    already treat 1% as the real FREE-tier rate). This intentionally shows
    the FREE-tier number since that's the rate every new user actually pays
    and the one quoted in the ToS; PRO/PREMIUM/ENTERPRISE pay less.

    The import is deliberately done here (inside the function, called once
    at module load time — AFTER the telegram/typing imports above have
    already succeeded) rather than as a top-level `from
    bot.services.fee_service import ...`: importing bot.services.fee_service
    pulls in the whole bot.services package __init__ (wallet/swap_engine/
    jupiter/hot_wallet/paymaster/etc — a much heavier and more failure-prone
    chain), and templates.py is itself imported early by several
    handlers/services (start.py, balance.py, tos_utils.py,
    unified_bot_service.py). If that chain ever grows a dependency back onto
    templates.py, catching the failure here and falling back to the
    ToS-matching default keeps the whole bot from crashing on import instead
    of just mis-rendering one help line.
    """
    try:
        from bot.models.subscription import SubscriptionTier
        from bot.services.fee_service import TIER_FEE_RATES

        rate = TIER_FEE_RATES.get(SubscriptionTier.FREE, 0.01)
    except Exception:  # pragma: no cover - defensive fallback only
        rate = 0.01
    pct = rate * 100
    text = f"{pct:g}"  # 1.0 -> "1", 0.5 -> "0.5"
    # Match this file's existing legacy-Markdown escaping convention, where a
    # literal "." is backslash-escaped (see the "0\.8%" it replaces below).
    return text.replace(".", "\\.")


_FEE_DISPLAY_PCT = _get_display_fee_pct()  # e.g. "1" — FREE-tier %, see helper docstring above

HELP_MESSAGE = rf"""
🌸 *suwappu help*

💡 *Fastest way to trade:* just *paste a token contract address* \(no command\) — I'll show a safety check \+ Buy buttons\. Or use /start for your live home screen\.

━━ 💱 *TRADE* ━━
• /s \- Swap any token \(7\+ chains\)
• /check \<address\> \- Token safety check 🛡️
• /trending \- What's hot right now 🔥
• /perps \- Perpetual futures \(HyperLiquid\)
• /predict \- Prediction markets \(Polymarket\)
• /o \- Limit orders   • /dca \- Auto\-buy
• /snipe \- Snipe new launches
• /pos \- Positions \& PnL   • /hx \- History

━━ 🏦 *EARN* ━━
• /save \- Yield on idle USDC \(Aave V3\)
• /borrow \- Borrow USDC against collateral
• /stake \- Stake HYPE   • /token \- SUWP staking
• /traders \- Copy top traders

━━ 👛 *WALLET* ━━
• /w \- Create / import wallets
• /b \- Balances   • /p \- Portfolio \+ USD
• /c \- Custodial \(zero\-gas\) account
• /btc \- BTC bridge \(Lightning ⇄ Starknet\)
• /2fa \- Enable 2FA   • /recover \- Social recovery

━━ 🔔 *TOOLS* ━━
• /a \- Price alerts   • /g \- Gas tracker
• /f \- Favorites   • /tax \- Tax export
• /set \- Settings   • /digest \- Weekly summary

━━ 🎮 *GROWTH* ━━
• /ref \- Referral code \(earn 30% of fees\)
• /xp \- Points   • /checkin \- Daily   • /lb \- Leaderboard
• /rewards \- Redeem points

_Tip: tap_ *📂 More\.\.\.* _on /start to see everything as buttons\._

*Fees:* {_FEE_DISPLAY_PCT}% per swap \(less on Pro/Premium/Enterprise tiers\) • gas sponsored in custodial mode
"""
