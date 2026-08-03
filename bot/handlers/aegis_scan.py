"""AEGIS global scan-and-log seam — Phase 1 item 1.5 of docs/plans/aegis-fork-extend.md.

Registered in group -1 (runs before every group-0 command/conversation
handler) so it observes every inbound update pre-dispatch. Observe-mode only:
it never replies, never mutates state, and never stops propagation — group -1
handlers running to completion does NOT block group 0 from also processing
the same update (that only happens if a handler raises
`telegram.ext.ApplicationHandlerStop`, which this callback never does).

`aegis_service.ascan()` is fail-open (never raises) and does its own
telemetry logging, so this callback has nothing to do with the verdict.
"""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import ContextTypes

from bot.services.aegis_service import get_aegis

logger = logging.getLogger(__name__)


async def aegis_scan_update(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Fire-and-forget AEGIS scan of the inbound message's text/caption.

    No I/O beyond the in-process regex scan; no replies; no state mutation.
    Always returns None so group 0 handlers still run normally.
    """
    message = update.effective_message
    if message is None:
        return

    content = message.text or message.caption
    if not content:
        return

    user_id = str(update.effective_user.id) if update.effective_user else None

    await get_aegis().ascan(content, source="telegram", user_id=user_id)
