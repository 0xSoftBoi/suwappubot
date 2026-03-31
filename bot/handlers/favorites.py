"""Favorites management handlers."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    ConversationHandler,
    MessageHandler,
    filters,
)
from datetime import datetime, timezone

from bot.models.user import User
from bot.models.favorites import FavoriteSwapPair
from bot.config.tokens import TOKENS
from bot.config.chains import CHAINS
from database.db import get_session


async def favorites_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /favorites command - show saved swap pairs."""
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        
        favorites = session.query(FavoriteSwapPair).filter(
            FavoriteSwapPair.user_id == db_user.id
        ).order_by(FavoriteSwapPair.use_count.desc()).all()
        
        if not favorites:
            await update.message.reply_text(
                "⭐ *Favorite Pairs*\n\n"
                "You haven't saved any favorite pairs yet.\n\n"
                "After completing a swap, you'll be asked if you want to save it as a favorite.",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔄 Start Swap", callback_data="swap_start")],
                    [InlineKeyboardButton("« Back", callback_data="main_menu")],
                ])
            )
            return
        
        # Store favorites for later use
        fav_data = [
            {
                "id": f.id,
                "name": f.display_name,
                "from_chain": f.from_chain,
                "from_token": f.from_token,
                "to_chain": f.to_chain,
                "to_token": f.to_token,
                "use_count": f.use_count,
            }
            for f in favorites
        ]
    
    lines = ["⭐ *Favorite Pairs*\n"]
    
    keyboard = []
    for fav in fav_data[:10]:  # Limit to 10
        lines.append(
            f"• *{fav['name']}*: {fav['from_chain']}/{fav['from_token']} → "
            f"{fav['to_chain']}/{fav['to_token']} ({fav['use_count']} uses)"
        )
        keyboard.append([
            InlineKeyboardButton(
                f"🔄 {fav['name']}", 
                callback_data=f"fav_use_{fav['id']}"
            ),
            InlineKeyboardButton(
                "🗑️", 
                callback_data=f"fav_delete_{fav['id']}"
            ),
        ])
    
    keyboard.append([InlineKeyboardButton("« Back", callback_data="main_menu")])
    
    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def favorites_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle favorites menu callback."""
    query = update.callback_query
    await query.answer()
    
    user = update.effective_user
    
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        
        favorites = session.query(FavoriteSwapPair).filter(
            FavoriteSwapPair.user_id == db_user.id
        ).order_by(FavoriteSwapPair.use_count.desc()).all()
        
        fav_data = [
            {
                "id": f.id,
                "name": f.display_name,
                "from_chain": f.from_chain,
                "from_token": f.from_token,
                "to_chain": f.to_chain,
                "to_token": f.to_token,
                "use_count": f.use_count,
            }
            for f in favorites
        ]
    
    if not fav_data:
        await query.edit_message_text(
            "⭐ *Favorite Pairs*\n\n"
            "No favorites saved yet.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔄 Start Swap", callback_data="swap_start")],
                [InlineKeyboardButton("« Back", callback_data="main_menu")],
            ])
        )
        return
    
    lines = ["⭐ *Favorite Pairs*\n"]
    
    keyboard = []
    for fav in fav_data[:10]:
        lines.append(
            f"• *{fav['name']}*: {fav['from_chain']}/{fav['from_token']} → "
            f"{fav['to_chain']}/{fav['to_token']} ({fav['use_count']} uses)"
        )
        keyboard.append([
            InlineKeyboardButton(
                f"🔄 {fav['name']}", 
                callback_data=f"fav_use_{fav['id']}"
            ),
            InlineKeyboardButton(
                "🗑️", 
                callback_data=f"fav_delete_{fav['id']}"
            ),
        ])
    
    keyboard.append([InlineKeyboardButton("« Back", callback_data="main_menu")])
    
    await query.edit_message_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def use_favorite_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Use a favorite pair to start a swap."""
    query = update.callback_query
    await query.answer()
    
    try:
        fav_id = int(query.data.split("_")[-1])
    except (ValueError, IndexError):
        await query.edit_message_text("❌ Invalid favorite.")
        return
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return

        fav = session.query(FavoriteSwapPair).filter(
            FavoriteSwapPair.id == fav_id,
            FavoriteSwapPair.user_id == db_user.id,
        ).first()

        if not fav:
            await query.edit_message_text("❌ Favorite not found.")
            return

        # Update usage stats
        fav.use_count += 1
        fav.last_used_at = datetime.now(timezone.utc)
        
        # Store swap data in context
        context.user_data["swap"] = {
            "from_chain": fav.from_chain,
            "from_token": fav.from_token,
            "to_chain": fav.to_chain,
            "to_token": fav.to_token,
        }
    
    await query.edit_message_text(
        f"⭐ Using favorite: *{fav.display_name}*\n\n"
        f"📤 From: {fav.from_chain} / {fav.from_token}\n"
        f"📥 To: {fav.to_chain} / {fav.to_token}\n\n"
        f"Enter the amount of {fav.from_token} to swap:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("❌ Cancel", callback_data="swap_cancel")]
        ])
    )


async def delete_favorite_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Delete a favorite pair."""
    query = update.callback_query
    await query.answer()
    
    try:
        fav_id = int(query.data.split("_")[-1])
    except (ValueError, IndexError):
        await query.edit_message_text("❌ Invalid favorite.")
        return
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()

        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return

        fav = session.query(FavoriteSwapPair).filter(
            FavoriteSwapPair.id == fav_id,
            FavoriteSwapPair.user_id == db_user.id,
        ).first()

        if fav:
            session.delete(fav)
    
    await query.answer("Favorite deleted!")
    await favorites_callback(update, context)


async def save_favorite(
    session,
    user_id: int,
    from_chain: str,
    from_token: str,
    to_chain: str,
    to_token: str,
) -> FavoriteSwapPair:
    """Save a new favorite pair."""
    fav = FavoriteSwapPair(
        user_id=user_id,
        from_chain=from_chain,
        from_token=from_token,
        to_chain=to_chain,
        to_token=to_token,
    )
    session.add(fav)
    session.flush()
    return fav


# Create handlers
favorites_handler = CommandHandler("f", favorites_command)

