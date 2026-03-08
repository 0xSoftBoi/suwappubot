---
description: "Add a new Telegram bot command handler"
context: fork
---

# New Telegram Bot Handler

## Step-by-Step

### 1. Create Handler File

Create `bot/handlers/<name>.py` following the standard pattern:

```python
"""<Feature> handler."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)

from bot.models.user import User, Wallet
from database.db import get_session
from bot.utils.tos_utils import enforce_tos
from bot.utils.rate_limiter import enforce_rate_limit_for_update

import logging
logger = logging.getLogger(__name__)


@enforce_tos
@enforce_rate_limit_for_update
async def feature_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /feature command."""
    user_tg_id = update.effective_user.id

    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == user_tg_id).first()
        if not user:
            await update.message.reply_text("Please /start first.")
            return

        # Your logic here
        keyboard = [[InlineKeyboardButton("Action", callback_data="feature_action")]]
        await update.message.reply_text(
            "Feature response",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
```

### 2. For Multi-Step Flows (Conversation Handler)

```python
# Conversation states
STATE_A, STATE_B, CONFIRM = range(3)


async def start_flow(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Entry point for the conversation."""
    context.user_data["flow_data"] = {}
    # ... prompt user
    return STATE_A


async def handle_state_a(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle first step."""
    context.user_data["flow_data"]["value"] = update.message.text
    return STATE_B


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancel the conversation."""
    context.user_data.pop("flow_data", None)
    await update.message.reply_text("Cancelled.")
    return ConversationHandler.END


# Build conversation handler
feature_conversation = ConversationHandler(
    entry_points=[CommandHandler("feature", start_flow)],
    states={
        STATE_A: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_state_a)],
        STATE_B: [CallbackQueryHandler(handle_state_b, pattern=r"^feature_")],
    },
    fallbacks=[CommandHandler("cancel", cancel)],
    name="feature_conversation",
    persistent=False,
)
```

### 3. For Callback Query Handlers (Inline Buttons)

```python
async def feature_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline button presses."""
    query = update.callback_query
    await query.answer()  # Always answer the callback first

    data = query.data  # e.g., "feature_action_123"
    parts = data.split("_")

    with get_session() as session:
        # Process the action
        await query.edit_message_text("Updated response", parse_mode="Markdown")
```

### 4. Register in `bot/handlers/__init__.py`

Add imports and exports:

```python
from .feature import feature_handler, feature_callback  # or feature_conversation

__all__ = [
    # ... existing exports ...
    "feature_handler",
    "feature_callback",
]
```

### 5. Register in Bot Dispatcher (`bot/main.py`)

```python
# Simple command
application.add_handler(CommandHandler("feature", feature_handler))
application.add_handler(CallbackQueryHandler(feature_callback, pattern=r"^feature_"))

# Or conversation handler
application.add_handler(feature_conversation)
```

## Gotchas

- **callback_data 64-byte limit**: Telegram limits callback data to 64 bytes. Keep it short (e.g., `feat_123` not `feature_action_with_long_id_123`)
- **TOS check**: Always use `@enforce_tos` decorator — it checks TOS acceptance before running
- **Rate limiting**: Use `@enforce_rate_limit_for_update` for commands users might spam
- **State cleanup**: Always clear `context.user_data` keys in cancel/end handlers
- **Session scope**: Use `with get_session() as session:` — don't hold sessions across awaits
- **Parse mode**: Use `parse_mode="Markdown"` and escape special chars with `\`

## Reference Files

- `bot/handlers/swap.py` — canonical complex example (conversation handler with 4 states)
- `bot/handlers/portfolio.py` — simple command + callback example
- `bot/handlers/__init__.py` — handler registration
- `bot/utils/tos_utils.py` — `@enforce_tos` decorator
- `bot/utils/rate_limiter.py` — `@enforce_rate_limit_for_update` decorator
