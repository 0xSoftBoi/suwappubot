"""Agent approval decision handlers — the maker-checker human-in-the-loop side.

- Inline ``✅ Approve`` / ``❌ Deny`` buttons DM'd by
  ``bot/services/approval_notifier.py`` carry callback data
  ``apprv:<id>:yes`` / ``apprv:<id>:no``. ``approval_decision_callback``
  atomically flips a still-pending row so a double-tap (or a race with the
  expiry sweep) can only ever decide it once, and only the owning human can
  decide it.
- ``/approvals`` lists the caller's own pending approval requests.

The ``approval_requests`` table is owned by api-ts (schema at
``api-ts/src/db/schema/approvals.ts``); Python never creates it and only
reads it or updates the decision columns (status/decided_at/decided_by) here.
Every query tolerates the table (or the Python-owned notification columns)
not existing yet.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from bot.config.settings import settings
from bot.services.approval_webhook import notify_approval_decided
from database.db import get_session

logger = logging.getLogger(__name__)

# Short-TTL window for the second ("confirm") tap of the step-up approve
# flow. Mirrors the intent of api-ts's approval_step_up_challenges (see
# api-ts/src/db/schema/approvalStepUpChallenges.ts) — this is not
# WebAuthn/passkey proof, just evidence that the same human round-tripped a
# freshly server-issued value shortly before the decision was made, as a
# defense against a stale/forwarded callback deciding without the human
# actually seeing the re-confirm prompt.
STEP_UP_CONFIRM_TTL_MINUTES = 2


def _table_missing(e: Exception) -> bool:
    """True only for genuine missing-table/column signals.

    Deliberately does NOT match generic ``"does not exist"`` substrings —
    Postgres also uses that phrase for type-mismatch errors (e.g.
    ``operator does not exist: uuid = character varying``), which is a real
    bug, not a not-yet-migrated table, and must not be swallowed into a
    misleading "not set up yet" reply.
    """
    msg = str(e).lower()
    if "no such table" in msg or "no such column" in msg:
        return True
    if "relation" in msg and "does not exist" in msg:
        return True
    if "column" in msg and "does not exist" in msg:
        return True
    pgcode = getattr(getattr(e, "orig", None), "pgcode", None)
    return pgcode in ("42P01", "42703")  # undefined_table / undefined_column


def _is_postgres() -> bool:
    try:
        from database.db import engine

        return engine.dialect.name != "sqlite"
    except Exception:
        return False


def _now_utc_sql() -> str:
    """SQL expression for "now, in UTC" comparable to a naive ``timestamp``
    column (``approval_requests.expires_at`` is ``timestamp`` WITHOUT time
    zone — see ``api-ts/src/db/schema/approvals.ts``). Postgres's
    ``CURRENT_TIMESTAMP`` is ``timestamptz`` and gets cast to a naive
    timestamp using the SESSION TimeZone, which skews the comparison on any
    session whose TimeZone isn't UTC — mirrors api-ts's
    ``(now() at time zone 'utc')`` fix for the same column.
    """
    return "(now() at time zone 'utc')" if _is_postgres() else "CURRENT_TIMESTAMP"


def _parse_utc(expires_at) -> datetime | None:
    """Normalize a ``expires_at`` value read back via a raw ``text()`` query
    into a UTC-aware ``datetime``, regardless of whether the driver handed
    back a real ``datetime`` (psycopg2/Postgres — the production case) or a
    plain string (sqlite's DBAPI when queried through a bare ``text()`` SQL
    string with no column typing, which is how the SQLite-shadow-table unit
    tests exercise this code). Returns ``None`` if ``expires_at`` is falsy.
    """
    if not expires_at:
        return None
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    return expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)


def _resolve_user_id(session, telegram_id: int):
    row = session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"),
        {"tg": telegram_id},
    ).fetchone()
    return row[0] if row else None


def _issue_step_up_challenge(session, *, user_id: int, approval_id: str) -> str:
    """Insert a fresh single-use step-up row and return its challenge token.

    Shares the ``approval_step_up_challenges`` table with api-ts's web
    step-up flow (schema: ``api-ts/src/db/schema/approvalStepUpChallenges.ts``)
    so both surfaces' re-confirmation nonces live in one place. Token is kept
    short (hex) because Telegram callback_data is capped at 64 bytes and the
    approval_id (a uuid) plus prefix already consumes most of that budget.
    """
    token = secrets.token_hex(8)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=STEP_UP_CONFIRM_TTL_MINUTES)
    session.execute(
        text(
            "INSERT INTO approval_step_up_challenges "
            "(user_id, approval_id, challenge, expires_at) "
            "VALUES (:user_id, :approval_id, :challenge, :expires_at)"
        ),
        {
            "user_id": user_id,
            "approval_id": approval_id,
            "challenge": token,
            "expires_at": expires_at,
        },
    )
    session.commit()
    return token


def _consume_step_up_challenge(session, *, user_id: int, approval_id: str, token: str) -> bool:
    """Atomically mark a still-valid, unused challenge as used. Returns whether it matched."""
    result = session.execute(
        text(
            "UPDATE approval_step_up_challenges SET used_at = CURRENT_TIMESTAMP "
            "WHERE approval_id = :approval_id AND user_id = :user_id AND challenge = :challenge "
            "AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP"
        ),
        {"approval_id": approval_id, "user_id": user_id, "challenge": token},
    )
    session.commit()
    return (result.rowcount or 0) > 0


def _decide_approval(session, *, approval_id: str, caller_user_id: int, new_status: str):
    """Atomic guarded UPDATE + re-read, shared by the one-tap and step-up-confirm paths.

    Only flips a row that is STILL pending, not yet past its own expiry, AND
    owned by the tapping user (resolved to users.id), so a double-tap, a
    race with the expiry sweep, a lapsed-but-unswept row, or a forwarded
    callback payload can never decide it more than once, past expiry, or for
    someone else.
    """
    result = session.execute(
        text(
            "UPDATE approval_requests "
            "SET status = :new_status, decided_by = :decided_by, "
            "decided_at = CURRENT_TIMESTAMP "
            "WHERE id = :id AND status = 'pending' AND user_id = :caller_user_id "
            f"AND expires_at > {_now_utc_sql()}"
        ),
        {
            "new_status": new_status,
            "decided_by": caller_user_id,
            "id": approval_id,
            "caller_user_id": caller_user_id,
        },
    )
    decided_now = (result.rowcount or 0) > 0
    session.commit()

    row = session.execute(
        text(
            "SELECT ar.status, ar.decided_by, a.name, ar.agent_id, ar.user_id, ar.expires_at "
            "FROM approval_requests ar "
            "LEFT JOIN agents a ON CAST(a.uuid AS TEXT) = ar.agent_id "
            "WHERE ar.id = :id"
        ),
        {"id": approval_id},
    ).fetchone()
    return decided_now, row


async def approval_decision_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle apprv:<id>:yes / apprv:<id>:no / apprvc:<id>:<token> callback taps.

    When ``settings.approval_step_up_required`` is on, an "approve" tap
    (``apprv:<id>:yes``) is a two-tap flow: the first tap issues a fresh
    short-TTL confirm challenge and re-prompts rather than deciding anything;
    only the second tap (``apprvc:<id>:<token>``) — consuming that
    single-use challenge — actually performs the guarded UPDATE. Deny
    (``apprv:<id>:no``) is always one-tap regardless of the flag.
    """
    query = update.callback_query
    if not query or not query.data:
        return
    await query.answer()

    parts = query.data.split(":", 2)
    if len(parts) != 3:
        return
    prefix, approval_id, decision_or_token = parts

    user = update.effective_user
    if user is None:
        await query.edit_message_text("Couldn't identify who tapped this button. Try again.")
        return

    if prefix == "apprvx":
        # Cancel the step-up re-confirm prompt without deciding anything —
        # the underlying approval_requests row is untouched and still
        # pending, so the human can tap Approve again later (a fresh
        # /approvals reminder or the original message state, if still
        # editable, will still work).
        await query.edit_message_text(
            "Cancelled — this request is still pending. Use /approvals to act on it."
        )
        return

    if prefix == "apprvc":
        # Second tap of the step-up flow: decision_or_token is the challenge.
        try:
            with get_session() as session:
                caller_user_id = _resolve_user_id(session, user.id)
                if caller_user_id is None:
                    await query.edit_message_text("This approval belongs to another user.")
                    return
                challenge_ok = _consume_step_up_challenge(
                    session,
                    user_id=caller_user_id,
                    approval_id=approval_id,
                    token=decision_or_token,
                )
                if not challenge_ok:
                    await query.edit_message_text(
                        "This confirmation expired or was already used. Tap Approve again to retry."
                    )
                    return
                decided_now, row = _decide_approval(
                    session,
                    approval_id=approval_id,
                    caller_user_id=caller_user_id,
                    new_status="approved",
                )
        except SQLAlchemyError as e:
            if _table_missing(e):
                await query.edit_message_text("This approval system isn't set up yet.")
                return
            logger.error("Failed to confirm step-up approval %s: %s", approval_id, e)
            await query.edit_message_text(
                "Something went wrong recording your decision. Try again."
            )
            return
        new_status = "approved"
    else:
        decision = decision_or_token
        new_status = "approved" if decision == "yes" else "denied"

        try:
            with get_session() as session:
                caller_user_id = _resolve_user_id(session, user.id)
                if caller_user_id is None:
                    # No linked Suwappu account for this Telegram user — can never
                    # own an approval_requests row (user_id is a real FK), so no
                    # guarded UPDATE can possibly match. Don't leak row existence.
                    await query.edit_message_text("This approval belongs to another user.")
                    return

                if new_status == "approved" and settings.approval_step_up_required:
                    # First tap of the step-up flow: issue a fresh challenge
                    # and re-prompt instead of deciding anything yet.
                    try:
                        token = _issue_step_up_challenge(
                            session, user_id=caller_user_id, approval_id=approval_id
                        )
                    except SQLAlchemyError as e:
                        if _table_missing(e):
                            await query.edit_message_text(
                                "Step-up confirmation isn't set up yet — ask an admin to enable "
                                "approval_step_up_challenges before approving."
                            )
                            return
                        raise
                    keyboard = InlineKeyboardMarkup(
                        [
                            [
                                InlineKeyboardButton(
                                    "✅ Confirm approve",
                                    callback_data=f"apprvc:{approval_id}:{token}",
                                ),
                                InlineKeyboardButton(
                                    "❌ Cancel", callback_data=f"apprvx:{approval_id}:_"
                                ),
                            ]
                        ]
                    )
                    await query.edit_message_text(
                        "Please confirm you want to approve this agent action "
                        f"(expires in {STEP_UP_CONFIRM_TTL_MINUTES}m).",
                        reply_markup=keyboard,
                    )
                    return

                decided_now, row = _decide_approval(
                    session,
                    approval_id=approval_id,
                    caller_user_id=caller_user_id,
                    new_status=new_status,
                )
        except SQLAlchemyError as e:
            if _table_missing(e):
                await query.edit_message_text("This approval system isn't set up yet.")
                return
            logger.error("Failed to decide approval %s: %s", approval_id, e)
            await query.edit_message_text(
                "Something went wrong recording your decision. Try again."
            )
            return

    if not row:
        await query.edit_message_text("This approval request no longer exists.")
        return

    status, existing_decided_by, agent_name, agent_id, owner_user_id, expires_at = row
    label = agent_name or agent_id

    # Ownership check FIRST, regardless of the row's status — a non-owner
    # must learn nothing (not even that the row exists, who decided it, or
    # what agent it belongs to) whether the row is pending, decided, or
    # expired.
    if owner_user_id != caller_user_id:
        await query.edit_message_text("This approval belongs to another user.")
        return

    if decided_now:
        outcome = "✅ Approved" if new_status == "approved" else "❌ Denied"
        await query.edit_message_text(f"{outcome} — agent `{label}`.", parse_mode="Markdown")
        # Fire the agent's decision webhook (durable — enqueued first inside
        # notify_approval_decided so the decision is never lost even if the
        # inline POST attempt fails). Never blocks/crashes this handler.
        try:
            await notify_approval_decided(approval_id, new_status, None)
        except Exception as e:  # noqa: BLE001 — webhook delivery must never break the decide flow
            logger.warning("approval webhook dispatch failed for %s: %s", approval_id, e)
    elif status in ("approved", "denied"):
        await query.edit_message_text(
            f"Already {status} (by user #{existing_decided_by or 'someone'}) — agent `{label}`.",
            parse_mode="Markdown",
        )
    elif status == "expired":
        await query.edit_message_text(
            f"⌛ This request expired — agent `{label}`.", parse_mode="Markdown"
        )
    elif (
        status == "pending"
        and (exp := _parse_utc(expires_at)) is not None
        and exp <= datetime.now(timezone.utc)
    ):
        # Owner tapped a still-'pending' row that is already past its own
        # expiry but hasn't been swept to 'expired' yet by the notifier's
        # poll loop — tell them what actually happened rather than the
        # confusing generic "already pending" fallback below.
        await query.edit_message_text(
            f"⌛ This request expired — agent `{label}`.", parse_mode="Markdown"
        )
    else:
        await query.edit_message_text(f"This request is already {status}.")


async def approvals_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/approvals — list the caller's own pending agent-approval requests."""
    user = update.effective_user
    if not user or not update.message:
        return

    try:
        with get_session() as session:
            caller_user_id = _resolve_user_id(session, user.id)
            if caller_user_id is None:
                await update.message.reply_text("No pending agent approvals.")
                return

            rows = session.execute(
                text(
                    "SELECT ar.id, a.name, ar.agent_id, ar.action_type, ar.payload, "
                    "ar.expires_at "
                    "FROM approval_requests ar "
                    "LEFT JOIN agents a ON CAST(a.uuid AS TEXT) = ar.agent_id "
                    "WHERE ar.user_id = :uid AND ar.status = 'pending' "
                    "ORDER BY ar.created_at DESC LIMIT 20"
                ),
                {"uid": caller_user_id},
            ).fetchall()
    except SQLAlchemyError as e:
        if _table_missing(e):
            await update.message.reply_text("No pending agent approvals.")
            return
        logger.error("Failed to list approvals for %s: %s", user.id, e)
        await update.message.reply_text("Couldn't load approvals right now, try again shortly.")
        return

    if not rows:
        await update.message.reply_text("No pending agent approvals.")
        return

    lines = [f"🤖 *Pending agent approvals* — {len(rows)}\n"]
    now = datetime.now(timezone.utc)
    for approval_id, agent_name, agent_id, action_type, payload, expires_at in rows:
        label = agent_name or agent_id
        value_usd = payload.get("valueUsd") if isinstance(payload, dict) else None
        value_str = f"${float(value_usd):,.2f}" if value_usd is not None else "?"
        if expires_at:
            exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            mins_left = max(int((exp - now).total_seconds() // 60), 0)
            expiry_str = f"{mins_left}m left"
        else:
            expiry_str = "no expiry"
        lines.append(
            f"• `{label}` — {action_type} — {value_str} ({expiry_str})\n" f"  id: `{approval_id}`"
        )

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


approval_decision_handler = CallbackQueryHandler(approval_decision_callback, pattern=r"^apprv")
approvals_command_handler = CommandHandler("approvals", approvals_command)
