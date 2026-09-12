"""Agent approval decision handlers — the maker-checker human-in-the-loop side.

- Inline ``✅ Approve`` / ``❌ Deny`` buttons DM'd by
  ``bot/services/approval_notifier.py`` carry callback data
  ``apprv:<id>:yes`` / ``apprv:<id>:no``. ``approval_decision_callback``
  records one distinct human vote; approval only becomes terminal after the
  snapshotted quorum is reached, while deny remains immediately terminal.
- ``/approvals`` lists pending requests the caller may decide as owner/direct user or explicit org approver.

The ``approval_requests`` table is owned by api-ts (schema at
``api-ts/src/db/schema/approvals.ts``); Python mirrors the additive quorum schema and records approval_votes plus
terminal decision columns here.
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


def _can_act_on_approval(session, *, approval_id: str, caller_user_id: int) -> bool:
    """Same maker/checker authority as api-ts: owner/direct user or org approver."""
    row = session.execute(
        text(
            "SELECT 1 FROM approval_requests ar "
            "WHERE ar.id = :approval_id AND ("
            "ar.user_id = :caller_user_id OR EXISTS ("
            "SELECT 1 FROM organization_members om "
            "WHERE om.organization_id = ar.organization_id "
            "AND om.user_id = :caller_user_id "
            "AND om.role IN ('owner', 'approver')"
            "))"
        ),
        {"approval_id": approval_id, "caller_user_id": caller_user_id},
    ).fetchone()
    return row is not None


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
    return (result.rowcount or 0) > 0


def _approval_vote_for_user(session, *, approval_id: str, user_id: int):
    row = session.execute(
        text(
            "SELECT decision FROM approval_votes "
            "WHERE approval_request_id = :approval_id AND user_id = :user_id"
        ),
        {"approval_id": approval_id, "user_id": user_id},
    ).fetchone()
    return row[0] if row else None


def _decide_approval(session, *, approval_id: str, caller_user_id: int, new_status: str):
    """Record one distinct human vote and finalize only when policy quorum is met.

    A denial is terminal immediately. Approval votes stay pending until the
    request's snapshotted required_approvals threshold is reached.
    """
    lock_suffix = " FOR UPDATE" if _is_postgres() else ""
    row = session.execute(
        text(
            "SELECT ar.status, ar.decided_by, a.name, ar.agent_id, ar.user_id, "
            "ar.expires_at, COALESCE(ar.required_approvals, 1) "
            "FROM approval_requests ar "
            "LEFT JOIN agents a ON CAST(a.uuid AS TEXT) = ar.agent_id "
            "WHERE ar.id = :id AND ("
            "ar.user_id = :caller_user_id OR EXISTS ("
            "SELECT 1 FROM organization_members om "
            "WHERE om.organization_id = ar.organization_id "
            "AND om.user_id = :caller_user_id "
            "AND om.role IN ('owner', 'approver')))"
            + lock_suffix
        ),
        {"id": approval_id, "caller_user_id": caller_user_id},
    ).fetchone()
    if not row:
        session.rollback()
        return False, None, 0, 1, False

    status, _, _, _, _, expires_at, required_approvals = row
    required_approvals = max(int(required_approvals or 1), 1)
    expires = _parse_utc(expires_at)
    if status != "pending" or (expires is not None and expires <= datetime.now(timezone.utc)):
        count = session.execute(
            text(
                "SELECT COUNT(*) FROM approval_votes "
                "WHERE approval_request_id = :id AND decision = 'approved'"
            ),
            {"id": approval_id},
        ).scalar() or 0
        session.rollback()
        return False, row, int(count), required_approvals, False

    prior_vote = _approval_vote_for_user(
        session, approval_id=approval_id, user_id=caller_user_id
    )
    if prior_vote and prior_vote != new_status:
        session.rollback()
        raise ValueError(f"You already voted {prior_vote} on this request.")

    vote_recorded = False
    if not prior_vote:
        if _is_postgres():
            vote_result = session.execute(
                text(
                    "INSERT INTO approval_votes "
                    "(approval_request_id, user_id, decision) "
                    "VALUES (:approval_id, :user_id, :decision) "
                    "ON CONFLICT (approval_request_id, user_id) DO NOTHING"
                ),
                {
                    "approval_id": approval_id,
                    "user_id": caller_user_id,
                    "decision": new_status,
                },
            )
        else:
            vote_result = session.execute(
                text(
                    "INSERT OR IGNORE INTO approval_votes "
                    "(approval_request_id, user_id, decision) "
                    "VALUES (:approval_id, :user_id, :decision)"
                ),
                {
                    "approval_id": approval_id,
                    "user_id": caller_user_id,
                    "decision": new_status,
                },
            )
        vote_recorded = (vote_result.rowcount or 0) > 0

    approval_count = int(
        session.execute(
            text(
                "SELECT COUNT(*) FROM approval_votes "
                "WHERE approval_request_id = :id AND decision = 'approved'"
            ),
            {"id": approval_id},
        ).scalar()
        or 0
    )

    terminal_now = False
    if new_status == "denied":
        result = session.execute(
            text(
                "UPDATE approval_requests "
                "SET status = 'denied', decided_by = :decided_by, "
                "decided_at = CURRENT_TIMESTAMP "
                "WHERE id = :id AND status = 'pending' "
                f"AND expires_at > {_now_utc_sql()}"
            ),
            {"decided_by": caller_user_id, "id": approval_id},
        )
        terminal_now = (result.rowcount or 0) > 0
    elif approval_count >= required_approvals:
        result = session.execute(
            text(
                "UPDATE approval_requests "
                "SET status = 'approved', decided_by = :decided_by, "
                "decided_at = CURRENT_TIMESTAMP "
                "WHERE id = :id AND status = 'pending' "
                f"AND expires_at > {_now_utc_sql()}"
            ),
            {"decided_by": caller_user_id, "id": approval_id},
        )
        terminal_now = (result.rowcount or 0) > 0

    session.commit()
    current = session.execute(
        text(
            "SELECT ar.status, ar.decided_by, a.name, ar.agent_id, ar.user_id, "
            "ar.expires_at, COALESCE(ar.required_approvals, 1) "
            "FROM approval_requests ar "
            "LEFT JOIN agents a ON CAST(a.uuid AS TEXT) = ar.agent_id "
            "WHERE ar.id = :id"
        ),
        {"id": approval_id},
    ).fetchone()
    return terminal_now, current, approval_count, required_approvals, vote_recorded


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
                if not _can_act_on_approval(
                    session, approval_id=approval_id, caller_user_id=caller_user_id
                ):
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
                decided_now, row, approval_count, required_approvals, vote_recorded = _decide_approval(
                    session,
                    approval_id=approval_id,
                    caller_user_id=caller_user_id,
                    new_status="approved",
                )
        except ValueError as e:
            await query.edit_message_text(str(e))
            return
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
                    await query.edit_message_text("This approval belongs to another user.")
                    return
                if not _can_act_on_approval(
                    session, approval_id=approval_id, caller_user_id=caller_user_id
                ):
                    await query.edit_message_text("This approval belongs to another user.")
                    return

                if new_status == "approved" and settings.approval_step_up_required:
                    prior_vote = _approval_vote_for_user(
                        session, approval_id=approval_id, user_id=caller_user_id
                    )
                    if prior_vote:
                        await query.edit_message_text(
                            f"You already voted {prior_vote} on this request."
                        )
                        return
                    # First tap of the step-up flow: issue a fresh challenge
                    # and re-prompt instead of deciding anything yet.
                    try:
                        token = _issue_step_up_challenge(
                            session, user_id=caller_user_id, approval_id=approval_id
                        )
                    except ValueError as e:
            await query.edit_message_text(str(e))
            return
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

                decided_now, row, approval_count, required_approvals, vote_recorded = _decide_approval(
                    session,
                    approval_id=approval_id,
                    caller_user_id=caller_user_id,
                    new_status=new_status,
                )
        except ValueError as e:
            await query.edit_message_text(str(e))
            return
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

    (
        status,
        existing_decided_by,
        agent_name,
        agent_id,
        _owner_user_id,
        expires_at,
        _row_required_approvals,
    ) = row
    label = agent_name or agent_id

    if decided_now:
        outcome = "✅ Approved" if new_status == "approved" else "❌ Denied"
        suffix = (
            f" ({approval_count}/{required_approvals} approvals)"
            if new_status == "approved"
            else ""
        )
        await query.edit_message_text(
            f"{outcome}{suffix} — agent `{label}`.", parse_mode="Markdown"
        )
        try:
            await notify_approval_decided(approval_id, new_status, None)
        except Exception as e:  # noqa: BLE001 — webhook delivery must never break the decide flow
            logger.warning("approval webhook dispatch failed for %s: %s", approval_id, e)
    elif (
        new_status == "approved"
        and status == "pending"
        and (vote_recorded or approval_count < required_approvals)
    ):
        await query.edit_message_text(
            f"✅ Approval recorded — {approval_count}/{required_approvals}. "
            f"Agent `{label}` remains pending until quorum is reached.",
            parse_mode="Markdown",
        )
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
                    "ar.expires_at, COALESCE(ar.required_approvals, 1), "
                    "(SELECT COUNT(*) FROM approval_votes av "
                    " WHERE av.approval_request_id = ar.id AND av.decision = 'approved') "
                    "FROM approval_requests ar "
                    "LEFT JOIN agents a ON CAST(a.uuid AS TEXT) = ar.agent_id "
                    "WHERE ar.status = 'pending' AND ("
                    "ar.user_id = :uid OR EXISTS ("
                    "SELECT 1 FROM organization_members om "
                    "WHERE om.organization_id = ar.organization_id "
                    "AND om.user_id = :uid AND om.role IN ('owner', 'approver'))) "
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
    for (
        approval_id,
        agent_name,
        agent_id,
        action_type,
        payload,
        expires_at,
        required_approvals,
        approval_count,
    ) in rows:
        label = agent_name or agent_id
        value_usd = payload.get("valueUsd") if isinstance(payload, dict) else None
        value_str = f"${float(value_usd):,.2f}" if value_usd is not None else "?"
        if expires_at:
            exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            mins_left = max(int((exp - now).total_seconds() // 60), 0)
            expiry_str = f"{mins_left}m left"
        else:
            expiry_str = "no expiry"
        progress = f"{int(approval_count or 0)}/{max(int(required_approvals or 1), 1)} approvals"
        lines.append(
            f"• `{label}` — {action_type} — {value_str} ({expiry_str}; {progress})\n"
            f"  id: `{approval_id}`"
        )

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


approval_decision_handler = CallbackQueryHandler(approval_decision_callback, pattern=r"^apprv")
approvals_command_handler = CommandHandler("approvals", approvals_command)
