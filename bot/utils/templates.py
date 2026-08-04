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

MAIN_MENU_KEYBOARD = InlineKeyboardMarkup(
    [
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
    ]
)

BACK_MENU_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]
)

WALLET_ADD_KEYBOARD = InlineKeyboardMarkup(
    [
        [InlineKeyboardButton("👛 Add Wallet", callback_data="wallet_menu")],
    ]
)

BALANCE_KEYBOARD = InlineKeyboardMarkup(
    [
        [
            InlineKeyboardButton("🔄 Refresh", callback_data="balance"),
            InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
        ],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
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


WELCOME_MESSAGE = """
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

HELP_MESSAGE = r"""
🌸 *suwappu help*

💡 *Fastest way to trade:* just *paste a token contract address* \(no command\) — I'll show a safety check \+ Buy buttons\. Or use /start for your live home screen\.

━━ 💱 *TRADE* ━━
• /s \- Swap any token \(7\+ chains\)
• /check \<address\> \- Token safety check 🛡️
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
• /model \- Choose your AI model 🤖
• /intel \<address\> \- Deployer \& holder report 🔎
• /devwatch \- Track deployer wallets 👁

━━ 🎮 *GROWTH* ━━
• /ref \- Referral code \(earn 30% of fees\)
• /xp \- Points   • /checkin \- Daily   • /lb \- Leaderboard
• /rewards \- Redeem points

_Tip: tap_ *📂 More\.\.\.* _on /start to see everything as buttons\._

*Fees:* 0\.8% per swap • gas sponsored in custodial mode
"""
