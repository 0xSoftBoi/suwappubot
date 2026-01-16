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


TOS_KEYBOARD = InlineKeyboardMarkup([
    [
        InlineKeyboardButton("✅ I Accept", callback_data="tos_accept"),
        InlineKeyboardButton("❌ Decline", callback_data="tos_decline"),
    ]
])


WELCOME_MESSAGE = """
🌸 *suwappu* — fast cross-chain swaps with a native C\+\+ core\!

🔄 *Welcome to Suwappu Bot*

Cross-chain swaps made simple.

🎁 *Referral Blitz*: earn 50% of fees from friends + instant bonuses.
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

HELP_MESSAGE = """
🌸 *suwappu help*

📖 *Help Guide*

━━ 🔐 *SELF\-CUSTODY MODE* ━━
_You hold your private keys_

• /w \- Create/import your wallet
• /b \- Check your balances
• /s \- Swap with your wallet
• /hx \- View transactions

⚠️ You pay gas fees from your wallet

━━ 🏦 *CUSTODIAL MODE* ━━
_We manage funds for you_

• /c \- View custodial account
  ↳ Deposit \- Send tokens to us
  ↳ Withdraw \- Get tokens back
  ↳ Swap \- Trade with zero gas

✅ We pay all gas fees for you\!

━━━━━━━━━━━━━━━━━━━━

*Other Commands:*
• /p \- All holdings \+ USD value
• /g \- Live gas prices
• /f \- Saved swap pairs
• /set \- Preferences

━━ 🎮 *GROWTH & SOCIAL* ━━

• /xp \- Your points \+ level
• /checkin \- Daily check\-in
• /lb \- XP leaderboard
• /rewards \- Redeem points

• /traders \- Top traders to follow
• /following \- Who you follow
• /profile \- Your trader profile

• /ref \- Your referral code
• /rewards \- Referral earnings

*Fees:*
• 0\.8% swap fee on all trades
• Gas sponsored in custodial mode
• Earn 30% from referral fees
"""
