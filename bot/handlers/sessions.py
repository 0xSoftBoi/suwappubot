"""/sessions — list signed-in devices (mobile/webapp JWT sessions) and revoke
them all at once (MONEY-PATH: this is the kill switch for a stolen bearer
token — see api/main.py::create_jwt_token / _check_session_valid).

Only sessions minted AFTER this feature shipped (i.e. tokens that carry a
`jti` claim) have a row here — older tokens are grandfathered valid and
can't be individually listed or revoked until they naturally expire (up to
7 days). This is called out explicitly in the reply text so it isn't a
silent gap.
"""

import logging
from datetime import datetime, timezone

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)

_MAX_LISTED_SESSIONS = 10
SESSIONS_REVOKE_ALL_CALLBACK = "sessions_revoke_all"
SESSIONS_CLOSE_CALLBACK = "sessions_close"


def _resolve_user_id(update: Update):
    tg_user = update.effective_user
    if not tg_user:
        return None
    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == tg_user.id).first()
        return db_user.id if db_user else None


def _format_sessions_text(rows) -> str:
    if not rows:
        return (
            "🔑 *Signed-in devices*\n\n"
            "No individually-revocable sessions found.\n\n"
            "_Sessions minted before this feature shipped aren't tracked "
            "individually and will simply expire on their own (up to 7 days)._"
        )

    lines = ["🔑 *Signed-in devices*\n"]
    for row in rows[:_MAX_LISTED_SESSIONS]:
        last_seen = row.last_seen_at or row.created_at
        src = row.src or "unknown"
        lines.append(f"• `{row.jti[:8]}…` — {src} — last seen {last_seen:%Y-%m-%d %H:%M UTC}")
    if len(rows) > _MAX_LISTED_SESSIONS:
        lines.append(f"\n_+{len(rows) - _MAX_LISTED_SESSIONS} more not shown._")
    lines.append(
        '\n_"Revoke all" below only affects the sessions listed above — any '
        "older, untracked session will still expire naturally within 7 days._"
    )
    return "\n".join(lines)


async def sessions_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show tracked signed-in devices/sessions with a Revoke-all button."""
    user_id = _resolve_user_id(update)
    if not user_id:
        await update.message.reply_text("❌ Please /start the bot first.")
        return

    from bot.models.user_session import UserSession

    with get_session() as session:
        rows = (
            session.query(UserSession)
            .filter(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
            .order_by(UserSession.created_at.desc())
            .all()
        )
        # Snapshot fields before the session closes (expire_on_commit).
        rows = [
            type(
                "Row",
                (),
                {
                    "jti": r.jti,
                    "src": r.src,
                    "created_at": r.created_at,
                    "last_seen_at": r.last_seen_at,
                },
            )
            for r in rows
        ]

    keyboard = [[InlineKeyboardButton("✖️ Close", callback_data=SESSIONS_CLOSE_CALLBACK)]]
    if rows:
        keyboard.insert(
            0,
            [
                InlineKeyboardButton(
                    "🚫 Revoke all sessions", callback_data=SESSIONS_REVOKE_ALL_CALLBACK
                )
            ],
        )

    await update.message.reply_text(
        _format_sessions_text(rows),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def sessions_revoke_all_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Mark every tracked session for this user revoked_at=now. Takes effect
    everywhere `decode_jwt_token` is checked within the revocation cache's
    TTL (<=30s, see api/main.py::_SESSION_VALIDITY_CACHE_TTL_SECONDS)."""
    query = update.callback_query
    await query.answer()

    user_id = _resolve_user_id(update)
    if not user_id:
        await query.edit_message_text("❌ Session expired. Run /sessions again.")
        return

    from bot.models.user_session import UserSession

    now = datetime.now(timezone.utc)
    with get_session() as session:
        revoked = (
            session.query(UserSession)
            .filter(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
            .update({"revoked_at": now}, synchronize_session=False)
        )

    logger.info("Revoked %s session(s) for user_id=%s via /sessions", revoked, user_id)
    await query.edit_message_text(
        f"✅ Revoked {revoked} signed-in session(s). Any device using one of them will be "
        "signed out within about 30 seconds.\n\n"
        "_Note: tokens minted before this feature shipped aren't tracked and can't be "
        "force-revoked — they'll expire naturally (up to 7 days)._",
        parse_mode="Markdown",
    )


async def sessions_close_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("Closed.")


sessions_handler = CommandHandler("sessions", sessions_command)
sessions_revoke_all_handler = CallbackQueryHandler(
    sessions_revoke_all_callback, pattern=f"^{SESSIONS_REVOKE_ALL_CALLBACK}$"
)
sessions_close_handler = CallbackQueryHandler(
    sessions_close_callback, pattern=f"^{SESSIONS_CLOSE_CALLBACK}$"
)
