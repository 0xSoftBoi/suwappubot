"""/claim <code> — bind a Telegram identity to a registered agent (SUW-204 follow-up).

The webapp/agent-control-plane (api-ts) mints a short-lived, single-use code
for a registered agent and shows it to the human once; api-ts persists only
its sha256 hex digest in the shared ``agent_link_codes`` table (never the
plaintext). The human pastes the code into Telegram via ``/claim <code>``,
this handler re-hashes it, looks up a still-valid still-unused row, and if
found atomically marks it used and sets ``agents.owner_user_id`` to the
caller's ``users.id`` (creating a ``users`` row for a brand new Telegram
identity if one doesn't exist yet, mirroring
``bot/services/unified_bot_service.py``'s get-or-create pattern).

``agent_link_codes.agent_id`` is an INTEGER FK to ``agents.id`` (matches
api-ts's shipped Drizzle schema, api-ts/src/db/schema/agentLinkCodes.ts) —
NOT the ``agents.uuid`` string used elsewhere (e.g. ``agent_approvals``).
Don't conflate the two id spaces.

Both ``agent_link_codes`` and ``agents.owner_user_id`` are shared,
concurrently-migrated, cross-stack schema (see ``database/db.py``'s
``_create_agent_link_codes_table`` / ``_add_agents_owner_user_id_column``),
so every query here tolerates the table/column not existing yet.
"""

import hashlib
import logging

from telegram import Update
from telegram.ext import CommandHandler, ContextTypes
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from bot.models.user import User
from bot.utils.rate_limiter import RateLimitExceeded, UserRateLimiter
from database.db import get_session

logger = logging.getLogger(__name__)

# 5 attempts/minute/user — brute-forcing a 64-char sha256 preimage is
# infeasible regardless, but this also caps accidental hammering / typo loops.
_claim_limiter = UserRateLimiter(max_requests=5, window_seconds=60)


def _table_missing(e: Exception) -> bool:
    msg = str(e).lower()
    return "does not exist" in msg or "no such table" in msg or "no such column" in msg


def _get_or_create_user(session, telegram_id: int) -> User:
    user = session.query(User).filter(User.telegram_id == telegram_id).first()
    if user:
        return user
    user = User(telegram_id=telegram_id)
    session.add(user)
    session.flush()  # populate user.id without a full commit yet
    return user


async def claim_agent_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/claim <code> — link a registered agent to the calling Telegram user."""
    user = update.effective_user
    if not user or not update.message:
        return

    try:
        await _claim_limiter.check(user.id)
    except RateLimitExceeded as e:
        await update.message.reply_text(f"⏳ {e}")
        return

    args = context.args if context.args else []
    if not args:
        await update.message.reply_text(
            "Usage: `/claim <code>` — paste the linking code shown to you when "
            "registering your agent.",
            parse_mode="Markdown",
        )
        return

    code = args[0].strip()
    if not code:
        await update.message.reply_text("That code looks empty — try again.")
        return

    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()

    try:
        with get_session() as session:
            # Atomic guarded UPDATE ... RETURNING: only claims a row that is
            # STILL unused and unexpired, so two concurrent /claim taps (or a
            # retried webhook delivery) on the same code can only ever
            # succeed once. RETURNING avoids a separate re-SELECT (which
            # would otherwise race against a concurrent claim of the SAME
            # code between the UPDATE and the follow-up SELECT). Both
            # Postgres and sqlite (>=3.35, our test/dev driver) support
            # UPDATE ... RETURNING; fall back to the old two-step for any
            # driver that doesn't.
            try:
                result = session.execute(
                    text(
                        "UPDATE agent_link_codes SET used_at = CURRENT_TIMESTAMP "
                        "WHERE code_hash = :code_hash AND used_at IS NULL "
                        "AND expires_at > CURRENT_TIMESTAMP "
                        "RETURNING agent_id"
                    ),
                    {"code_hash": code_hash},
                )
                row = result.fetchone()
                agent_id = row[0] if row else None
            except SQLAlchemyError:
                session.rollback()
                result = session.execute(
                    text(
                        "UPDATE agent_link_codes SET used_at = CURRENT_TIMESTAMP "
                        "WHERE code_hash = :code_hash AND used_at IS NULL "
                        "AND expires_at > CURRENT_TIMESTAMP"
                    ),
                    {"code_hash": code_hash},
                )
                if (result.rowcount or 0) > 0:
                    row = session.execute(
                        text("SELECT agent_id FROM agent_link_codes WHERE code_hash = :code_hash"),
                        {"code_hash": code_hash},
                    ).fetchone()
                    agent_id = row[0] if row else None
                else:
                    agent_id = None

            if agent_id is None:
                # Distinguish "never existed" from "expired/used" only for
                # our own logging; the user-facing message stays generic so
                # we don't leak which codes exist.
                session.commit()
                await update.message.reply_text(
                    "❌ That code is invalid, already used, or expired. Ask for a "
                    "new linking code and try again."
                )
                return

            db_user = _get_or_create_user(session, user.id)

            # Guarded UPDATE: only claim an agent that isn't already linked to
            # someone else. Without the owner_user_id IS NULL guard, a race
            # (or a reused/leaked code) could silently reassign an already-
            # claimed agent to a new owner.
            update_result = session.execute(
                text(
                    "UPDATE agents SET owner_user_id = :owner_user_id "
                    "WHERE id = :agent_id AND owner_user_id IS NULL"
                ),
                {"owner_user_id": db_user.id, "agent_id": agent_id},
            )
            if (update_result.rowcount or 0) == 0:
                session.rollback()
                existing = session.execute(
                    text("SELECT owner_user_id FROM agents WHERE id = :agent_id"),
                    {"agent_id": agent_id},
                ).fetchone()
                if existing and existing[0] is not None:
                    await update.message.reply_text("❌ This agent is already linked to an owner.")
                else:
                    logger.warning(
                        "Agent claim: code hashed ok but agent id=%s not found", agent_id
                    )
                    await update.message.reply_text(
                        "❌ That code points to an agent that no longer exists."
                    )
                return

            agent_row = session.execute(
                text("SELECT name FROM agents WHERE id = :agent_id"),
                {"agent_id": agent_id},
            ).fetchone()
            agent_name = (agent_row[0] if agent_row else None) or "Your agent"

            session.commit()
    except SQLAlchemyError as e:
        if _table_missing(e):
            await update.message.reply_text("Agent linking isn't set up yet — check back shortly.")
            return
        logger.error("Failed to claim agent for telegram_id=%s: %s", user.id, e)
        await update.message.reply_text(
            "Something went wrong linking your agent. Try again shortly."
        )
        return

    await update.message.reply_text(
        f"✅ Agent *{agent_name}* is now linked to you — you'll receive approval " "requests here.",
        parse_mode="Markdown",
    )


async def unlink_agent_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/unlink [<agent_name_or_id>] — unlink one of the caller's own agents.

    With no args, lists the caller's currently-linked agents. With an arg,
    matches by agent name (case-insensitive) or numeric agents.id among the
    caller's OWN agents only, and clears owner_user_id back to NULL.
    """
    user = update.effective_user
    if not user or not update.message:
        return

    args = context.args if context.args else []

    try:
        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()
            if not db_user:
                await update.message.reply_text("You don't have any linked agents.")
                return

            if not args:
                rows = session.execute(
                    text("SELECT id, name FROM agents WHERE owner_user_id = :owner"),
                    {"owner": db_user.id},
                ).fetchall()
                if not rows:
                    await update.message.reply_text("You don't have any linked agents.")
                    return
                lines = ["🤖 *Your linked agents*\n"]
                for agent_id, name in rows:
                    lines.append(f"• `{name or agent_id}` (id: `{agent_id}`)")
                lines.append("\nUse `/unlink <name_or_id>` to unlink one.")
                await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
                return

            target = " ".join(args).strip()

            row = session.execute(
                text(
                    "SELECT id, name FROM agents WHERE owner_user_id = :owner "
                    "AND (LOWER(name) = LOWER(:target) OR CAST(id AS TEXT) = :target)"
                ),
                {"owner": db_user.id, "target": target},
            ).fetchone()

            if not row:
                await update.message.reply_text(
                    "❌ Couldn't find one of your linked agents matching that name/id."
                )
                return

            agent_id, agent_name = row
            update_result = session.execute(
                text(
                    "UPDATE agents SET owner_user_id = NULL "
                    "WHERE id = :agent_id AND owner_user_id = :owner"
                ),
                {"agent_id": agent_id, "owner": db_user.id},
            )
            session.commit()

            if (update_result.rowcount or 0) == 0:
                await update.message.reply_text(
                    "❌ Couldn't find one of your linked agents matching that name/id."
                )
                return
    except SQLAlchemyError as e:
        if _table_missing(e):
            await update.message.reply_text("Agent linking isn't set up yet — check back shortly.")
            return
        logger.error("Failed to unlink agent for telegram_id=%s: %s", user.id, e)
        await update.message.reply_text(
            "Something went wrong unlinking your agent. Try again shortly."
        )
        return

    await update.message.reply_text(
        f"✅ Agent *{agent_name or agent_id}* has been unlinked from your account.",
        parse_mode="Markdown",
    )


claim_agent_handler = CommandHandler("claim", claim_agent_command)
unlink_agent_handler = CommandHandler("unlink", unlink_agent_command)
