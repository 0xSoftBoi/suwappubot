"""Pre-built message templates for faster responses."""

# Common messages (avoid repeated string building)
LOADING_BALANCE = "⏳ Fetching balances..."
LOADING_QUOTE = "🔄 Getting quote..."
LOADING_SWAP = "⏳ Executing swap..."
LOADING_GENERIC = "⏳ Loading..."

NO_WALLETS = "👛 You don't have any wallets yet.\n\nAdd a wallet to get started!"
START_FIRST = "❌ Please use /start first to set up your account."
WALLET_NOT_FOUND = "❌ Wallet not found."
SESSION_EXPIRED = "❌ Session expired. Please start again."

# Pre-built keyboard configs (avoid repeated object creation)
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

MAIN_MENU_KEYBOARD = InlineKeyboardMarkup([
    [InlineKeyboardButton("━━ 🔐 SELF-CUSTODY ━━", callback_data="noop")],
    [
        InlineKeyboardButton("👛 My Wallets", callback_data="wallet_menu"),
        InlineKeyboardButton("💰 Balance", callback_data="balance"),
    ],
    [InlineKeyboardButton("🔄 Swap", callback_data="swap_start")],
    [InlineKeyboardButton("━━ 🏦 CUSTODIAL ━━", callback_data="noop")],
    [InlineKeyboardButton("🏦 Custodial Account", callback_data="custodial_menu")],
    [InlineKeyboardButton("━━━━━━━━━━━━", callback_data="noop")],
    [
        InlineKeyboardButton("📊 Portfolio", callback_data="portfolio"),
        InlineKeyboardButton("📖 Help", callback_data="help"),
    ],
])

BACK_MENU_KEYBOARD = InlineKeyboardMarkup([
    [InlineKeyboardButton("« Back", callback_data="main_menu")],
])

WALLET_ADD_KEYBOARD = InlineKeyboardMarkup([
    [InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")],
])

BALANCE_KEYBOARD = InlineKeyboardMarkup([
    [
        InlineKeyboardButton("🔄 Refresh", callback_data="balance"),
        InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
    ],
    [InlineKeyboardButton("« Back", callback_data="main_menu")],
])


WELCOME_MESSAGE = """
🌸 *suwappu* — fast cross-chain swaps with a native C\+\+ core\!

🔄 *Welcome to Suwappu Bot*

Cross-chain swaps made simple.

🎁 *Referral Blitz*: earn 50% of fees from friends + instant bonuses.
Use /referral to grab your link.

*Choose Your Mode:*

🔐 *Self\-Custody* \(Your Keys\)
You control your private keys
Pay your own gas fees

🏦 *Custodial* \(We Manage\)
No gas fees \- we pay for you
Instant deposits & withdrawals

━━━━━━━━━━━━━━━━━━━━

*Supported Chains:*
🔷 ETH • 🟣 Polygon • 🟡 BSC
🔵 Arbitrum • 🔴 Optimism • 🔵 Base • 🟢 Solana

Powered by Li\.Fi, Jupiter & LayerZero
"""

HELP_MESSAGE = """
🌸 *suwappu help*

📖 *Help Guide*

━━ 🔐 *SELF\-CUSTODY MODE* ━━
_You hold your private keys_

• /wallet \- Create/import your wallet
• /balance \- Check your balances
• /swap \- Swap with your wallet
• /history \- View transactions

⚠️ You pay gas fees from your wallet

━━ 🏦 *CUSTODIAL MODE* ━━
_We manage funds for you_

• /custodial \- View custodial account
  ↳ Deposit \- Send tokens to us
  ↳ Withdraw \- Get tokens back
  ↳ Swap \- Trade with zero gas

✅ We pay all gas fees for you\!

━━━━━━━━━━━━━━━━━━━━

*Other Commands:*
• /portfolio \- All holdings \+ USD value
• /gas \- Live gas prices
• /favorites \- Saved swap pairs
• /settings \- Preferences

*Fees:*
• 1% swap fee on all trades
• Gas sponsored in custodial mode
"""
