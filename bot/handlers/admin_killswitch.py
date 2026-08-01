"""Admin handler for the shared agent-policy kill switch.

The `policy_kill_switches` table is owned by api-ts (drizzle schema at
``api-ts/src/db/schema/policies.ts``). Python only reads/writes it via raw SQL
so no ORM model/migration is introduced here — Python must tolerate the table
not existing yet (e.g. local dev DB not migrated by drizzle).

  /ks status                          list active kill switches
  /ks on global [reason...]           activate a global kill switch
  /ks on agent <agentUuid> [reason]   activate a per-agent kill switch
  /ks on org <orgId> [reason...]      activate a per-org kill switch
  /ks off global                      deactivate the global kill switch
  /ks off agent <agentUuid>           deactivate a per-agent kill switch
  /ks off org <orgId>                 deactivate a per-org kill switch
"""

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session
from telegram import Update
from telegram.ext import ContextTypes, CommandHandler

from bot.config.settings import settings
from database.db import get_session

logger = logging.getLogger(__name__)

VALID_SCOPES = ("global", "agent", "org")

# Admin user IDs from settings, fail-closed if not configured (mirrors admin_p2p).
ADMIN_IDS = (
    [int(x) for x in settings.admin_telegram_ids.split(",") if x.strip()]
    if settings.admin_telegram_ids
    else []
)


def is_admin(user_id: int) -> bool:
    """Check if user is admin. Denies all if no admin IDs configured (fail-closed)."""
    return len(ADMIN_IDS) > 0 and user_id in ADMIN_IDS


class KillSwitchTableMissing(Exception):
    """Raised when policy_kill_switches has not been migrated yet."""


def _is_missing_table_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "no such table" in msg


def list_active_kill_switches(session: Session) -> list[dict]:
    """Return active kill switches as plain dicts. Raises KillSwitchTableMissing if unmigrated."""
    try:
        rows = session.execute(
            text(
                "SELECT scope, scope_id, reason, activated_at "
                "FROM policy_kill_switches WHERE active = true "
                "ORDER BY activated_at DESC"
            )
        ).fetchall()
    except Exception as e:
        if _is_missing_table_error(e):
            raise KillSwitchTableMissing() from e
        raise
    return [
        {
            "scope": r[0],
            "scope_id": r[1],
            "reason": r[2],
            "activated_at": r[3],
        }
        for r in rows
    ]


def _resolve_user_id(session: Session, admin_telegram_id: int) -> int | None:
    """Resolve users.id from a Telegram id. Returns None if there's no matching user row.

    ``policy_kill_switches.activated_by`` is an INTEGER FK to users.id (not the
    Telegram id) — inserting the raw Telegram id violates the FK constraint.
    """
    row = session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"),
        {"tg": admin_telegram_id},
    ).fetchone()
    return row[0] if row else None


def activate_kill_switch(
    session: Session,
    scope: str,
    scope_id: str | None,
    reason: str | None,
    admin_telegram_id: int,
) -> None:
    """Upsert an active kill switch for the given scope/scope_id.

    ``activated_by`` is resolved from ``admin_telegram_id`` to a users.id (the FK
    target). If no matching user row exists, activated_by is left NULL and the
    Telegram id is appended to the stored reason instead.
    """
    if scope not in VALID_SCOPES:
        raise ValueError(f"Invalid scope: {scope!r}")
    try:
        activated_by = _resolve_user_id(session, admin_telegram_id)
        if activated_by is None:
            reason = f"{reason or ''} [tg:{admin_telegram_id}]".strip()
        existing = session.execute(
            text(
                "SELECT id FROM policy_kill_switches "
                "WHERE scope = :scope AND scope_id IS NOT DISTINCT FROM :scope_id"
            ),
            {"scope": scope, "scope_id": scope_id},
        ).fetchone()
        if existing:
            session.execute(
                text(
                    "UPDATE policy_kill_switches "
                    "SET active = true, reason = :reason, activated_by = :activated_by, "
                    "activated_at = now(), deactivated_at = NULL "
                    "WHERE id = :id"
                ),
                {"reason": reason, "activated_by": activated_by, "id": existing[0]},
            )
        else:
            session.execute(
                text(
                    "INSERT INTO policy_kill_switches "
                    "(scope, scope_id, active, reason, activated_by) "
                    "VALUES (:scope, :scope_id, true, :reason, :activated_by)"
                ),
                {
                    "scope": scope,
                    "scope_id": scope_id,
                    "reason": reason,
                    "activated_by": activated_by,
                },
            )
        session.commit()
    except Exception as e:
        session.rollback()
        if _is_missing_table_error(e):
            raise KillSwitchTableMissing() from e
        raise


def deactivate_kill_switch(session: Session, scope: str, scope_id: str | None) -> bool:
    """Deactivate an active kill switch. Returns True if a row was updated."""
    if scope not in VALID_SCOPES:
        raise ValueError(f"Invalid scope: {scope!r}")
    try:
        result = session.execute(
            text(
                "UPDATE policy_kill_switches "
                "SET active = false, deactivated_at = now() "
                "WHERE scope = :scope AND scope_id IS NOT DISTINCT FROM :scope_id AND active = true"
            ),
            {"scope": scope, "scope_id": scope_id},
        )
        session.commit()
        return result.rowcount > 0
    except Exception as e:
        session.rollback()
        if _is_missing_table_error(e):
            raise KillSwitchTableMissing() from e
        raise


_NOT_MIGRATED_MSG = "❌ Kill-switch table not migrated yet (policy_kill_switches missing)."


async def kill_switch_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin: manage the shared agent-policy kill switch. Usage: /ks status|on|off ..."""
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ Admin access required.")
        return

    args = context.args or []
    if not args:
        await update.message.reply_text(
            "Usage:\n"
            "`/ks status`\n"
            "`/ks on global [reason...]`\n"
            "`/ks on agent <agentUuid> [reason...]`\n"
            "`/ks on org <orgId> [reason...]`\n"
            "`/ks off global`\n"
            "`/ks off agent <agentUuid>`\n"
            "`/ks off org <orgId>`",
            parse_mode="Markdown",
        )
        return

    sub = args[0].lower()

    if sub == "status":
        try:
            with get_session() as session:
                switches = list_active_kill_switches(session)
        except KillSwitchTableMissing:
            await update.message.reply_text(_NOT_MIGRATED_MSG)
            return
        except Exception as e:
            logger.exception("ks status failed")
            await update.message.reply_text(f"❌ Could not load kill switches: {e}")
            return

        if not switches:
            await update.message.reply_text("✅ No active kill switches.")
            return

        lines = ["\U0001f6d1 *Active kill switches*\n"]
        for s in switches:
            scope_label = s["scope"] if not s["scope_id"] else f"{s['scope']}:{s['scope_id']}"
            lines.append(
                f"• `{scope_label}` — {(s['reason'] or 'no reason')[:120]} "
                f"(since {s['activated_at']})"
            )
        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
        return

    if sub in ("on", "off"):
        if len(args) < 2 or args[1].lower() not in VALID_SCOPES:
            await update.message.reply_text(f"❌ Scope must be one of: {', '.join(VALID_SCOPES)}.")
            return
        scope = args[1].lower()

        scope_id: str | None = None
        reason_start = 2
        if scope in ("agent", "org"):
            if len(args) < 3:
                await update.message.reply_text(f"❌ `{scope}` scope requires an id.")
                return
            scope_id = args[2]
            reason_start = 3

        if sub == "on":
            reason = " ".join(args[reason_start:]) or None
            try:
                with get_session() as session:
                    activate_kill_switch(
                        session,
                        scope=scope,
                        scope_id=scope_id,
                        reason=reason,
                        admin_telegram_id=user.id,
                    )
            except KillSwitchTableMissing:
                await update.message.reply_text(_NOT_MIGRATED_MSG)
                return
            except Exception as e:
                logger.exception("ks on failed")
                await update.message.reply_text(f"❌ Could not activate: {e}")
                return

            scope_label = scope if not scope_id else f"{scope}:{scope_id}"
            await update.message.reply_text(f"\U0001f6d1 Kill switch ON for `{scope_label}`.")
            return

        # sub == "off"
        try:
            with get_session() as session:
                changed = deactivate_kill_switch(session, scope=scope, scope_id=scope_id)
        except KillSwitchTableMissing:
            await update.message.reply_text(_NOT_MIGRATED_MSG)
            return
        except Exception as e:
            logger.exception("ks off failed")
            await update.message.reply_text(f"❌ Could not deactivate: {e}")
            return

        scope_label = scope if not scope_id else f"{scope}:{scope_id}"
        if changed:
            await update.message.reply_text(f"✅ Kill switch OFF for `{scope_label}`.")
        else:
            await update.message.reply_text(f"ℹ️ No active kill switch for `{scope_label}`.")
        return

    await update.message.reply_text("❌ Unknown subcommand. Use `status`, `on`, or `off`.")


kill_switch_handler = CommandHandler("ks", kill_switch_command)
