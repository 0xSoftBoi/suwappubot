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

